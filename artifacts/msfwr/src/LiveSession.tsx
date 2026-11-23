import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react';
import { ArrowLeft, Laptop, Maximize2, Minimize2, MousePointer2, ShieldCheck } from 'lucide-react';
import { LogoMark, Wordmark } from '@/components/logo';
import { BuddyPanel, useBuddyConfig } from '@/components/buddy-panel';
import { endMsfwr, getGetMsfwrFrameUrl, getSendMsfwrInputUrl, sendMsfwrInput, type MsfwrInput } from '@workspace/api-client-react';

type Props = { token: string; verification: string; preapproved?: boolean; onLeave: (message?: string) => void };
const keys = /^(Backspace|Tab|Enter|PageUp|PageDown|End|Home|Arrow(Left|Up|Right|Down)|Insert|Delete|F([1-9]|1[01]))$/;
const clamp = (n: number) => Math.max(0, Math.min(1, n));

// One screen update from the relay: a keyframe (the whole screen) or a patch
// (the JPEG of a region at x, y). See encodeFrames in the relay.
type Update = { sequence: number; key: boolean; x: number; y: number; jpeg: Blob };
function parseUpdates(buffer: ArrayBuffer): Update[] {
  const view = new DataView(buffer);
  const out: Update[] = [];
  let at = 0;
  while (at < buffer.byteLength) {
    if (buffer.byteLength - at < 13) throw new Error('Invalid frame');
    const length = view.getUint32(at + 9);
    if (length > buffer.byteLength - at - 13) throw new Error('Invalid frame');
    out.push({
      sequence: view.getUint32(at), key: view.getUint8(at + 4) === 0,
      x: view.getUint16(at + 5), y: view.getUint16(at + 7),
      jpeg: new Blob([buffer.slice(at + 13, at + 13 + length)], { type: 'image/jpeg' }),
    });
    at += 13 + length;
  }
  return out;
}

// Records of the streaming channel (/frame?v=3): keyframes (kind 0) and
// patches (1) as in parseUpdates, the session state as text (2, also sent as
// a heartbeat) and "this stream ends; open the next one" (3).
type StreamRecord = { sequence: number; kind: number; x: number; y: number; data: Uint8Array };
function takeRecords(buffer: Uint8Array): [StreamRecord[], Uint8Array] {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const out: StreamRecord[] = [];
  let at = 0;
  while (buffer.byteLength - at >= 13) {
    const length = view.getUint32(at + 9);
    if (length > 64 * 1024 * 1024) throw new Error('Invalid frame');
    if (buffer.byteLength - at - 13 < length) break;
    out.push({
      sequence: view.getUint32(at), kind: view.getUint8(at + 4),
      x: view.getUint16(at + 5), y: view.getUint16(at + 7),
      data: buffer.subarray(at + 13, at + 13 + length),
    });
    at += 13 + length;
  }
  return [out, buffer.slice(at)];
}
function joinBytes(a: Uint8Array, b: Uint8Array) {
  if (!a.byteLength) return b;
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(a);
  out.set(b, a.byteLength);
  return out;
}

// Picture quality the viewer asks the PC for (newer PC apps): sharp keeps the
// PC's native resolution with high JPEG quality, balanced caps it at 1920
// pixels wide, fast at 1280 with lower quality for slow links.
type Quality = 'sharp' | 'balanced' | 'fast';
const qualityLabels: Record<Quality, string> = { sharp: 'Sharp', balanced: 'Balanced', fast: 'Fast' };
function savedQuality(): Quality {
  try {
    const v = localStorage.getItem('winrss.quality');
    if (v === 'sharp' || v === 'balanced' || v === 'fast') return v;
  } catch { /* storage blocked */ }
  return 'balanced';
}

// Where the pointer is on the remote screen, from 0 to 1. The canvas keeps
// the screen's aspect ratio inside its box (object-fit: contain), so the
// letterbox around the picture is left out.
function position(e: PointerEvent<HTMLCanvasElement> | WheelEvent<HTMLCanvasElement>) {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  const scale = Math.min(r.width / (el.width || 1), r.height / (el.height || 1));
  const w = (el.width || 1) * scale, h = (el.height || 1) * scale;
  const left = r.left + (r.width - w) / 2, top = r.top + (r.height - h) / 2;
  return { x: clamp((e.clientX - left) / w), y: clamp((e.clientY - top) / h) };
}

