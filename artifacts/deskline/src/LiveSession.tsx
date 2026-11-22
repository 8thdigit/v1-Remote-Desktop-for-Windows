import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react';
import { ArrowLeft, Gauge, Laptop, Maximize, Minimize, MousePointer2, ShieldCheck, WifiOff } from 'lucide-react';
import { endDeskline, getGetDesklineFrameUrl, sendDesklineInput, sendDesklineInputs, type DesklineInput } from '@workspace/api-client-react';

type Props = { token: string; verification: string; preapproved?: boolean; name?: string; onLeave: (message?: string) => void };
const keys = /^(Backspace|Tab|Enter|Escape|PageUp|PageDown|End|Home|Arrow(Left|Up|Right|Down)|Insert|Delete|F([1-9]|1[01]))$/;
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve) => {
  const t = window.setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { window.clearTimeout(t); resolve(); }, { once: true });
});
// How long the viewer keeps retrying a lost connection before it gives up.
// The relay drops a peer it has not heard from for 20 seconds.
const RECONNECT_FOR = 15_000;

type KeyboardLock = { lock?: (codes?: string[]) => Promise<void>; unlock?: () => void };
const keyboardApi = () => (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;

function position(e: PointerEvent<HTMLCanvasElement> | WheelEvent<HTMLCanvasElement>) {
  const r = e.currentTarget.getBoundingClientRect();
  return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) };
}

