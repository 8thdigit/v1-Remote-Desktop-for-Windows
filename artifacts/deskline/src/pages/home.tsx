import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { listDesklineCalls, useJoinDeskline } from '@workspace/api-client-react';
import { Link } from 'wouter';
import {
  ArrowRight, Bell, BellOff, BellRing, Check, Clock, Copy, Download, Eye, EyeOff, History, Laptop, Monitor,
  Pencil, Plus, Radio, ShieldCheck, Trash2, UserRound, Volume2, VolumeX, X,
} from 'lucide-react';
import LiveSession from '@/LiveSession';
import {
  HEX, MAX_PCS, loadPCs, loadRequests, mergeCalls, relativeTime, setRequestStatus, storePCs, storeRequests,
  type RequestEntry, type RequestStatus, type SavedPC,
} from '@/lib/unattended';

type Session = { token: string; verification: string; preapproved: boolean; code: string };
type Presence = 'online' | 'busy' | 'offline' | 'unknown';
type Tab = 'connect' | 'pcs' | 'download';

const CALL_TTL = 2 * 60_000;
const TAB_KEY = 'winss132r.tab';
const SOUND_KEY = 'winss132r.sound';

function formatCode(raw: string) {
  return raw.toUpperCase().replace(/[^A-F0-9]/g, '').slice(0, 12);
}
function groups(code: string) {
  return [code.slice(0, 4), code.slice(4, 8), code.slice(8, 12)];
}
const dashed = (code: string) => groups(code).join('-');
const masked = (code: string) => `${code.slice(0, 4)}-••••-${code.slice(8, 12)}`;
const pcTitle = (pc: Pick<SavedPC, 'label' | 'name'> | undefined, fallback = 'Unattended PC') => pc?.label || pc?.name || fallback;

function readPref(key: string, fallback: string) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function writePref(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* private window */ }
}

// A short two-tone chime for a new Initiate request.
function chime() {
  try {
    const ctx = new AudioContext();
    [880, 1320].forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = f;
      osc.type = 'sine';
      const t = ctx.currentTime + i * 0.16;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.3);
    });
    window.setTimeout(() => void ctx.close(), 800);
  } catch { /* audio blocked until the page is used */ }
}

