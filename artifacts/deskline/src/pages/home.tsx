import { useEffect, useState, type FormEvent } from 'react';
import { useJoinDeskline } from '@workspace/api-client-react';
import { ArrowRight, Check, Copy, Download, Monitor, ShieldCheck, UserRound } from 'lucide-react';
import LiveSession from '@/LiveSession';

type Session = { token: string; verification: string };

const HEX = /^[A-F0-9]{12}$/;

function formatCode(raw: string) {
  return raw.toUpperCase().replace(/[^A-F0-9]/g, '').slice(0, 12);
}

function groups(code: string) {
  return [code.slice(0, 4), code.slice(4, 8), code.slice(8, 12)];
}

export default function Home() {
  const join = useJoinDeskline();
  const [session, setSession] = useState<Session | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const relay = typeof window !== 'undefined' && window.location.protocol === 'https:' ? window.location.origin : '';
  const installer = `${import.meta.env.BASE_URL}downloads/winss132r-Setup-x64.exe`;

  useEffect(() => {
    document.title = session
      ? 'winss132r — Connected session'
      : 'winss132r — Attended remote support for Windows';
  }, [session]);

  async function copyRelay() {
    try {
      await navigator.clipboard.writeText(relay);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!relay) {
      setError('Open winss132r at its HTTPS address before connecting.');
      return;
    }
    if (!HEX.test(code)) {
      setError('Codes are 12 characters, using only 0-9 and A-F.');
      return;
    }
    try {
      const viewer = await join.mutateAsync({ data: { code } });
      setSession({ token: viewer.token, verification: viewer.verification });
      setCode('');
    } catch (reason) {
      const status = typeof reason === 'object' && reason !== null && 'status' in reason ? reason.status : undefined;
      setError(status === 429 ? 'The relay is busy. Wait a minute, then try again.' :
        status === 404 || status === 400 ? 'That code was not accepted. Check it against the Windows PC or ask for a fresh code.' :
          'Could not reach the relay. Check your connection and try again.');
    }
  }

  if (session) {
    return (
      <LiveSession
        token={session.token}
        verification={session.verification}
        onLeave={(message) => {
          setSession(null);
          setNotice(message ?? 'Session ended. The helper is no longer connected.');
        }}
      />
    );
  }

  const ready = HEX.test(code);

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-6 md:px-10">
        <div className="flex items-center gap-2.5" data-testid="text-brand">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-foreground text-background">
            <span className="h-0.5 w-4 bg-primary" />
          </span>
          <span className="text-lg font-bold tracking-tight">winss132r</span>
        </div>
        <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          Attended support · Windows
        </span>
      </header>

      <main className="mx-auto grid max-w-6xl gap-10 px-5 pb-20 pt-6 md:grid-cols-[1.1fr_1fr] md:gap-16 md:px-10 md:pt-12">
        <section className="dl-rise">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Two people. One screen. Both aware.</p>
          <h1 className="mt-4 text-[2.6rem] font-extrabold leading-[0.95] tracking-tight md:text-7xl">
            Help someone at their PC, <span className="text-primary">with them watching.</span>
          </h1>
          <p className="mt-6 max-w-lg text-lg text-muted-foreground">
            Nobody gets in without the person at the keyboard reading out a code and confirming a number. When it ends, it ends on both sides.
          </p>

          <ol className="mt-10 space-y-0 border-l-2 border-foreground/15">
            {[
              { who: 'At the PC', icon: Monitor, title: 'Install and open winss132r on Windows', body: 'Point it at the relay below. It shows a one-time 12-character code.' },
              { who: 'At the PC', icon: Monitor, title: 'Read the code to your helper', body: 'Over the phone or in chat. Each code works once.' },
              { who: 'Helper', icon: UserRound, title: 'Enter the code here', body: 'Your browser gets a verification number.' },
              { who: 'Both', icon: ShieldCheck, title: 'Confirm the verification number', body: 'The helper reads out the six digits. The person at the PC types them into winss132r to approve.' },
            ].map((s, i) => (
              <li key={i} className="relative pb-7 pl-7 last:pb-0" data-testid={`step-${i + 1}`}>
                <span className="absolute -left-[9px] top-1 grid h-4 w-4 place-items-center rounded-full bg-background ring-2 ring-foreground/30">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                </span>
                <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                  <s.icon className="h-3.5 w-3.5" /> {String(i + 1).padStart(2, '0')} · {s.who}
                </div>
                <p className="mt-1 font-semibold">{s.title}</p>
                <p className="text-sm text-muted-foreground">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <aside className="dl-rise space-y-5 [animation-delay:120ms]">
          <form onSubmit={onSubmit} className="rounded-2xl bg-foreground p-6 text-background shadow-[0_30px_60px_-30px_hsl(200_32%_13%/0.6)] md:p-8">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold">I'm the helper</h2>
              <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-widest text-background/60">
                <span className="h-1.5 w-1.5 rounded-full bg-background/40" /> Not connected
              </span>
            </div>
            <label htmlFor="code" className="mt-6 block font-mono text-[11px] uppercase tracking-widest text-background/60">
              One-time code from the PC
            </label>
            <input
              id="code"
              data-testid="input-code"
              value={code}
              onChange={(e) => { setCode(formatCode(e.target.value)); setError(null); }}
              autoComplete="off"
              spellCheck={false}
              inputMode="text"
              placeholder="A1B2C3D4E5F6"
              aria-invalid={!!error}
              className="peer sr-only"
            />
            <label htmlFor="code" aria-hidden="true" className="mt-2 grid cursor-text grid-cols-3 gap-1.5 rounded-lg peer-focus-visible:ring-2 peer-focus-visible:ring-primary sm:gap-2">
              {groups(code.padEnd(12, ' ')).map((g, gi) => (
                <span key={gi} className="flex justify-center gap-0.5 rounded-lg bg-background/10 py-3 font-mono text-lg font-bold sm:text-xl md:text-2xl">
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
            <p className="mt-2 font-mono text-[11px] text-background/50">{code.length}/12 · characters 0-9 and A-F</p>
            {error && <p role="alert" data-testid="text-error" className="mt-4 rounded-md bg-[hsl(356_70%_46%/0.2)] px-3 py-2 text-sm text-[hsl(356_90%_85%)]">{error}</p>}
            <button
              type="submit"
              data-testid="button-join"
              disabled={!ready || join.isPending}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3.5 font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {join.isPending ? <><span className="dl-pulse">Requesting</span></> : <>Request to connect <ArrowRight className="h-4 w-4" /></>}
            </button>
            <p className="mt-4 text-xs text-background/55">
              Next you'll see a verification number. Read it to the person at the PC. Control starts only after they approve.
            </p>
          </form>

          {notice && (
            <div data-testid="text-notice" className="flex items-start gap-3 rounded-xl border border-foreground/15 bg-accent/60 px-4 py-3 text-sm">
              <Check className="mt-0.5 h-4 w-4 shrink-0" /> <span>{notice}</span>
            </div>
          )}

          <div className="rounded-2xl border bg-card p-6 md:p-7">
            <h2 className="text-xl font-bold">I'm at the Windows PC</h2>
            <p className="mt-1 text-sm text-muted-foreground">For Windows 10 or 11 (x64). This preview installer is unsigned.</p>
            <a
              href={installer}
              download
              data-testid="link-download"
              className="mt-5 flex items-center justify-between rounded-lg border-2 border-foreground px-4 py-3 font-semibold transition-colors hover:bg-foreground hover:text-background"
            >
              <span className="flex items-center gap-2"><Download className="h-4 w-4" /> Download for Windows</span>
              <span className="font-mono text-[11px] opacity-70">x64 .exe</span>
            </a>
            <p className="mt-5 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Relay URL — paste into the app</p>
            <div className="mt-2 flex items-stretch overflow-hidden rounded-lg border bg-muted">
              <code data-testid="text-relay" className="min-w-0 flex-1 truncate px-3 py-2.5 font-mono text-sm">{relay || 'Open winss132r over HTTPS'}</code>
              <button
                type="button"
                onClick={copyRelay}
                disabled={!relay}
                data-testid="button-copy-relay"
                className="flex items-center gap-1.5 border-l bg-card px-3 text-sm font-medium hover:bg-accent"
              >
                {copied ? <><Check className="h-4 w-4" /> Copied</> : <><Copy className="h-4 w-4" /> Copy</>}
              </button>
            </div>
          </div>
        </aside>
      </main>

      <footer className="mx-auto max-w-6xl border-t px-5 py-6 text-xs text-muted-foreground md:px-10">
        winss132r connects only while the person at the PC has the app open and has approved. Either side can end the session.
      </footer>
    </div>
  );
}
