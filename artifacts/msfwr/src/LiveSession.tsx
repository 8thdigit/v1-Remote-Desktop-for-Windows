import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react';
import { ArrowLeft, Laptop, Maximize2, Minimize2, MousePointer2, ShieldCheck } from 'lucide-react';
import { LogoMark, Wordmark } from '@/components/logo';
import { BuddyPanel, useBuddyConfig } from '@/components/buddy-panel';
import { endMsfwr, getGetMsfwrFrameUrl, sendMsfwrInput, type MsfwrInput } from '@workspace/api-client-react';

type Props = { token: string; verification: string; preapproved?: boolean; onLeave: (message?: string) => void };
const keys = /^(Backspace|Tab|Enter|PageUp|PageDown|End|Home|Arrow(Left|Up|Right|Down)|Insert|Delete|F([1-9]|1[01]))$/;
const clamp = (n: number) => Math.max(0, Math.min(1, n));

function position(e: PointerEvent<HTMLImageElement> | WheelEvent<HTMLImageElement>) {
  const r = e.currentTarget.getBoundingClientRect();
  return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) };
}

export default function LiveSession({ token, verification, preapproved = false, onLeave }: Props) {
  const [state, setState] = useState<'pending' | 'live'>(preapproved ? 'live' : 'pending');
  const [frame, setFrame] = useState<string>();
  const [control, setControl] = useState(false);
  const leaveRef = useRef(onLeave);
  const stopRef = useRef(false);
  const stream = useRef<AbortController | null>(null);
  const input = useRef<MsfwrInput[]>([]);
  const sending = useRef(false);
  const surface = useRef<HTMLImageElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  // Full screen uses the browser's own full-screen mode where it exists, and
  // otherwise (iPhone Safari) fills the window.
  const [full, setFull] = useState(false);
  useEffect(() => {
    const sync = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, []);
  async function toggleFull() {
    if (document.fullscreenElement) { await document.exitFullscreen().catch(() => {}); return; }
    if (full) { setFull(false); return; }
    const el = stage.current;
    if (el?.requestFullscreen) {
      try { await el.requestFullscreen({ navigationUI: 'hide' }); return; } catch { /* fall back below */ }
    }
    setFull(true);
  }
  const lastMove = useRef(0);
  const lastWheel = useRef(0);
  const pressed = useRef<number | null>(null);
  const headers = { Authorization: `Bearer ${token}` };
  const buddy = useBuddyConfig(token, state === 'live');
  leaveRef.current = onLeave;

  function finish(message?: string, remoteAlreadyClosed = false) {
    if (stopRef.current) return;
    stopRef.current = true;
    stream.current?.abort();
    input.current = [];
    if (!remoteAlreadyClosed) void endMsfwr({ headers, keepalive: true }).catch(() => {});
    leaveRef.current(message);
  }
  const finishRef = useRef(finish);
  finishRef.current = finish;

  useEffect(() => {
    const controller = new AbortController();
    stream.current = controller;
    let timer = 0;
    let sequence = 0;
    let preview: string | undefined;
    // The generated URL helper supplies the endpoint. Use raw fetch so the
    // frame protocol keeps JPEGs out of React Query and preserves headers.
    async function poll() {
      try {
        const res = await fetch(getGetMsfwrFrameUrl({ after: sequence }), {
          headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
          credentials: 'omit', redirect: 'error',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(6500)]),
        });
        if (controller.signal.aborted) return;
        if (res.status === 410) {
          finishRef.current('The host ended the session, or it expired. Ask for a new code to reconnect.', true);
          return;
        }
        if (!res.ok) throw new Error('Frame request failed');
        const current = res.headers.get('X-Msfwr-State');
        if (current !== 'live' && current !== 'pending') throw new Error('Invalid relay response');
        setState(current);
        if (res.status === 200) {
          const nextSequence = Number(res.headers.get('X-Msfwr-Frame'));
          if (!Number.isSafeInteger(nextSequence) || nextSequence <= sequence ||
              res.headers.get('content-type')?.split(';')[0] !== 'image/jpeg') throw new Error('Invalid frame');
          const blob = await res.blob();
          if (controller.signal.aborted) return;
          if (preview) URL.revokeObjectURL(preview);
          preview = URL.createObjectURL(blob);
          setFrame(preview);
          sequence = nextSequence;
        }
        timer = window.setTimeout(poll, current === 'live' ? 150 : 650);
      } catch {
        if (!controller.signal.aborted) finishRef.current('The connection to the relay was lost. Start a new session to reconnect.');
      }
    }
    function pageExit() {
      controller.abort();
      void endMsfwr({ headers: { Authorization: `Bearer ${token}` }, keepalive: true }).catch(() => {});
    }
    void poll();
    window.addEventListener('pagehide', pageExit);
    return () => {
      controller.abort();
      clearTimeout(timer);
      if (preview) URL.revokeObjectURL(preview);
      window.removeEventListener('pagehide', pageExit);
    };
  }, [token]);

  async function dispatch(item: MsfwrInput) {
    const signal = stream.current?.signal;
    if (!signal || signal.aborted) return;
    const queue = input.current;
    if (item.kind === 'move' && queue.at(-1)?.kind === 'move') queue.pop();
    if (item.kind === 'release') {
      queue.length = 0;
    }
    if (queue.length >= 32) {
      finish('The input connection fell behind. The session was stopped.');
      return;
    }
    queue.push(item);
    if (sending.current) return;
    sending.current = true;
    try {
      while (!signal.aborted && queue.length) {
        await sendMsfwrInput(queue.shift()!, {
          headers, signal: AbortSignal.any([signal, AbortSignal.timeout(3000)]),
          redirect: 'error', credentials: 'omit',
        });
      }
    } catch {
      if (!signal.aborted) finish('Remote input was interrupted. The session was stopped.');
    } finally {
      sending.current = false;
    }
  }

  function release() {
    pressed.current = null;
    if (control) void dispatch({ kind: 'release' });
  }
  function key(e: KeyboardEvent<HTMLImageElement>) {
    if (!control || e.nativeEvent.isComposing) return;
    if (e.key === 'Escape') { e.preventDefault(); release(); setControl(false); return; }
    if (e.key === 'Tab' && e.shiftKey) return;
    if (!keys.test(e.key) && [...e.key].length !== 1) return;
    e.preventDefault();
    void dispatch({ kind: 'key', key: e.key, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey });
  }
  function toggle() {
    if (control) { release(); setControl(false); }
    else { setControl(true); surface.current?.focus(); }
  }

  return (
    <main className="min-h-[100dvh] bg-background text-foreground" data-fullscreen={full || undefined}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-foreground/15 px-5 py-4 md:px-10">
        <div>
          <div className="flex items-center gap-2"><LogoMark className="h-7 w-7" /><Wordmark /></div>
          <p role="status" className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            {state !== 'live' ? 'Waiting for host approval' : preapproved ? 'Live · Pre-approved access' : 'Live · Host approved'}
          </p>
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
            Read this number to the person at the Windows PC. They must type it into WINRSS.net to approve the connection.
          </p>
          <div className="mt-7 rounded-xl bg-foreground px-3 py-6 text-background">
            <p className="font-mono text-xs uppercase tracking-widest text-background/65">Verification number</p>
            <p className="mt-2 font-mono text-4xl font-bold tracking-[0.15em]">{verification}</p>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">No screen or remote control is available until they approve.</p>
        </section>
      ) : (
        <section className="mx-auto max-w-7xl px-4 py-5 md:px-8">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold">Remote desktop</h1>
              <p className="text-sm text-muted-foreground">{control ? 'Press Esc to release control in this browser.' : 'You are viewing without sending input.'}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={!frame} onClick={() => void toggleFull()} data-testid="button-fullscreen"
                className="inline-flex items-center gap-2 rounded-lg border border-foreground/25 px-4 py-2 text-sm font-semibold hover:bg-foreground/10 disabled:opacity-50">
                <Maximize2 size={16} /> Full screen
              </button>
              <button type="button" disabled={!frame} aria-pressed={control} onClick={toggle} className="inline-flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background disabled:opacity-50">
                <MousePointer2 size={16} /> {control ? 'Disable remote input' : 'Enable remote input'}
              </button>
            </div>
          </div>
          <div className={buddy ? 'grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]' : undefined}>
          <div ref={stage}
            className={full
              ? 'fixed inset-0 z-50 flex items-center justify-center bg-black text-background'
              : 'flex min-h-52 items-center justify-center rounded-xl bg-foreground p-2 text-background'}>
            {full && (
              <div className="absolute right-3 top-3 z-10 flex gap-2 opacity-70 transition-opacity hover:opacity-100">
                <button type="button" aria-pressed={control} onClick={toggle} data-testid="button-fullscreen-input"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur hover:bg-white/25">
                  <MousePointer2 size={14} /> {control ? 'Input on' : 'Input off'}
                </button>
                <button type="button" onClick={() => void toggleFull()} data-testid="button-exit-fullscreen"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur hover:bg-white/25">
                  <Minimize2 size={14} /> Exit full screen
                </button>
              </div>
            )}
            {frame ? (
              <img
                ref={surface}
                src={frame}
                alt="Live view of the host's primary Windows screen"
                tabIndex={0}
                draggable={false}
                className={`block ${full ? 'max-h-[100dvh] max-w-[100vw] object-contain' : 'max-h-[72dvh] max-w-full rounded-sm outline-offset-4'} ${control ? 'touch-none cursor-default' : ''}`}
                onBlur={() => { release(); setControl(false); }}
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
                  if (!control || Date.now() - lastMove.current < 90) return;
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
                  if (!control || !e.deltaY || Date.now() - lastWheel.current < 120) return;
                  lastWheel.current = Date.now();
                  void dispatch({ kind: 'wheel', delta: e.deltaY > 0 ? -1 : 1, ...position(e) });
                }}
              />
            ) : (
              <div role="status" className="p-6 text-center">
                <Laptop className="mx-auto mb-2" size={28} />
                Waiting for the first screen frame…
              </div>
            )}
          </div>
          {buddy && <BuddyPanel token={token} frame={frame} config={buddy} />}
          </div>
          <p className="mt-3 text-sm text-muted-foreground">Primary display only. At the Windows PC, press Ctrl+2 or F12 to stop sharing.</p>
        </section>
      )}
    </main>
  );
}
