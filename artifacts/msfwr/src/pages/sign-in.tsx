import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetAuthStatusQueryKey, login, setupAdmin } from '@workspace/api-client-react';
import { ArrowRight, KeyRound, Lock, Radio, ShieldCheck, UserRound } from 'lucide-react';
import { errorText } from '@/lib/auth';

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="dl-shell grid min-h-[100dvh] place-items-center px-4 py-10 text-foreground">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-foreground text-background shadow-sm">
            <Radio className="h-5 w-5 text-primary" />
          </span>
          <div className="leading-tight">
            <span className="block text-xl font-bold tracking-tight">Msfwr</span>
            <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Remote support</span>
          </div>
        </div>
        {children}
        <p className="mt-6 flex items-start justify-center gap-2 text-center text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Only signed-in companies can view or control PCs. Ask your admin for a login.
        </p>
        <p className="mt-2 text-center text-xs">
          <a href="https://github.com/mailbhrp-1/Remote-Desktop-for-Windows/releases/latest/download/msfwr-Setup-x64.exe" data-testid="link-download"
            className="font-semibold text-foreground underline underline-offset-4">Download the Msfwr app for the Windows PC</a>
        </p>
      </div>
    </div>
  );
}

function Field({ id, label, icon: Icon, ...props }: { id: string; label: string; icon: typeof Lock } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2 rounded-xl border bg-background px-3 focus-within:ring-2 focus-within:ring-primary/40">
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input id={id} {...props} className="min-w-0 flex-1 bg-transparent py-2.5 text-sm outline-none" />
      </span>
    </label>
  );
}

export function SignIn() {
  const client = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { document.title = 'Sign in — Msfwr'; }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login({ username: username.trim(), password });
      setPassword('');
      await client.invalidateQueries({ queryKey: getGetAuthStatusQueryKey() });
    } catch (reason) {
      setError(errorText(reason, 'Could not sign in. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <form onSubmit={submit} className="dl-rise rounded-3xl border bg-card/90 p-6 shadow-[0_30px_70px_-45px_hsl(200_32%_13%/0.7)] md:p-8">
        <h1 className="text-2xl font-extrabold tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-muted-foreground">Use the login ID and password your admin gave your company.</p>
        <div className="mt-6 space-y-4">
          <Field id="username" label="Login ID" icon={UserRound} value={username} onChange={(e) => setUsername(e.target.value)}
            autoComplete="username" autoCapitalize="none" spellCheck={false} required data-testid="input-username" autoFocus />
          <Field id="password" label="Password" icon={Lock} type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password" required data-testid="input-password" />
        </div>
        {error && <p role="alert" data-testid="text-login-error" className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        <button type="submit" disabled={busy || !username || !password} data-testid="button-login"
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-foreground px-5 py-3 font-bold text-background transition-transform active:scale-[0.98] disabled:opacity-40">
          {busy ? <span className="dl-pulse">Signing in</span> : <>Sign in <ArrowRight className="h-4 w-4" /></>}
        </button>
      </form>
    </Shell>
  );
}

export function SetupAdmin() {
  const client = useQueryClient();
  const [code, setCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { document.title = 'Set up Msfwr'; }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError('The two passwords do not match.'); return; }
    setBusy(true);
    setError(null);
    try {
      await setupAdmin({ setupCode: code.trim(), username: username.trim(), displayName: displayName.trim() || undefined, password });
      await client.invalidateQueries({ queryKey: getGetAuthStatusQueryKey() });
    } catch (reason) {
      setError(errorText(reason, 'Could not create the admin account.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <form onSubmit={submit} className="dl-rise rounded-3xl border bg-card/90 p-6 shadow-[0_30px_70px_-45px_hsl(200_32%_13%/0.7)] md:p-8">
        <p className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/8 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-primary">
          First-time setup
        </p>
        <h1 className="mt-3 text-2xl font-extrabold tracking-tight">Create the admin account</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The admin creates company logins at /admin. Copy the setup code from the relay's log on Render
          (it reads "create the admin account with setup code …"), or set ADMIN_PASSWORD on the relay instead.
        </p>
        <div className="mt-6 space-y-4">
          <Field id="setup-code" label="Setup code from the relay log" icon={KeyRound} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
            autoComplete="off" spellCheck={false} required className="font-mono" data-testid="input-setup-code" autoFocus />
          <Field id="display-name" label="Your name" icon={UserRound} value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={60} placeholder="e.g. Siv" />
          <Field id="setup-username" label="Login ID" icon={UserRound} value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())}
            autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={32} />
          <Field id="setup-password" label="Password (8+ characters)" icon={Lock} type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password" required minLength={8} />
          <Field id="setup-confirm" label="Confirm password" icon={Lock} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password" required minLength={8} />
        </div>
        {error && <p role="alert" className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        <button type="submit" disabled={busy || !code || !username || password.length < 8} data-testid="button-setup"
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-bold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-40">
          {busy ? <span className="dl-pulse">Creating</span> : <>Create admin and sign in <ArrowRight className="h-4 w-4" /></>}
        </button>
      </form>
    </Shell>
  );
}