export default function LiveSession({ token, verification, preapproved = false, onLeave }: Props) {
  const [state, setState] = useState<'pending' | 'live'>(preapproved ? 'live' : 'pending');
  const [frame, setFrame] = useState(false);
  const [control, setControl] = useState(false);
  const leaveRef = useRef(onLeave);
  const stopRef = useRef(false);
  const stream = useRef<AbortController | null>(null);
  const input = useRef<MsfwrInput[]>([]);
  const sending = useRef(false);
  // The relay takes several input actions in one request (it says so on
  // its frame replies).
  const batching = useRef(false);
  // The relay streams the screen and takes numbered input requests, so two
  // can be in flight at once.
  const ordered = useRef(false);
  const inputSeq = useRef(0);
  const inFlight = useRef(0);
  const [quality, setQuality] = useState<Quality>(savedQuality);
  const qualityRef = useRef(quality);
  qualityRef.current = quality;
  // Fit the screen to the window, or show it pixel for pixel (scrolling).
  const [actual, setActual] = useState(false);
  const [size, setSize] = useState<{ w: number; h: number }>();
  const [fps, setFps] = useState(0);
  const surface = useRef<HTMLCanvasElement | null>(null);
  // The screen is composed here (keyframe, then patches) and copied to the
  // visible canvas, which can mount after the first frame arrives.
  const screen = useRef<HTMLCanvasElement | null>(null);
  const showScreen = useCallback((el: HTMLCanvasElement | null) => {
    surface.current = el;
    const from = screen.current;
    if (!el || !from) return;
    el.width = from.width;
    el.height = from.height;
    el.getContext('2d', { alpha: false })?.drawImage(from, 0, 0);
  }, []);
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
  // The AI Buddy reads still images of the screen. The screen is composed on
  // a canvas, so it gets a JPEG snapshot of it, at most once a second, and
  // only while it is on.
  const [snapshot, setSnapshot] = useState<string>();
  const wantSnapshot = useRef(false);
  wantSnapshot.current = !!buddy;
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
    let sequence = 0;
    let snapAt = 0;
    let snapTimer = 0;
    let snapUrl: string | undefined;
    const buffer = document.createElement('canvas');
    screen.current = buffer;
    const paint = buffer.getContext('2d', { alpha: false });
    let frames = 0;
    const counter = window.setInterval(() => { setFps(frames); frames = 0; }, 1000);
    // Draws decoded updates in order on the buffer and the visible canvas.
    function draw(updates: { key: boolean; x: number; y: number; image: ImageBitmap }[]) {
      const shown = surface.current;
      const visible = shown?.getContext('2d', { alpha: false });
      frames += 1;
      for (const { key, x, y, image } of updates) {
        if (key && (buffer.width !== image.width || buffer.height !== image.height)) {
          buffer.width = image.width;
          buffer.height = image.height;
          if (shown) { shown.width = image.width; shown.height = image.height; }
          setSize({ w: image.width, h: image.height });
        }
        paint?.drawImage(image, x, y);
        visible?.drawImage(image, x, y);
        image.close();
      }
    }
    // Takes a snapshot for the AI Buddy now, or when a second has passed
    // since the last one, so the settled screen is always captured.
    function snap() {
      if (!wantSnapshot.current || snapTimer) return;
      snapTimer = window.setTimeout(() => {
        snapTimer = 0;
        snapAt = Date.now();
        buffer.toBlob((blob) => {
          if (!blob || controller.signal.aborted) return;
          if (snapUrl) URL.revokeObjectURL(snapUrl);
          snapUrl = URL.createObjectURL(blob);
          setSnapshot(snapUrl);
        }, 'image/jpeg', 0.9);
      }, Math.max(0, 1000 - (Date.now() - snapAt)));
    }
    // Decodes updates off the main thread, all at once, then draws them in
    // order.
    async function show(updates: Update[]) {
      if (!updates.length) return;
      if (!updates[0].key && !sequence) throw new Error('Invalid frame');
      const images = await Promise.all(updates.map(async (u) => ({ ...u, image: await createImageBitmap(u.jpeg) })));
      if (controller.signal.aborted) { images.forEach((u) => u.image.close()); return; }
      draw(images);
      setFrame(true);
      snap();
      sequence = updates.at(-1)!.sequence;
    }
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    // One streaming request: the relay writes each screen update the moment
    // the PC uploads it, so nothing waits for the viewer to ask again. It
    // closes after about 25 seconds and the next one opens. Returns
    // "fallback" when the relay (or a proxy) cannot stream.
    async function streamOnce(): Promise<'again' | 'fallback' | 'done'> {
      const watchdog = new AbortController();
      let timer = 0;
      const arm = (ms: number) => { clearTimeout(timer); timer = window.setTimeout(() => watchdog.abort(), ms); };
      let gotRecord = false;
      arm(5000);
      try {
        const res = await fetch(`/api/msfwr/frame?after=${sequence}&v=3`, {
          headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', credentials: 'omit', redirect: 'error',
          signal: AbortSignal.any([controller.signal, watchdog.signal]),
        });
        if (res.status === 410) {
          finishRef.current('The host ended the session, or it expired. Ask for a new code to reconnect.', true);
          return 'done';
        }
        if (!res.ok || res.headers.get('X-Msfwr-Stream') !== '1' || !res.body) {
          void res.body?.cancel().catch(() => {});
          return res.ok || res.status === 400 || res.status === 404 ? 'fallback' : 'again';
        }
        ordered.current = true;
        batching.current = true;
        const reader = res.body.getReader();
        let pending: Uint8Array = new Uint8Array(0);
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return gotRecord ? 'again' : 'fallback';
          arm(8000);
          const [records, rest] = takeRecords(joinBytes(pending, value));
          pending = rest;
          const updates: Update[] = [];
          for (const r of records) {
            gotRecord = true;
            if (r.kind === 2) {
              const current = new TextDecoder().decode(r.data);
              if (current === 'ended') {
                finishRef.current('The host ended the session, or it expired. Ask for a new code to reconnect.', true);
                return 'done';
              }
              if (current === 'live' || current === 'pending') setState(current);
            } else if (r.kind <= 1 && r.sequence > (updates.at(-1)?.sequence ?? sequence)) {
              updates.push({ sequence: r.sequence, key: r.kind === 0, x: r.x, y: r.y, jpeg: new Blob([r.data as BlobPart], { type: 'image/jpeg' }) });
            }
          }
          // A keyframe makes everything before it in this batch moot.
          const lastKey = updates.findLastIndex((u) => u.key);
          await show(lastKey > 0 ? updates.slice(lastKey) : updates);
          if (controller.signal.aborted) return 'done';
        }
      } catch (error) {
        if (controller.signal.aborted) return 'done';
        // Nothing arrived in time: a proxy is holding the stream back.
        if (watchdog.signal.aborted) return gotRecord ? 'again' : 'fallback';
        throw error;
      } finally {
        clearTimeout(timer);
        watchdog.abort();
      }
    }
    // Long polling, for relays that cannot stream: the relay answers as soon
    // as the screen changes, and the next request goes out at once. A relay
    // without long polling answers at once; those are paced at 150 ms.
    async function pollOnce() {
      const asked = Date.now();
      const res = await fetch(getGetMsfwrFrameUrl({ after: sequence, v: 2, wait: 4000 }), {
        headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
        credentials: 'omit', redirect: 'error',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]),
      });
      if (controller.signal.aborted) return;
      if (res.status === 410) {
        finishRef.current('The host ended the session, or it expired. Ask for a new code to reconnect.', true);
        return;
      }
      if (!res.ok) throw new Error('Frame request failed');
      const current = res.headers.get('X-Msfwr-State');
      if (current !== 'live' && current !== 'pending') throw new Error('Invalid relay response');
      const held = res.headers.get('X-Msfwr-Batch') === '1';
      batching.current = held;
      setState(current);
      if (res.status === 200) {
        const nextSequence = Number(res.headers.get('X-Msfwr-Frame'));
        const type = res.headers.get('content-type')?.split(';')[0];
        if (!Number.isSafeInteger(nextSequence) || nextSequence <= sequence ||
            (type !== 'image/jpeg' && type !== 'application/x-msfwr-frames')) throw new Error('Invalid frame');
        const updates = type === 'image/jpeg'
          ? [{ sequence: nextSequence, key: true, x: 0, y: 0, jpeg: await res.blob() }]
          : parseUpdates(await res.arrayBuffer());
        if (!updates.length) throw new Error('Invalid frame');
        await show(updates);
        sequence = nextSequence;
      }
      if (!held || current !== 'live') {
        const pause = (current === 'live' ? 150 : 650) - (Date.now() - asked);
        if (pause > 0) await sleep(pause);
      }
    }
    async function poll() {
      let streaming = true;
      let failures = 0;
      while (!controller.signal.aborted) {
        try {
          if (streaming) {
            const result = await streamOnce();
            if (result === 'done') return;
            if (result === 'fallback') { streaming = false; ordered.current = false; }
          } else {
            await pollOnce();
          }
          failures = 0;
        } catch (error) {
          // A dropped connection is retried a few times before giving up.
          if (controller.signal.aborted) return;
          failures += 1;
          if (failures > 5) throw error;
          await sleep(250 * failures);
        }
      }
    }
    function pageExit() {
      controller.abort();
      void endMsfwr({ headers: { Authorization: `Bearer ${token}` }, keepalive: true }).catch(() => {});
    }
    poll().catch(() => {
      if (!controller.signal.aborted) finishRef.current('The connection to the relay was lost. Start a new session to reconnect.');
    });
    window.addEventListener('pagehide', pageExit);
    return () => {
      controller.abort();
      clearInterval(counter);
      screen.current = null;
      clearTimeout(snapTimer);
      if (snapUrl) URL.revokeObjectURL(snapUrl);
      window.removeEventListener('pagehide', pageExit);
    };
  }, [token]);

  function dispatch(item: MsfwrInput) {
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
    pump();
  }
  // Sends queued input. Everything queued while a request is out goes in the
  // next one. A relay that orders numbered requests takes two at once, so
  // input never waits a whole round trip behind the previous request.
  function pump() {
    const signal = stream.current?.signal;
    const queue = input.current;
    if (!signal || signal.aborted) return;
    const limit = ordered.current ? 2 : 1;
    while (queue.length && inFlight.current < limit) {
      const options = { headers, signal: AbortSignal.any([signal, AbortSignal.timeout(4000)]), redirect: 'error' as const, credentials: 'omit' as const };
      let request: Promise<unknown>;
      if (ordered.current) {
        const items = queue.splice(0, 32);
        inputSeq.current += 1;
        request = fetch(getSendMsfwrInputUrl(), {
          ...options, method: 'POST', cache: 'no-store',
          headers: { ...headers, 'Content-Type': 'application/json', 'X-Msfwr-Seq': String(inputSeq.current) }, body: JSON.stringify(items),
        }).then((res) => { if (!res.ok) throw new Error('Input request failed'); });
      } else if (batching.current && queue.length > 1) {
        const items = queue.splice(0, 32);
        request = fetch(getSendMsfwrInputUrl(), {
          ...options, method: 'POST', cache: 'no-store',
          headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(items),
        }).then((res) => { if (!res.ok) throw new Error('Input request failed'); });
      } else {
        request = sendMsfwrInput(queue.shift()!, options);
      }
      inFlight.current += 1;
      sending.current = true;
      request.then(() => {
        inFlight.current -= 1;
        sending.current = inFlight.current > 0;
        pump();
      }, () => {
        inFlight.current -= 1;
        if (!signal.aborted) finish('Remote input was interrupted. The session was stopped.');
      });
    }
  }
  // Asks the PC for a picture quality. Older relays and PC apps ignore it.
  function chooseQuality(next: Quality) {
    setQuality(next);
    try { localStorage.setItem('winrss.quality', next); } catch { /* storage blocked */ }
    void fetch('/api/msfwr/view', {
      method: 'POST', cache: 'no-store', credentials: 'omit', redirect: 'error',
      headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ quality: next }),
    }).catch(() => {});
  }
  // Tells the PC the saved quality once the session is live.
  useEffect(() => {
    if (state !== 'live') return;
    void fetch('/api/msfwr/view', {
      method: 'POST', cache: 'no-store', credentials: 'omit', redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ quality: qualityRef.current }),
    }).catch(() => {});
  }, [state, token]);

  function release() {
    pressed.current = null;
    if (control) void dispatch({ kind: 'release' });
  }
  function key(e: KeyboardEvent<HTMLCanvasElement>) {
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
        <section className="mx-auto max-w-screen-2xl px-4 py-5 md:px-8">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold">Remote desktop</h1>
              <p className="text-sm text-muted-foreground">{control ? 'Press Esc to release control in this browser.' : 'You are viewing without sending input.'}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div role="group" aria-label="Picture quality" className="inline-flex overflow-hidden rounded-lg border border-foreground/25 text-sm font-semibold">
                {(['sharp', 'balanced', 'fast'] as Quality[]).map((q) => (
                  <button key={q} type="button" aria-pressed={quality === q} onClick={() => chooseQuality(q)} data-testid={`button-quality-${q}`}
                    title={q === 'sharp' ? 'Full resolution, best for reading text' : q === 'fast' ? 'Lower resolution for slow connections' : 'Up to 1920 pixels wide'}
                    className={`px-3 py-2 ${quality === q ? 'bg-foreground text-background' : 'hover:bg-foreground/10'}`}>
                    {qualityLabels[q]}
                  </button>
                ))}
              </div>
              <button type="button" disabled={!frame} aria-pressed={actual} onClick={() => setActual((a) => !a)} data-testid="button-actual-size"
                title={actual ? 'Fit the screen to the window' : 'Show the screen pixel for pixel'}
                className="inline-flex items-center gap-2 rounded-lg border border-foreground/25 px-4 py-2 text-sm font-semibold hover:bg-foreground/10 disabled:opacity-50">
                {actual ? 'Fit' : '100%'}
              </button>
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
              ? `fixed inset-0 z-50 flex bg-black text-background ${actual ? 'overflow-auto' : 'items-center justify-center'}`
              : `flex min-h-52 rounded-xl bg-foreground p-2 text-background ${actual ? 'max-h-[80dvh] overflow-auto' : 'items-center justify-center'}`}>
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
              <canvas
                ref={showScreen}
                role="img"
                aria-label="Live view of the host's primary Windows screen"
                tabIndex={0}
                draggable={false}
                // 100%: one screen pixel per device pixel, so text is as
                // crisp as on the PC. Fit: scaled into the window.
                style={actual && size ? { width: size.w / (window.devicePixelRatio || 1), height: size.h / (window.devicePixelRatio || 1), maxWidth: 'none', flex: 'none' } : undefined}
                className={`block ${actual ? 'm-auto' : full ? 'h-[100dvh] w-[100vw] object-contain' : 'max-h-[78dvh] max-w-full rounded-sm outline-offset-4'} ${control ? 'touch-none cursor-default' : ''}`}
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
                  if (!control || Date.now() - lastMove.current < 16) return;
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
                  if (!control || !e.deltaY || Date.now() - lastWheel.current < 60) return;
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
          {buddy && <BuddyPanel token={token} frame={snapshot} config={buddy} />}
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Primary display only. At the Windows PC, press Ctrl+2 or F12 to stop sharing.
            {frame && size && <span className="ml-2 font-mono text-xs" data-testid="text-stream-stats">{size.w}×{size.h} · {fps} updates/s</span>}
          </p>
        </section>
      )}
    </main>
  );
}
