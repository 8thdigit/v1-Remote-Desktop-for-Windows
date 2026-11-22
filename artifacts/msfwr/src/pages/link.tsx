import { useEffect, useState, type FormEvent } from 'react';
import { getMsfwrLinkInfo, joinMsfwrLink, type MsfwrLinkInfo } from '@workspace/api-client-react';
import { ArrowRight, Clock, KeyRound, Laptop, Radio, ShieldCheck } from 'lucide-react';
import LiveSession from '@/LiveSession';
import { errorText, statusOf } from '@/lib/auth';

// The page a remote access URL opens (https://…/r/L0123456789A). Whoever has
// the URL and its six-digit access code connects to the PC that created it.
// No sign-in is needed: the URL and code are the credential.
export default function LinkPage({ code }: { code: string }) {
  const [info, setInfo] = useState<MsfwrLinkInfo | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<{ token: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const upper = code.toUpperCase();

  useEffect(() => {
    if (session) return;
    let stopped = false;
    let timer = 0;
    async function load() {
      try {
        const next = await getMsfwrLinkInfo({ code: upper });
        if (stopped) return;
        setInfo(next);
        setMissing(null);
      } catch (reason) {
        if (stopped) return;
        const status = statusOf(reason);
        if (status === 404 || status === 400) { setInfo(null); setMissing(errorText(reason, 'This remote access URL expired or was cleared on the PC.')); return; }
      }
      if (!stopped) timer = window.setTimeout(load, 5000);
    }
    void load();
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [upper, session]);

  useEffect(() => {
    document.title = session ? 'Msfwr — Connected session' : `${info?.name || 'Remote access'} — Msfwr`;
  }, [info?.name, session]);

  async function connect(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const viewer = await joinMsfwrLink({ code: upper, pin: pin.replace(/\D/g, '') });
      setPin('');
      setSession({ token: viewer.token });
    } catch (reason) {
      setError(errorText(reason, 'Could not connect. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  if (session) {
    return <LiveSession token={session.token} verification="" preapproved onLeave={(message) => { setSession(null); setNotice(message ?? 'Session ended.'); }} />;
  }

  const expires = info ? new Date(info.expiresAt) : null;
  return (
    <div className="dl-shell grid min-h-[100dvh] place-items-center px-4 py-10 text-foreground">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-foreground text-background shadow-sm">
            <Radio className="h-5 w-5 text-primary" />
          </span>
          <div className="leading-tight">
            <span className="block text-xl font-bold tracking-tight">Msfwr</span>
            <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Remote access URL</span>
          </div>
        </div>

        {missing ? (
          <div className="dl-rise rounded-3xl border bg-card/90 p-6 text-center md:p-8" data-testid="text-link-missing">
            <h1 className="text-xl font-extrabold tracking-tight">This link no longer works</h1>
            <p className="mt-2 text-sm text-muted-foreground">{missing} Ask the person at the PC to create a new remote access URL.</p>
          </div>
        ) : (
          <form onSubmit={connect} className="dl-rise rounded-3xl border bg-card/90 p-6 shadow-[0_30px_70px_-45px_hsl(200_32%_13%/0.7)] md:p-8">
            <div className="flex items-center gap-3">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary/12 text-primary"><Laptop className="h-5 w-5" /></span>
              <div className="min-w-0">
                <h1 className="truncate text-xl font-extrabold tracking-tight" data-testid="text-link-pc">{info ? info.name || 'Windows PC' : 'Loading…'}</h1>
                {info && (
                  <p className="flex items-center gap-1.5 text-sm" data-testid="text-link-state">
                    <i className={`h-2 w-2 rounded-full ${info.online ? (info.busy ? 'bg-amber-500' : 'bg-emerald-500') : 'bg-foreground/30'}`} />
                    {info.online ? (info.busy ? 'In a session right now' : 'Online and ready') : 'Offline or locked'}
                  </p>
                )}
              </div>
            </div>
            {expires && (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" /> Link valid until {expires.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}
              </p>
            )}
            <label htmlFor="link-pin" className="mt-6 block">
              <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Access code (6 digits, shown next to the URL on the PC)</span>
              <span className="flex items-center gap-2 rounded-xl border bg-background px-3 focus-within:ring-2 focus-within:ring-primary/40">
                <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
                <input id="link-pin" value={pin} onChange={(e) => { setPin(e.target.value.replace(/\D/g, '').slice(0, 6)); setError(null); }}
                  inputMode="numeric" autoComplete="one-time-code" placeholder="123456" required autoFocus data-testid="input-link-pin"
                  className="min-w-0 flex-1 bg-transparent py-2.5 font-mono text-lg tracking-[0.3em] outline-none" />
              </span>
            </label>
            {error && <p role="alert" data-testid="text-link-error" className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
            {notice && <p className="mt-4 rounded-lg bg-accent/60 px-3 py-2 text-sm">{notice}</p>}
            <button type="submit" disabled={busy || pin.length !== 6 || !info} data-testid="button-link-connect"
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-bold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-40">
              {busy ? <span className="dl-pulse">Connecting</span> : <>Connect <ArrowRight className="h-4 w-4" /></>}
            </button>
          </form>
        )}
        <p className="mt-6 flex items-start justify-center gap-2 text-center text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          You will see and control the PC's screen. The person at the PC sees a sharing banner and can stop it with Ctrl+2 or F12.
        </p>
      </div>
    </div>
  );
}