export default function LiveSession({ token, verification, preapproved = false, name, onLeave }: Props) {
  const [state, setState] = useState<'pending' | 'live'>(preapproved ? 'live' : 'pending');
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [control, setControl] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [stats, setStats] = useState({ fps: 0, kb: 0, ping: 0 });
  // 'native' is the browser's full screen; 'window' fills the browser tab
  // where the Fullscreen API is not available (for example on iPhone).
  const [full, setFull] = useState<false | 'native' | 'window'>(false);
  const [locked, setLocked] = useState(false);
  const [toolbar, setToolbar] = useState(true);
  const leaveRef = useRef(onLeave);
  const stopRef = useRef(false);
  const stream = useRef<AbortController | null>(null);
  const input = useRef<DesklineInput[]>([]);
  const sending = useRef(false);
  const batch = useRef(true);
  const surface = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const lastMove = useRef(0);
  const lastWheel = useRef(0);
  const pressed = useRef<number | null>(null);
  const frameTimes = useRef<number[]>([]);
  const frameBytes = useRef(0);
  const ping = useRef(0);
  const toolbarTimer = useRef(0);
  const headers = { Authorization: `Bearer ${token}` };
  leaveRef.current = onLeave;

  function finish(message?: string, remoteAlreadyClosed = false) {
    if (stopRef.current) return;
    stopRef.current = true;
    stream.current?.abort();
    input.current = [];
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    keyboardApi()?.unlock?.();
    if (!remoteAlreadyClosed) void endDeskline({ headers, keepalive: true }).catch(() => {});
    leaveRef.current(message);
  }
  const finishRef = useRef(finish);
  finishRef.current = finish;

  // Frames arrive by long poll: the relay holds each request until the host
  // uploads a newer frame, so a frame is shown as soon as it exists.
  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    stream.current = controller;
    let sequence = 0;
    let lastGood = Date.now();
    let drawn = 0;
    async function draw(blob: Blob, seq: number) {
      const canvas = surface.current;
      if (!canvas) return;
      const bitmap = await createImageBitmap(blob);
      // Decodes can finish out of order; never paint an older frame.
      if (signal.aborted || seq < drawn) { bitmap.close(); return; }
      drawn = seq;
      if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        setSize({ w: bitmap.width, h: bitmap.height });
      }
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx?.drawImage(bitmap, 0, 0);
      bitmap.close();
    }
    async function loop() {
      while (!signal.aborted) {
        const started = Date.now();
        try {
          const res = await fetch(getGetDesklineFrameUrl({ after: sequence, wait: 8000 }), {
            headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
            credentials: 'omit', redirect: 'error',
            signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
          });
          if (signal.aborted) return;
          if (res.status === 410) {
            finishRef.current('The host ended the session, or it expired. Ask for a new code to reconnect.', true);
            return;
          }
          if (!res.ok) throw new Error('Frame request failed');
          const current = res.headers.get('X-Deskline-State');
          if (current !== 'live' && current !== 'pending') throw new Error('Invalid relay response');
          setState(current);
          lastGood = Date.now();
          setReconnecting(false);
          if (res.status === 200) {
            const next = Number(res.headers.get('X-Deskline-Frame'));
            if (!Number.isSafeInteger(next) || next <= sequence ||
                res.headers.get('content-type')?.split(';')[0] !== 'image/jpeg') throw new Error('Invalid frame');
            const blob = await res.blob();
            if (signal.aborted) return;
            sequence = next;
            frameTimes.current.push(Date.now());
            frameBytes.current = blob.size;
            // Decode off the main path; a slow decode never blocks the next request.
            void draw(blob, next).catch(() => {});
            continue;
          }
          // Waiting for approval, or a relay that answered without waiting.
          const elapsed = Date.now() - started;
          if (current === 'pending') await sleep(650, signal);
          else if (elapsed < 100) await sleep(100 - elapsed, signal);
        } catch {
          if (signal.aborted) return;
          if (Date.now() - lastGood > RECONNECT_FOR) {
            finishRef.current('The connection to the relay was lost. Start a new session to reconnect.');
            return;
          }
          setReconnecting(true);
          await sleep(Math.min(2000, 300 + (Date.now() - lastGood) / 4), signal);
        }
      }
    }
    function pageExit() {
      controller.abort();
      void endDeskline({ headers: { Authorization: `Bearer ${token}` }, keepalive: true }).catch(() => {});
    }
    void loop();
    window.addEventListener('pagehide', pageExit);
    const statsTimer = window.setInterval(() => {
      const now = Date.now();
      frameTimes.current = frameTimes.current.filter((t) => now - t < 2000);
      setStats({ fps: Math.round(frameTimes.current.length / 2), kb: Math.round(frameBytes.current / 1024), ping: ping.current });
    }, 1000);
    return () => {
      controller.abort();
      window.clearInterval(statsTimer);
      window.removeEventListener('pagehide', pageExit);
    };
  }, [token]);

  // Input is sent in batches: everything queued while one request is in
  // flight goes in the next, so a fast mouse never builds a backlog.
  async function dispatch(item: DesklineInput) {
    const signal = stream.current?.signal;
    if (!signal || signal.aborted) return;
    const queue = input.current;
    if (item.kind === 'move' && queue.at(-1)?.kind === 'move') queue.pop();
    if (item.kind === 'release') queue.length = 0;
    if (queue.length >= 64) queue.splice(0, queue.length, { kind: 'release' });
    queue.push(item);
    if (sending.current) return;
    sending.current = true;
    let failures = 0;
    try {
      while (!signal.aborted && queue.length) {
        const items = queue.splice(0, 32);
        const options = { headers, signal: AbortSignal.any([signal, AbortSignal.timeout(4000)]), redirect: 'error' as const, credentials: 'omit' as const };
        const started = performance.now();
        try {
          if (batch.current) {
            try {
              await sendDesklineInputs({ items }, options);
            } catch (reason) {
              // A relay without batching: fall back to one event per request.
              if (typeof reason === 'object' && reason !== null && 'status' in reason && reason.status === 404) batch.current = false;
              else throw reason;
            }
          }
          if (!batch.current) for (const one of items) await sendDesklineInput(one, options);
          ping.current = Math.round(performance.now() - started);
          failures = 0;
        } catch (reason) {
          if (signal.aborted) return;
          const status = typeof reason === 'object' && reason !== null && 'status' in reason ? reason.status : undefined;
          if (status === 410) { finish('The session ended.', true); return; }
          // Drop the failed batch (replaying old clicks is worse) but keep the session.
          if (++failures >= 4) { finish('Remote input was interrupted. The session was stopped.'); return; }
          queue.unshift({ kind: 'release' });
          await sleep(250 * failures, signal);
        }
      }
    } finally {
      sending.current = false;
    }
  }

  function release() {
    pressed.current = null;
    if (control) void dispatch({ kind: 'release' });
  }

  const exitFull = useCallback(() => {
    keyboardApi()?.unlock?.();
    setLocked(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    setFull(false);
  }, []);

  async function enterFull() {
    const el = stage.current;
    if (!el) return;
    if (el.requestFullscreen && document.fullscreenEnabled) {
      try {
        await el.requestFullscreen({ navigationUI: 'hide' });
        setFull('native');
        // With the keyboard locked (Chrome and Edge), Esc and other system
        // keys go to the remote PC, and Ctrl+Esc leaves full screen.
        try { await keyboardApi()?.lock?.(); setLocked(!!keyboardApi()?.lock); } catch { setLocked(false); }
      } catch {
        setFull('window');
      }
    } else {
      setFull('window');
    }
    showToolbar();
    window.setTimeout(() => surface.current?.focus(), 50);
  }

  useEffect(() => {
    const changed = () => {
      if (!document.fullscreenElement) {
        keyboardApi()?.unlock?.();
        setLocked(false);
        setFull((f) => (f === 'native' ? false : f));
      }
    };
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);

  // Ctrl+Esc leaves full screen from anywhere on the page.
  useEffect(() => {
    if (!full) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && e.ctrlKey) {
        e.preventDefault();
        e.stopPropagation();
        exitFull();
      } else if (e.key === 'Escape' && full === 'window' && !control) {
        exitFull();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [full, control, exitFull]);

  function showToolbar() {
    setToolbar(true);
    window.clearTimeout(toolbarTimer.current);
    toolbarTimer.current = window.setTimeout(() => setToolbar(false), 2500);
  }

  function key(e: KeyboardEvent<HTMLCanvasElement>) {
    if (!control || e.nativeEvent.isComposing) return;
    if (e.key === 'Escape' && e.ctrlKey) return; // Handled above: leave full screen.
    // Outside full screen, Esc gives the keyboard back to this browser.
    if (e.key === 'Escape' && !full) { e.preventDefault(); release(); setControl(false); return; }
    if (e.key === 'Tab' && e.shiftKey && !full) return;
    if (!keys.test(e.key) && [...e.key].length !== 1) return;
    e.preventDefault();
    void dispatch({ kind: 'key', key: e.key, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey });
  }
  // Clicking a toolbar button must not take keyboard focus (and with it,
  // remote control) away from the remote screen.
  const keepFocus = (e: { preventDefault: () => void }) => e.preventDefault();

  function toggle() {
    if (control) { release(); setControl(false); }
    else { setControl(true); surface.current?.focus(); }
  }

  const exitHint = full === 'native' && !locked ? 'Esc or Ctrl+Esc exits full screen' : 'Ctrl+Esc exits full screen';
  const fit = size ? (full ? `min(100vw, calc(100dvh * ${size.w} / ${size.h}))` : `min(100%, calc(72dvh * ${size.w} / ${size.h}))`) : undefined;
  const statusLine = state !== 'live' ? 'Waiting for host approval' : preapproved ? 'Live · Pre-approved access' : 'Live · Host approved';

  const canvas = (
    <canvas
      ref={surface}
      aria-label="Live view of the host's primary Windows screen"
      role="img"
      tabIndex={0}
      style={{ width: fit, display: size ? 'block' : 'none' }}
      className={`rounded-sm outline-offset-4 ${full ? 'rounded-none outline-none' : ''} ${control ? 'touch-none cursor-default' : ''}`}
      onBlur={() => { if (!full) { release(); setControl(false); } }}
      onKeyDown={key}
      onContextMenu={(e) => { if (control) e.preventDefault(); }}
      onPointerDown={(e) => {
        if (!control || pressed.current !== null || e.button < 0 || e.button > 2) return;
        e.preventDefault();
        e.currentTarget.focus();
        e.currentTarget.setPointerCapture(e.pointerId);
        pressed.current = e.button;
        void dispatch({ kind: 'down', button: e.button, ...position(e) });
      }}
      onPointerMove={(e) => {
        if (!control || Date.now() - lastMove.current < 30) return;
        lastMove.current = Date.now();
        void dispatch({ kind: 'move', ...position(e) });
      }}
      onPointerUp={(e) => {
        const button = pressed.current;
        if (!control || button === null) return;
        pressed.current = null;
        void dispatch({ kind: 'up', button, ...position(e) });
      }}
      onPointerCancel={release}
      onLostPointerCapture={() => { if (pressed.current !== null) release(); }}
      onWheel={(e) => {
        if (!control || !e.deltaY || Date.now() - lastWheel.current < 40) return;
        lastWheel.current = Date.now();
        void dispatch({ kind: 'wheel', delta: e.deltaY > 0 ? -1 : 1, ...position(e) });
      }}
    />
  );

  const statsBadge = (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-background/10 px-2.5 py-1 font-mono text-[11px]" data-testid="text-stats" title="Frames per second · size of the last frame · input round trip">
      <Gauge className="h-3.5 w-3.5" /> {stats.fps} fps · {stats.kb} KB{stats.ping ? ` · ${stats.ping} ms` : ''}
    </span>
  );

  return (
    <main className="min-h-[100dvh] bg-background text-foreground">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-foreground/15 px-5 py-4 md:px-10">
        <div>
          <p className="text-lg font-bold">winss132r{name ? <span className="font-normal text-muted-foreground"> · {name}</span> : null}</p>
          <p role="status" className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">{statusLine}</p>
        </div>
        <button type="button" onClick={() => finish()} className="inline-flex items-center gap-2 rounded-lg border border-foreground/25 px-4 py-2 text-sm font-semibold hover:bg-foreground/10">
          <ArrowLeft size={16} /> {state === 'live' ? 'End session' : 'Cancel request'}
        </button>
      </header>

      {state === 'pending' ? (
        <section className="mx-auto max-w-xl px-5 py-16 text-center md:py-24">
          <ShieldCheck className="mx-auto text-primary" size={36} />
          <h1 className="mt-5 text-4xl font-bold tracking-tight">Verify with the host</h1>
          <p className="mx-auto mt-4 max-w-md text-muted-foreground">
            Read this number to the person at the Windows PC. They must type it into winss132r to approve the connection.
          </p>
          <div className="mt-7 rounded-xl bg-foreground px-3 py-6 text-background">
            <p className="font-mono text-xs uppercase tracking-widest text-background/65">Verification number</p>
            <p className="mt-2 font-mono text-4xl font-bold tracking-[0.15em]">{verification}</p>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">No screen or remote control is available until they approve.</p>
        </section>
      ) : null}

      <section className={`mx-auto max-w-[1600px] px-4 py-5 md:px-8 ${state === 'pending' ? 'hidden' : ''}`}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Remote desktop</h1>
            <p className="text-sm text-muted-foreground">{control ? 'Press Esc to release control in this browser.' : 'You are viewing without sending input.'}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!size} onMouseDown={keepFocus} onClick={() => void enterFull()} data-testid="button-fullscreen"
              className="inline-flex items-center gap-2 rounded-lg border border-foreground/25 px-4 py-2 text-sm font-semibold hover:bg-foreground/10 disabled:opacity-50">
              <Maximize size={16} /> Full screen
            </button>
            <button type="button" disabled={!size} aria-pressed={control} onClick={toggle} data-testid="button-control"
              className="inline-flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background disabled:opacity-50">
              <MousePointer2 size={16} /> {control ? 'Disable remote input' : 'Enable remote input'}
            </button>
          </div>
        </div>
        <div
          ref={stage}
          onPointerMove={() => { if (full) showToolbar(); }}
          className={full
            ? 'fixed inset-0 z-50 flex items-center justify-center bg-black text-white'
            : 'relative flex min-h-52 items-center justify-center rounded-xl bg-foreground p-2 text-background'}
          data-testid="remote-stage"
        >
          {canvas}
          {!size && (
            <div role="status" className="p-6 text-center">
              <Laptop className="mx-auto mb-2" size={28} />
              Waiting for the first screen frame…
            </div>
          )}
          {reconnecting && (
            <div role="status" className="absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-2 rounded-full bg-amber-500 px-4 py-1.5 text-sm font-semibold text-black shadow-lg">
              <WifiOff className="h-4 w-4" /> Connection unstable, reconnecting…
            </div>
          )}
          {full && (
            <div className={`absolute left-1/2 top-3 flex -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-2xl bg-black/75 px-3 py-2 text-sm text-white shadow-xl ring-1 ring-white/15 backdrop-blur transition-opacity duration-300 ${toolbar ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
              onPointerEnter={() => { window.clearTimeout(toolbarTimer.current); setToolbar(true); }}
              onPointerLeave={showToolbar}
              data-testid="fullscreen-toolbar">
              <span className="max-w-40 truncate font-semibold">{name || 'Remote PC'}</span>
              {statsBadge}
              <button type="button" aria-pressed={control} onMouseDown={keepFocus} onClick={toggle}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1 font-semibold ${control ? 'bg-primary text-primary-foreground' : 'bg-white/15 hover:bg-white/25'}`}>
                <MousePointer2 className="h-3.5 w-3.5" /> {control ? 'Input on' : 'Input off'}
              </button>
              <button type="button" onClick={exitFull} data-testid="button-exit-fullscreen"
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1 font-semibold hover:bg-white/25">
                <Minimize className="h-3.5 w-3.5" /> Exit <kbd className="ml-1 rounded bg-white/15 px-1 font-mono text-[10px]">Ctrl+Esc</kbd>
              </button>
              <span className="w-full text-center text-[11px] text-white/60">{exitHint}</span>
            </div>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          <p>Primary display only. At the Windows PC, press Ctrl+2 or F12 to stop sharing. In full screen, press Ctrl+Esc to exit.</p>
          <span className="rounded-full bg-foreground text-background">{statsBadge}</span>
        </div>
      </section>
    </main>
  );
}