export default function Home() {
  const join = useJoinDeskline();
  const [session, setSession] = useState<Session | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pcs, setPCs] = useState<SavedPC[]>(loadPCs);
  const [requests, setRequests] = useState<RequestEntry[]>(loadRequests);
  const [presence, setPresence] = useState<Record<string, Presence>>({});
  const [presenceSupported, setPresenceSupported] = useState(true);
  const [relayReachable, setRelayReachable] = useState<boolean | null>(null);
  const [tab, setTabState] = useState<Tab>(() => {
    const saved = readPref(TAB_KEY, '');
    if (saved === 'connect' || saved === 'pcs' || saved === 'download') return saved;
    return loadPCs().length ? 'pcs' : 'connect';
  });
  const [sound, setSound] = useState(() => readPref(SOUND_KEY, 'on') === 'on');
  const [alerts, setAlerts] = useState<NotificationPermission | 'unsupported'>(
    () => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission));
  const [now, setNow] = useState(Date.now);
  const relay = typeof window !== 'undefined' && window.location.protocol === 'https:' ? window.location.origin : '';
  // Served from the latest GitHub release, published by .github/workflows/release.yml.
  const installer = 'https://github.com/mailbhrp-1/Remote-Desktop-for-Windows/releases/latest/download/winss132r-Setup-x64.exe';

  // Refs hold the latest lists so updates compose synchronously across polls.
  const pcsRef = useRef(pcs);
  const requestsRef = useRef(requests);
  const soundRef = useRef(sound);
  soundRef.current = sound;

  function setTab(next: Tab) {
    setTabState(next);
    writePref(TAB_KEY, next);
  }

  const updatePCs = useCallback((update: (list: SavedPC[]) => SavedPC[]) => {
    const next = update(pcsRef.current);
    pcsRef.current = next;
    storePCs(next);
    setPCs(next);
  }, []);
  const updateRequests = useCallback((update: (list: RequestEntry[]) => RequestEntry[]) => {
    const list = requestsRef.current;
    const next = update(list);
    if (next === list) return;
    requestsRef.current = next;
    storeRequests(next);
    setRequests(next);
  }, []);

  const waiting = useMemo(() => requests.filter((r) => r.open && r.status === 'waiting'), [requests]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (session) { document.title = 'winss132r — Connected session'; return; }
    document.title = waiting.length
      ? `(${waiting.length}) Request${waiting.length > 1 ? 's' : ''} to connect — winss132r`
      : 'winss132r — Remote support for Windows';
  }, [session, waiting.length]);

  // Poll the relay for Initiate requests and presence of the saved PCs. It
  // keeps polling (more slowly) while the tab is hidden so a request can
  // still raise a desktop alert.
  const codesKey = pcs.map((p) => p.code).join(',');
  useEffect(() => {
    const codes = codesKey ? codesKey.split(',') : [];
    // While a session is open, polling pauses and the history is left as is.
    if (session) return;
    if (!relay || codes.length === 0) {
      updateRequests((list) => mergeCalls(list, []).list);
      return;
    }
    let stopped = false;
    let timer = 0;
    async function check() {
      try {
        const result = await listDesklineCalls({ codes });
        if (stopped) return;
        setRelayReachable(true);
        const calls = result.calls.filter((c) => codes.includes(c.code));
        if (result.presence) {
          const map: Record<string, Presence> = {};
          for (const c of codes) map[c] = 'offline';
          for (const p of result.presence) if (codes.includes(p.code)) map[p.code] = p.state;
          setPresence(map);
          setPresenceSupported(true);
          // Learn PC names the hosts report.
          const names = new Map(result.presence.filter((p) => p.name).map((p) => [p.code, p.name]));
          for (const c of calls) if (c.name) names.set(c.code, c.name);
          if ([...names].some(([c, n]) => pcsRef.current.find((p) => p.code === c)?.name !== n)) {
            updatePCs((list) => list.map((p) => (names.has(p.code) ? { ...p, name: names.get(p.code)! } : p)));
          }
        } else {
          setPresenceSupported(false);
        }
        const { list: merged, fresh } = mergeCalls(requestsRef.current, calls);
        updateRequests(() => merged);
        if (fresh.length) {
          const at = Date.now();
          updatePCs((list) => list.map((p) => (fresh.some((f) => f.code === p.code) ? { ...p, lastRequestAt: at } : p)));
          if (soundRef.current) chime();
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
            for (const f of fresh) {
              const pc = pcsRef.current.find((p) => p.code === f.code);
              try {
                const n = new Notification(`${pcTitle(pc, f.name || 'An unattended PC')} is asking you to connect`, {
                  body: 'Open winss132r and select Accept to start the session.', tag: `winss132r-${f.code}`,
                });
                n.onclick = () => { window.focus(); n.close(); };
              } catch { /* notifications unavailable */ }
            }
          }
        }
      } catch {
        if (!stopped) setRelayReachable(false);
      }
      if (!stopped) timer = window.setTimeout(check, document.visibilityState === 'visible' ? 3000 : 8000);
    }
    void check();
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [session, relay, codesKey, updatePCs, updateRequests]);

  async function connect(value: string, fromRequest = false) {
    setError(null);
    setNotice(null);
    if (!relay) {
      setError('Open winss132r at its HTTPS address before connecting.');
      return false;
    }
    try {
      const viewer = await join.mutateAsync({ data: { code: value } });
      if (fromRequest) updateRequests((list) => setRequestStatus(list, value, 'accepted'));
      if (viewer.preapproved) {
        // Remember unattended PCs automatically so their Initiate requests
        // show up here next time.
        const at = Date.now();
        updatePCs((list) => (list.some((p) => p.code === value)
          ? list.map((p) => (p.code === value ? { ...p, lastConnectedAt: at } : p))
          : [{ code: value, name: '', addedAt: at, lastConnectedAt: at }, ...list].slice(0, MAX_PCS)));
      }
      setSession({ token: viewer.token, verification: viewer.verification, preapproved: viewer.preapproved, code: value });
      setCode('');
      return true;
    } catch (reason) {
      const status = typeof reason === 'object' && reason !== null && 'status' in reason ? reason.status : undefined;
      setError(status === 429 ? 'The relay is busy. Wait a minute, then try again.' :
        status === 404 || status === 400 ? (fromRequest || pcs.some((p) => p.code === value)
          ? 'That PC is not available right now. It may be offline, locked, or already in a session.'
          : 'That code was not accepted. Check it against the Windows PC or ask for a fresh code.') :
          'Could not reach the relay. Check your connection and try again.');
      return false;
    }
  }

  function dismiss(code: string) {
    updateRequests((list) => setRequestStatus(list, code, 'dismissed'));
  }

  function savePC(value: string, label: string) {
    if (!HEX.test(value)) return 'Access codes are 12 characters, using only 0-9 and A-F.';
    if (pcs.some((p) => p.code === value)) return 'That PC is already saved.';
    if (pcs.length >= MAX_PCS) return `You can save up to ${MAX_PCS} PCs.`;
    updatePCs((list) => [{ code: value, name: '', label: label.trim().slice(0, 48) || undefined, addedAt: Date.now() }, ...list]);
    return null;
  }

  async function enableAlerts() {
    if (typeof Notification === 'undefined') return;
    try { setAlerts(await Notification.requestPermission()); } catch { /* ignored */ }
  }

  if (session) {
    return (
      <LiveSession
        token={session.token}
        verification={session.verification}
        preapproved={session.preapproved}
        onLeave={(message) => {
          setSession(null);
          setNotice(message ?? 'Session ended. The helper is no longer connected.');
        }}
      />
    );
  }

  const onlineCount = pcs.filter((p) => presence[p.code] === 'online' || presence[p.code] === 'busy').length;

  return (
    <div className="dl-shell min-h-[100dvh] text-foreground">
      <header className="sticky top-0 z-30 border-b border-foreground/10 bg-background/75 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3 md:px-8">
          <div className="flex items-center gap-2.5" data-testid="text-brand">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-foreground text-background shadow-sm">
              <Radio className="h-4.5 w-4.5 text-primary" />
            </span>
            <div className="leading-tight">
              <span className="block text-lg font-bold tracking-tight">winss132r</span>
              <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Remote support · Windows</span>
            </div>
          </div>
          <nav aria-label="Sections" className="order-3 flex w-full gap-1 rounded-xl bg-muted/80 p-1 sm:order-none sm:ml-auto sm:w-auto">
            <TabButton active={tab === 'connect'} onClick={() => setTab('connect')} testId="tab-connect">Connect</TabButton>
            <TabButton active={tab === 'pcs'} onClick={() => setTab('pcs')} testId="tab-pcs">
              Unattended PCs
              {waiting.length > 0
                ? <span className="ml-1.5 rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground">{waiting.length}</span>
                : pcs.length > 0 && <span className="ml-1.5 rounded-full bg-foreground/10 px-1.5 text-[11px] font-semibold">{pcs.length}</span>}
            </TabButton>
            <TabButton active={tab === 'download'} onClick={() => setTab('download')} testId="tab-download">Get the app</TabButton>
          </nav>
          <RelayDot reachable={relay ? relayReachable : false} watching={pcs.length > 0} />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-16 pt-6 md:px-8 md:pt-8">
        {waiting.length > 0 && (
          <section aria-label="Incoming requests" className="mb-6 space-y-3">
            {waiting.map((r) => {
              const pc = pcs.find((p) => p.code === r.code);
              const left = Math.max(0, CALL_TTL - (now - r.at));
              return (
                <div key={r.id} role="alert" data-testid={`call-${r.code}`}
                  className="dl-rise relative overflow-hidden rounded-2xl border border-primary/40 bg-card shadow-[0_18px_40px_-24px_hsl(14_78%_40%/0.55)]">
                  <div className="flex flex-wrap items-center gap-4 p-4 md:p-5">
                    <span className="relative grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary/12 text-primary">
                      <span className="dl-ping absolute inset-0 rounded-2xl ring-2 ring-primary/50" />
                      <BellRing className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-[11px] uppercase tracking-widest text-primary">Incoming request · {relativeTime(r.at, now)}</p>
                      <p className="mt-0.5 truncate text-lg font-bold">{pcTitle(pc, r.name || 'An unattended PC')} is asking you to connect</p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {pc?.label && r.name ? `${r.name} · ` : ''}Access code {masked(r.code)}
                      </p>
                    </div>
                    <div className="flex w-full gap-2 sm:w-auto">
                      <button type="button" onClick={() => dismiss(r.code)} data-testid={`button-dismiss-${r.code}`}
                        className="flex-1 rounded-xl border px-4 py-2.5 text-sm font-semibold hover:bg-muted sm:flex-none">
                        Dismiss
                      </button>
                      <button type="button" data-testid={`button-accept-${r.code}`} disabled={join.isPending}
                        onClick={() => void connect(r.code, true)}
                        className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground shadow-sm transition-transform active:scale-[0.98] disabled:opacity-40 sm:flex-none">
                        Accept <ArrowRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <div className="h-1 bg-primary/10">
                    <div className="h-full bg-primary transition-[width] duration-1000" style={{ width: `${(left / CALL_TTL) * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </section>
        )}

        {(notice || error) && (
          <div className="mb-6 space-y-2">
            {error && tab !== 'connect' && (
              <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>
            )}
            {notice && (
              <div data-testid="text-notice" className="flex items-start gap-3 rounded-xl border border-foreground/10 bg-accent/60 px-4 py-3 text-sm">
                <Check className="mt-0.5 h-4 w-4 shrink-0" /> <span className="flex-1">{notice}</span>
                <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
              </div>
            )}
          </div>
        )}

        {tab === 'connect' && (
          <ConnectView code={code} setCode={(v) => { setCode(v); setError(null); }} error={error} pending={join.isPending}
            onSubmit={async (e) => {
              e.preventDefault();
              if (!HEX.test(code)) { setError('Codes are 12 characters, using only 0-9 and A-F.'); return; }
              await connect(code);
            }} />
        )}

        {tab === 'pcs' && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <section aria-labelledby="pcs-heading" className="dl-rise min-w-0 space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h1 id="pcs-heading" className="text-2xl font-extrabold tracking-tight md:text-3xl">Unattended PCs</h1>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {pcs.length === 0 ? 'No PCs saved in this browser yet.'
                      : presenceSupported ? `${onlineCount} of ${pcs.length} online · requests appear here automatically`
                        : `${pcs.length} saved · requests appear here automatically`}
                  </p>
                </div>
                <div className="flex gap-2">
                  <IconToggle on={sound} onClick={() => { setSound(!sound); writePref(SOUND_KEY, sound ? 'off' : 'on'); if (!sound) chime(); }}
                    label={sound ? 'Sound on' : 'Sound off'} iconOn={Volume2} iconOff={VolumeX} />
                  {alerts !== 'unsupported' && (
                    <IconToggle on={alerts === 'granted'} onClick={() => void enableAlerts()} disabled={alerts !== 'default'}
                      label={alerts === 'granted' ? 'Desktop alerts on' : alerts === 'denied' ? 'Alerts blocked' : 'Enable desktop alerts'}
                      iconOn={Bell} iconOff={BellOff} />
                  )}
                </div>
              </div>

              <AddPC onSave={savePC} />

              {pcs.length === 0 ? (
                <EmptyState icon={Laptop} title="Save a PC to get its requests"
                  body="Enter a PC's unattended access code above, or connect once with it on the Connect tab: unattended PCs are saved automatically. When someone at that PC selects Initiate in the winss132r tray menu, an Accept banner appears here." />
              ) : (
                <ul className="grid gap-3 sm:grid-cols-2">
                  {pcs.map((pc) => (
                    <PCCard key={pc.code} pc={pc} now={now}
                      presence={presenceSupported ? presence[pc.code] ?? 'unknown' : 'unknown'}
                      requesting={waiting.some((r) => r.code === pc.code)}
                      pending={join.isPending}
                      onConnect={() => void connect(pc.code, waiting.some((r) => r.code === pc.code))}
                      onRename={(label) => updatePCs((list) => list.map((p) => (p.code === pc.code ? { ...p, label: label.trim().slice(0, 48) || undefined } : p)))}
                      onForget={() => {
                        if (window.confirm(`Forget ${pcTitle(pc)} (${masked(pc.code)}) in this browser? Its requests will no longer show here.`)) {
                          updatePCs((list) => list.filter((p) => p.code !== pc.code));
                        }
                      }} />
                  ))}
                </ul>
              )}
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Access codes let anyone connect without asking, so they are stored only in this browser. Treat them like passwords.
              </p>
            </section>

            <RequestHistory requests={requests} pcs={pcs} now={now}
              onClear={() => {
                if (window.confirm('Clear the request history in this browser? Waiting requests stay.')) {
                  updateRequests((list) => list.filter((r) => r.open && r.status === 'waiting'));
                }
              }} />
          </div>
        )}

        {tab === 'download' && <DownloadView installer={installer} relay={relay} />}
      </main>

      <footer className="border-t border-foreground/10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 px-4 py-3 text-xs text-muted-foreground md:px-8">
          <p>Attended sessions need the person at the PC to approve. Unattended PCs connect with their saved access code. Either side can end a session.</p>
          <nav aria-label="About winss132r" className="flex flex-wrap gap-x-5">
            <Link href="/project" className="inline-flex min-h-11 items-center rounded-md font-semibold text-foreground underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">Project status</Link>
            <Link href="/privacy" className="inline-flex min-h-11 items-center rounded-md font-semibold text-foreground underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">Privacy</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

function TabButton({ active, onClick, children, testId }: { active: boolean; onClick: () => void; children: ReactNode; testId: string }) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? 'page' : undefined} data-testid={testId}
      className={`flex flex-1 items-center justify-center whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors sm:flex-none ${
        active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
      {children}
    </button>
  );
}

function RelayDot({ reachable, watching }: { reachable: boolean | null; watching: boolean }) {
  const label = reachable === false ? 'Relay unreachable' : reachable && watching ? 'Listening for requests' : 'Relay ready';
  const color = reachable === false ? 'bg-destructive' : 'bg-emerald-500';
  return (
    <span className="hidden items-center gap-2 rounded-full border border-foreground/10 bg-card/70 px-3 py-1 font-mono text-[11px] text-muted-foreground md:flex" data-testid="text-relay-status">
      <span className="relative flex h-2 w-2">
        {reachable && watching && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${color} opacity-60`} />}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${color}`} />
      </span>
      {label}
    </span>
  );
}

function IconToggle({ on, onClick, label, iconOn: On, iconOff: Off, disabled }: {
  on: boolean; onClick: () => void; label: string; iconOn: typeof Bell; iconOff: typeof Bell; disabled?: boolean;
}) {
  const Icon = on ? On : Off;
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={label} aria-pressed={on}
      className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors disabled:cursor-default ${
        on ? 'border-foreground/15 bg-card' : 'border-dashed text-muted-foreground hover:text-foreground'}`}>
      <Icon className="h-4 w-4" /> <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function PresencePill({ state }: { state: Presence }) {
  const look: Record<Presence, [string, string]> = {
    online: ['Online', 'bg-emerald-500/12 text-emerald-700 [&>i]:bg-emerald-500'],
    busy: ['In a session', 'bg-amber-500/15 text-amber-700 [&>i]:bg-amber-500'],
    offline: ['Offline', 'bg-foreground/8 text-muted-foreground [&>i]:bg-foreground/30'],
    unknown: ['Status unknown', 'bg-foreground/8 text-muted-foreground [&>i]:bg-foreground/30'],
  };
  const [text, cls] = look[state];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
      <i className="h-1.5 w-1.5 rounded-full" /> {text}
    </span>
  );
}

function PCCard({ pc, presence, requesting, pending, now, onConnect, onRename, onForget }: {
  pc: SavedPC; presence: Presence; requesting: boolean; pending: boolean; now: number;
  onConnect: () => void; onRename: (label: string) => void; onForget: () => void;
}) {
  const [reveal, setReveal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(pc.label ?? '');
  const canConnect = presence === 'online' || presence === 'unknown';
  return (
    <li data-testid={`pc-${pc.code}`}
      className={`group flex flex-col rounded-2xl border bg-card/90 p-4 shadow-[0_1px_0_hsl(0_0%_100%/0.6)_inset,0_10px_30px_-24px_hsl(200_32%_13%/0.5)] transition-shadow hover:shadow-[0_14px_34px_-22px_hsl(200_32%_13%/0.5)] ${
        requesting ? 'border-primary/60 ring-2 ring-primary/20' : ''}`}>
      <div className="flex items-start gap-3">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${presence === 'online' ? 'bg-emerald-500/12 text-emerald-700' : presence === 'busy' ? 'bg-amber-500/15 text-amber-700' : 'bg-muted text-muted-foreground'}`}>
          <Monitor className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          {editing ? (
            <form onSubmit={(e) => { e.preventDefault(); onRename(label); setEditing(false); }} className="flex gap-1">
              <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} maxLength={48} placeholder={pc.name || 'Label'}
                aria-label="PC label" className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-primary/40" />
              <button type="submit" aria-label="Save label" className="rounded-md px-1.5 text-muted-foreground hover:text-foreground"><Check className="h-4 w-4" /></button>
            </form>
          ) : (
            <div className="flex items-center gap-1">
              <p className="truncate font-bold">{pcTitle(pc)}</p>
              <button type="button" aria-label="Rename" onClick={() => { setLabel(pc.label ?? ''); setEditing(true); }}
                className="rounded p-0.5 text-muted-foreground opacity-60 hover:text-foreground group-hover:opacity-100"><Pencil className="h-3.5 w-3.5" /></button>
            </div>
          )}
          {pc.label && pc.name && <p className="truncate font-mono text-[11px] text-muted-foreground">{pc.name}</p>}
          <div className="mt-1"><PresencePill state={presence} /></div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-1 rounded-lg bg-muted/70 px-2.5 py-1.5 font-mono text-sm">
        <span className="flex-1 tracking-wide">{reveal ? dashed(pc.code) : masked(pc.code)}</span>
        <button type="button" aria-label={reveal ? 'Hide code' : 'Show code'} onClick={() => setReveal(!reveal)} className="p-1 text-muted-foreground hover:text-foreground">
          {reveal ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
        <button type="button" aria-label="Copy code" className="p-1 text-muted-foreground hover:text-foreground"
          onClick={() => { void navigator.clipboard.writeText(dashed(pc.code)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); }}>
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
        <div><dt className="text-muted-foreground">Last request</dt><dd className="font-semibold">{relativeTime(pc.lastRequestAt, now)}</dd></div>
        <div><dt className="text-muted-foreground">Last connected</dt><dd className="font-semibold">{relativeTime(pc.lastConnectedAt, now)}</dd></div>
      </dl>

      <div className="mt-4 flex gap-2">
        <button type="button" onClick={onConnect} disabled={pending || !canConnect} data-testid={`button-connect-${pc.code}`}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 ${
            requesting ? 'bg-primary text-primary-foreground' : 'bg-foreground text-background'}`}>
          {requesting ? 'Accept request' : presence === 'busy' ? 'In a session' : presence === 'offline' ? 'Offline' : 'Connect'}
          {canConnect && <ArrowRight className="h-3.5 w-3.5" />}
        </button>
        <button type="button" onClick={onForget} aria-label={`Forget ${pcTitle(pc)}`}
          className="rounded-xl border px-2.5 text-muted-foreground hover:bg-muted hover:text-destructive">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}

function AddPC({ onSave }: { onSave: (code: string, label: string) => string | null }) {
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <form className="rounded-2xl border border-dashed border-foreground/20 bg-card/50 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const err = onSave(code, label);
        setProblem(err);
        if (!err) { setCode(''); setLabel(''); }
      }}>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input aria-label="Unattended access code to save" data-testid="input-saved-code" value={code}
          onChange={(e) => { setCode(formatCode(e.target.value)); setProblem(null); }}
          autoComplete="off" spellCheck={false} placeholder="Access code"
          className="min-w-0 flex-1 rounded-xl border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-primary/40" />
        <input aria-label="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={48}
          placeholder="Label, e.g. Front desk (optional)"
          className="min-w-0 flex-1 rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40" />
        <button type="submit" data-testid="button-save-code" disabled={!HEX.test(code)}
          className="flex items-center justify-center gap-1.5 rounded-xl bg-foreground px-4 py-2 text-sm font-bold text-background disabled:opacity-40">
          <Plus className="h-4 w-4" /> Save PC
        </button>
      </div>
      {problem && <p role="alert" className="mt-2 px-1 text-xs text-destructive">{problem}</p>}
    </form>
  );
}

const STATUS_LOOK: Record<RequestStatus, [string, string]> = {
  waiting: ['Waiting', 'bg-primary/12 text-primary'],
  accepted: ['Accepted', 'bg-emerald-500/12 text-emerald-700'],
  missed: ['Missed', 'bg-amber-500/15 text-amber-700'],
  dismissed: ['Dismissed', 'bg-foreground/8 text-muted-foreground'],
};

function RequestHistory({ requests, pcs, now, onClear }: { requests: RequestEntry[]; pcs: SavedPC[]; now: number; onClear: () => void }) {
  const [filter, setFilter] = useState<'all' | RequestStatus>('all');
  const shown = requests.filter((r) => filter === 'all' || r.status === filter);
  const today = new Date(now).toDateString();
  const newer = shown.filter((r) => r.open || new Date(r.at).toDateString() === today);
  const older = shown.filter((r) => !newer.includes(r));
  const row = (r: RequestEntry) => {
    const pc = pcs.find((p) => p.code === r.code);
    const [text, cls] = STATUS_LOOK[r.status];
    return (
      <li key={r.id} className="flex items-center gap-3 py-2.5" data-testid={`history-${r.id}`}>
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${r.status === 'waiting' ? 'bg-primary/12 text-primary' : 'bg-muted text-muted-foreground'}`}>
          {r.status === 'waiting' ? <BellRing className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{pcTitle(pc, r.name || 'Unattended PC')}</p>
          <p className="font-mono text-[11px] text-muted-foreground">{masked(r.code)} · {relativeTime(r.at, now)}</p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{text}</span>
      </li>
    );
  };
  return (
    <section aria-labelledby="history-heading" className="dl-rise rounded-2xl border bg-card/90 p-4 shadow-[0_10px_30px_-24px_hsl(200_32%_13%/0.5)] [animation-delay:100ms] md:p-5 lg:sticky lg:top-24 lg:self-start">
      <div className="flex items-center justify-between gap-2">
        <h2 id="history-heading" className="flex items-center gap-2 text-lg font-bold"><History className="h-5 w-5 text-primary" /> Request history</h2>
        {requests.length > 0 && <button type="button" onClick={onClear} className="text-xs font-semibold text-muted-foreground hover:text-foreground">Clear</button>}
      </div>
      <div className="mt-3 flex flex-wrap gap-1">
        {(['all', 'waiting', 'accepted', 'missed', 'dismissed'] as const).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f}
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ${filter === f ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>
            {f}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="mt-6 pb-2 text-center text-sm text-muted-foreground">
          {requests.length === 0 ? 'No requests yet. New and previous requests from your saved PCs are listed here.' : 'Nothing matches this filter.'}
        </p>
      ) : (
        <div className="mt-2 max-h-[32rem] overflow-y-auto pr-1">
          {newer.length > 0 && (<>
            <p className="mt-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">New · today</p>
            <ul className="divide-y divide-foreground/8">{newer.map(row)}</ul>
          </>)}
          {older.length > 0 && (<>
            <p className="mt-4 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Earlier</p>
            <ul className="divide-y divide-foreground/8">{older.map(row)}</ul>
          </>)}
        </div>
      )}
    </section>
  );
}

function EmptyState({ icon: Icon, title, body }: { icon: typeof Bell; title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-foreground/15 bg-card/40 px-6 py-10 text-center">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-muted text-muted-foreground"><Icon className="h-6 w-6" /></span>
      <p className="mt-3 font-bold">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

function ConnectView({ code, setCode, error, pending, onSubmit }: {
  code: string; setCode: (v: string) => void; error: string | null; pending: boolean; onSubmit: (e: FormEvent) => void;
}) {
  const ready = HEX.test(code);
  return (
    <div className="grid grid-cols-1 items-start gap-8 md:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] md:gap-12">
      <section className="dl-rise pt-2">
        <p className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/8 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-primary">
          <ShieldCheck className="h-3.5 w-3.5" /> Two people · one screen · both aware
        </p>
        <h1 className="mt-5 text-[2.4rem] font-extrabold leading-[0.98] tracking-tight md:text-6xl">
          Help someone at their PC, <span className="bg-gradient-to-r from-primary to-[hsl(32_90%_52%)] bg-clip-text text-transparent">with them watching.</span>
        </h1>
        <p className="mt-5 max-w-lg text-base text-muted-foreground md:text-lg">
          For attended support, the person at the keyboard reads you a one-time code and confirms a number. For your own unattended PCs, use the <strong className="text-foreground">Unattended PCs</strong> tab.
        </p>
        <ol className="mt-8 grid gap-3 sm:grid-cols-2">
          {[
            { who: 'At the PC', icon: Monitor, title: 'Open winss132r', body: 'It shows a one-time 12-character code.' },
            { who: 'At the PC', icon: Monitor, title: 'Read the code to you', body: 'Over the phone or in chat. Each code works once.' },
            { who: 'Helper', icon: UserRound, title: 'Enter the code here', body: 'Your browser gets a verification number.' },
            { who: 'Both', icon: ShieldCheck, title: 'Confirm the number', body: 'They type your six digits into winss132r to approve.' },
          ].map((s, i) => (
            <li key={i} className="rounded-2xl border border-foreground/10 bg-card/70 p-4" data-testid={`step-${i + 1}`}>
              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                <span className="grid h-5 w-5 place-items-center rounded-md bg-foreground text-[10px] font-bold text-background">{i + 1}</span>
                <s.icon className="h-3.5 w-3.5" /> {s.who}
              </div>
              <p className="mt-2 font-semibold">{s.title}</p>
              <p className="text-sm text-muted-foreground">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <form onSubmit={onSubmit} className="dl-rise relative overflow-hidden rounded-3xl bg-foreground p-6 text-background shadow-[0_40px_80px_-40px_hsl(200_32%_13%/0.75)] [animation-delay:120ms] md:p-8">
        <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-primary/30 blur-3xl" />
        <div className="relative flex items-center justify-between">
          <h2 className="text-xl font-bold">I'm the helper</h2>
          <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-widest text-background/60">
            <span className="h-1.5 w-1.5 rounded-full bg-background/40" /> Not connected
          </span>
        </div>
        <label htmlFor="code" className="relative mt-6 block font-mono text-[11px] uppercase tracking-widest text-background/60">
          Code from the PC
        </label>
        <input id="code" data-testid="input-code" value={code} onChange={(e) => setCode(formatCode(e.target.value))}
          autoComplete="off" spellCheck={false} inputMode="text" placeholder="A1B2C3D4E5F6" aria-invalid={!!error} className="peer sr-only" />
        <label htmlFor="code" aria-hidden="true" className="relative mt-2 grid cursor-text grid-cols-3 gap-1.5 rounded-xl peer-focus-visible:ring-2 peer-focus-visible:ring-primary sm:gap-2">
          {groups(code.padEnd(12, ' ')).map((g, gi) => (
            <span key={gi} className="flex justify-center gap-0.5 rounded-xl border border-background/10 bg-background/8 py-3.5 font-mono text-lg font-bold sm:text-xl md:text-2xl">
              {g.split('').map((c, ci) => {
                const idx = gi * 4 + ci;
                return (
                  <span key={ci} className={`w-[1ch] text-center ${c === ' ' ? 'text-background/25' : ''} ${idx === code.length ? 'border-b-2 border-primary' : ''}`}>
                    {c === ' ' ? '·' : c}
                  </span>
                );
              })}
            </span>
          ))}
        </label>
        <p className="relative mt-2 font-mono text-[11px] text-background/50">{code.length}/12 · characters 0-9 and A-F</p>
        {error && <p role="alert" data-testid="text-error" className="relative mt-4 rounded-lg bg-[hsl(356_70%_46%/0.2)] px-3 py-2 text-sm text-[hsl(356_90%_85%)]">{error}</p>}
        <button type="submit" data-testid="button-join" disabled={!ready || pending}
          className="relative mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3.5 font-bold text-primary-foreground shadow-[0_10px_30px_-10px_hsl(14_78%_50%/0.8)] transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none">
          {pending ? <span className="dl-pulse">Requesting</span> : <>Request to connect <ArrowRight className="h-4 w-4" /></>}
        </button>
        <p className="relative mt-4 text-xs text-background/55">
          A one-time code shows a verification number to read out; control starts after they approve. An unattended access code connects at once and is saved to Unattended PCs.
        </p>
      </form>
    </div>
  );
}

function DownloadView({ installer, relay }: { installer: string; relay: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="dl-rise mx-auto max-w-2xl">
      <div className="rounded-3xl border bg-card/90 p-6 shadow-[0_20px_50px_-35px_hsl(200_32%_13%/0.6)] md:p-8">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-foreground text-background"><Download className="h-6 w-6" /></span>
        <h1 className="mt-4 text-2xl font-extrabold tracking-tight md:text-3xl">winss132r for Windows</h1>
        <p className="mt-1 text-sm text-muted-foreground">Windows 10 or 11 (x64). This preview installer is unsigned, so SmartScreen may warn before it runs.</p>
        <a href={installer} download data-testid="link-download"
          className="mt-6 flex items-center justify-between rounded-xl bg-foreground px-5 py-3.5 font-bold text-background transition-transform active:scale-[0.99]">
          <span className="flex items-center gap-2"><Download className="h-4 w-4" /> Download for Windows</span>
          <span className="font-mono text-[11px] opacity-70">x64 .exe</span>
        </a>
        <p className="mt-6 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Relay URL — paste into the app</p>
        <div className="mt-2 flex items-stretch overflow-hidden rounded-xl border bg-muted">
          <code data-testid="text-relay" className="min-w-0 flex-1 truncate px-3 py-2.5 font-mono text-sm">{relay || 'Open winss132r over HTTPS'}</code>
          <button type="button" disabled={!relay} data-testid="button-copy-relay"
            onClick={() => { void navigator.clipboard.writeText(relay).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }).catch(() => {}); }}
            className="flex items-center gap-1.5 border-l bg-card px-3 text-sm font-medium hover:bg-accent">
            {copied ? <><Check className="h-4 w-4" /> Copied</> : <><Copy className="h-4 w-4" /> Copy</>}
          </button>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl bg-muted/60 p-4">
            <p className="font-semibold">Attended</p>
            <p className="mt-1 text-sm text-muted-foreground">Open the app and select Start. Read the one-time code to your helper and approve with their number.</p>
          </div>
          <div className="rounded-2xl bg-muted/60 p-4">
            <p className="font-semibold">Unattended</p>
            <p className="mt-1 text-sm text-muted-foreground">Select Unattended… once. The app then lives only in the notification area; its menu has the access code and Initiate.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
