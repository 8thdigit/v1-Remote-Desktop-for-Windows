import { useEffect, useState, type FormEvent } from 'react';
import { getMsfwrLinkInfo, joinMsfwrLink, type MsfwrLinkInfo } from '@workspace/api-client-react';
import { ArrowRight, Clock, KeyRound, Laptop, LockKeyhole, ShieldCheck } from 'lucide-react';
import { LogoMark, Wordmark } from '@/components/logo';
import LiveSession from '@/LiveSession';
import { errorText, statusOf } from '@/lib/auth';

// The page a remote access URL opens (https://…/r/L0123456789A#123456).
// Whoever has the URL and its six-digit access code, and also the four-digit
// Access PIN from the company that manages the PC, connects to the PC that
// created it. The PC shares the URL with the code after the #, which browsers
// never send to a server; the Access PIN is never part of the URL, so knowing
// the URL alone is not enough. Several people can be connected through the
// same URL at once. No sign-in is needed.

// The access code carried in the URL after the #, if any.
function codeFromHash() {
  if (typeof window === 'undefined') return '';
  const digits = decodeURIComponent(window.location.hash.slice(1)).replace(/\D/g, '');
  return digits.length === 6 ? digits : '';
}
export default function LinkPage({ code }: { code: string }) {
  const [info, setInfo] = useState<MsfwrLinkInfo | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  const [pin, setPin] = useState(codeFromHash);
  const [accessPin, setAccessPin] = useState('');
  // The access code field is only shown when the URL did not carry it, or
  // when the one it carried was wrong.
  const [showCode, setShowCode] = useState(() => !codeFromHash());
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
    document.title = session ? 'WINRSS.net — Connected session' : `${info?.name || 'Remote access'} — WINRSS.net`;
  }, [info?.name, session]);

  async function join() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const viewer = await joinMsfwrLink({ code: upper, pin: pin.replace(/\D/g, ''), accessPin: accessPin.replace(/\D/g, '') });
      setSession({ token: viewer.token });
    } catch (reason) {
      const message = errorText(reason, 'Could not connect. Try again.');
      setError(message);
      if (/access code/i.test(message)) setShowCode(true);
      setAccessPin('');
    } finally {
      setBusy(false);
    }
  }

  function connect(e: FormEvent) {
    e.preventDefault();
    void join();
  }

  if (session) {
    return <LiveSession token={session.token} verification="" preapproved onLeave={(message) => { setSession(null); setNotice(message ?? 'Session ended.'); }} />;
  }

  const expires = info ? new Date(info.expiresAt) : null;
  return (
    <div className="dl-shell grid min-h-[100dvh] place-items-center px-4 py-10 text-foreground">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <LogoMark className="h-10 w-10" />
          <div className="leading-tight">
            <Wordmark className="text-xl" />
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
                    {!info.online ? 'Offline or locked'
                      : info.busy ? 'In a session right now'
                      : info.viewers ? `${info.viewers} ${info.viewers === 1 ? 'person' : 'people'} connected. You can join them.`
                      : 'Online and ready'}
                  </p>
                )}
              </div>
            </div>
            {expires && (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" /> Link valid until {expires.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}
              </p>
            )}
            {info?.blocked && (
              <p role="alert" className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                Too many wrong Access PINs were entered, so this URL no longer works. Ask the person at the PC to create a new one.
              </p>
            )}
            {showCode && (
              <label htmlFor="link-pin" className="mt-6 block">
                <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Access code (6 digits, shown next to the URL on the PC)</span>
                <span className="flex items-center gap-2 rounded-xl border bg-background px-3 focus-within:ring-2 focus-within:ring-primary/40">
                  <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <input id="link-pin" value={pin} onChange={(e) => { setPin(e.target.value.replace(/\D/g, '').slice(0, 6)); setError(null); }}
                    inputMode="numeric" autoComplete="off" placeholder="123456" required data-testid="input-link-pin"
                    className="min-w-0 flex-1 bg-transparent py-2.5 font-mono text-lg tracking-[0.3em] outline-none" />
                </span>
              </label>
            )}
            <label htmlFor="link-access-pin" className="mt-6 block">
              <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Access PIN (4 digits, from the company that manages this PC)</span>
              <span className="flex items-center gap-2 rounded-xl border bg-background px-3 focus-within:ring-2 focus-within:ring-primary/40">
                <LockKeyhole className="h-4 w-4 shrink-0 text-muted-foreground" />
                <input id="link-access-pin" value={accessPin} onChange={(e) => { setAccessPin(e.target.value.replace(/\D/g, '').slice(0, 4)); setError(null); }}
                  type="password" inputMode="numeric" autoComplete="one-time-code" placeholder="••••" required autoFocus data-testid="input-link-access-pin"
                  className="min-w-0 flex-1 bg-transparent py-2.5 font-mono text-lg tracking-[0.5em] outline-none" />
              </span>
              <span className="mt-1.5 block text-xs text-muted-foreground">The URL alone does not connect. The company shares this PIN with you separately.</span>
            </label>
            {error && <p role="alert" data-testid="text-link-error" className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
            {notice && <p className="mt-4 rounded-lg bg-accent/60 px-3 py-2 text-sm">{notice}</p>}
            <button type="submit" disabled={busy || pin.length !== 6 || accessPin.length !== 4 || !info || info.blocked} data-testid="button-link-connect"
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-bold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-40">
              {busy ? <span className="dl-pulse">Connecting</span> : <>{info?.viewers ? 'Join' : 'Connect'} <ArrowRight className="h-4 w-4" /></>}
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
