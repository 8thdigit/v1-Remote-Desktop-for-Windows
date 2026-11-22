import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createUser, deleteUser, endSessionAsAdmin, getAdminOverview, getGetAdminOverviewQueryKey, getListUsersQueryKey, listUsers, updateUser,
  type Account, type AdminOverview, type DesklineRequest,
} from '@workspace/api-client-react';
import {
  Activity, ArrowLeft, Check, Copy, Database, Laptop, MonitorPlay, MoreHorizontal, Plus, RefreshCw, Search, ShieldCheck,
  UserPlus, Users, X,
} from 'lucide-react';
import { Link } from 'wouter';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Brand, RaBadge, UserMenu } from '@/components/user-menu';
import { errorText, raLabel, useAuth } from '@/lib/auth';
import { relativeTime } from '@/lib/unattended';

type Tab = 'users' | 'sessions' | 'requests' | 'activity';

function generatePassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

function duration(from: number | undefined, now: number) {
  if (!from) return '—';
  const s = Math.max(0, Math.round((now - from) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${m} min` : m ? `${m} min` : `${s}s`;
}

function bytes(n: number) {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function Admin() {
  const { user: me } = useAuth();
  const client = useQueryClient();
  const [tab, setTab] = useState<Tab>('users');
  const [now, setNow] = useState(Date.now);
  const [creating, setCreating] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const users = useQuery({ queryKey: getListUsersQueryKey(), queryFn: () => listUsers(), refetchInterval: 15_000 });
  const overview = useQuery<AdminOverview>({ queryKey: getGetAdminOverviewQueryKey(), queryFn: () => getAdminOverview(), refetchInterval: 4000 });

  useEffect(() => {
    document.title = 'Admin console — winss132r';
    const id = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(id);
  }, []);

  const list = users.data?.users ?? [];
  const live = overview.data?.live.filter((s) => s.state === 'live') ?? [];
  const waiting = overview.data?.requests.filter((r) => r.status === 'waiting') ?? [];
  const byRa = useMemo(() => new Map(list.map((u) => [u.raId, u])), [list]);
  const reload = () => {
    void client.invalidateQueries({ queryKey: getListUsersQueryKey() });
    void client.invalidateQueries({ queryKey: getGetAdminOverviewQueryKey() });
  };

  async function run(action: () => Promise<unknown>, fallback: string) {
    setProblem(null);
    try { await action(); reload(); return true; } catch (reason) { setProblem(errorText(reason, fallback)); return false; }
  }

  return (
    <div className="dl-shell min-h-[100dvh] text-foreground">
      <header className="sticky top-0 z-30 border-b border-foreground/10 bg-background/75 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3 md:px-8">
          <Brand subtitle="Admin console" />
          <div className="ml-auto flex items-center gap-2">
            <Link href="/" className="hidden items-center gap-1.5 rounded-xl border border-foreground/10 bg-card/80 px-3 py-1.5 text-sm font-semibold hover:bg-card sm:flex">
              <ArrowLeft className="h-4 w-4" /> Portal
            </Link>
            <RaBadge compact />
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-16 pt-6 md:px-8 md:pt-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight md:text-3xl"><ShieldCheck className="h-7 w-7 text-primary" /> Admin console</h1>
            <p className="mt-1 text-sm text-muted-foreground">Manage who can sign in, see live sessions and requests, and review activity.</p>
          </div>
          <button type="button" onClick={() => setCreating(true)} data-testid="button-add-user"
            className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground shadow-sm active:scale-[0.98]">
            <UserPlus className="h-4 w-4" /> Add user
          </button>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat icon={Users} label="Accounts" value={list.length} detail={`${list.filter((u) => u.role === 'admin').length} admin · ${list.filter((u) => u.disabled).length} disabled`} />
          <Stat icon={MonitorPlay} label="Live sessions" value={live.length} detail={live.length ? 'Right now' : 'None right now'} accent={live.length > 0} />
          <Stat icon={Laptop} label="PCs online" value={overview.data?.hosts.unattended ?? 0} detail={`${overview.data?.hosts.attended ?? 0} attended code${overview.data?.hosts.attended === 1 ? '' : 's'} open`} />
          <Stat icon={Activity} label="Waiting requests" value={waiting.length} detail="Initiate requests" accent={waiting.length > 0} />
        </div>

        {problem && (
          <div role="alert" className="mt-5 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <span className="flex-1">{problem}</span>
            <button type="button" aria-label="Dismiss" onClick={() => setProblem(null)}><X className="h-4 w-4" /></button>
          </div>
        )}

        <nav aria-label="Admin sections" className="mt-6 flex w-full gap-1 overflow-x-auto rounded-xl bg-muted/80 p-1 sm:w-fit">
          {([['users', 'Users'], ['sessions', `Sessions${live.length ? ` (${live.length})` : ''}`], ['requests', 'Requests'], ['activity', 'Activity']] as const).map(([id, text]) => (
            <button key={id} type="button" onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined} data-testid={`admin-tab-${id}`}
              className={`flex-1 whitespace-nowrap rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors sm:flex-none ${tab === id ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
              {text}
            </button>
          ))}
        </nav>

        <section className="dl-rise mt-4">
          {tab === 'users' && (
            <UsersPanel users={list} me={me} now={now} loading={users.isPending}
              onRole={(u, role) => void run(() => updateUser(u.id, { role }), 'Could not change the role.')}
              onToggle={(u) => void run(() => updateUser(u.id, { disabled: !u.disabled }), 'Could not change the account.')}
              onRename={(u, displayName) => run(() => updateUser(u.id, { displayName }), 'Could not rename the account.')}
              onReset={(u, password) => run(() => updateUser(u.id, { password }), 'Could not reset the password.')}
              onDelete={(u) => {
                if (window.confirm(`Delete ${u.displayName} (@${u.username}, ${raLabel(u.raId)})?\n\nThey can no longer sign in, and PCs set to this RA ID can no longer send them requests.`)) {
                  void run(() => deleteUser(u.id), 'Could not delete the account.');
                }
              }} />
          )}
          {tab === 'sessions' && (
            <Panel title="Live sessions" icon={MonitorPlay} action={<Refresh onClick={reload} />}>
              {live.length === 0 ? <Empty text="No one is connected to a PC right now." /> : (
                <ul className="divide-y divide-foreground/8">
                  {live.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center gap-3 py-3">
                      <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-500/12 text-emerald-700"><MonitorPlay className="h-4.5 w-4.5" /></span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{s.name || 'Windows PC'} <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold capitalize text-muted-foreground">{s.mode}</span></p>
                        <p className="text-xs text-muted-foreground">
                          {s.operator ? `${s.operator.name} (${raLabel(s.operator.raId)})` : 'Unknown user'} · live for {duration(s.liveAt, now)} · {s.frames} frames, {bytes(s.bytes)}
                        </p>
                      </div>
                      <button type="button" data-testid={`button-end-${s.id}`}
                        onClick={() => { if (window.confirm(`End the session with ${s.name || 'this PC'}? The RA user is disconnected at once.`)) void run(() => endSessionAsAdmin(s.id), 'Could not end the session.'); }}
                        className="rounded-xl border border-destructive/30 px-3 py-1.5 text-sm font-semibold text-destructive hover:bg-destructive/10">
                        End session
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {overview.data && overview.data.live.some((s) => s.state === 'pending') && (
                <p className="mt-3 text-xs text-muted-foreground">
                  {overview.data.live.filter((s) => s.state === 'pending').length} attended session(s) waiting for the person at the PC to approve.
                </p>
              )}
            </Panel>
          )}
          {tab === 'requests' && (
            <Panel title="Initiate requests" icon={Activity} action={<Refresh onClick={reload} />}>
              <RequestList requests={overview.data?.requests ?? []} byRa={byRa} now={now} />
            </Panel>
          )}
          {tab === 'activity' && (
            <Panel title="Recent activity" icon={Activity} action={<Refresh onClick={reload} />}>
              {(overview.data?.activity.length ?? 0) === 0 ? <Empty text="Nothing yet. Sign-ins, account changes and sessions appear here." /> : (
                <ul className="divide-y divide-foreground/8">
                  {overview.data!.activity.map((a, i) => (
                    <li key={`${a.at}-${i}`} className="flex items-start gap-3 py-2.5 text-sm">
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${a.kind === 'login-failed' ? 'bg-destructive' : a.kind.startsWith('user') ? 'bg-primary' : 'bg-emerald-500'}`} />
                      <span className="flex-1">{a.text}</span>
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{relativeTime(a.at, now)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-xs text-muted-foreground">Activity is kept in the relay's memory and clears when it restarts.</p>
            </Panel>
          )}
        </section>

        {overview.data && (
          <p className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
            <Database className="h-3.5 w-3.5" /> Accounts are stored in {overview.data.storage}.
            {!overview.data.storage.startsWith('PostgreSQL') && ' On Replit Autoscale this file resets on redeploy; add a database (DATABASE_URL) or use a Reserved VM to keep accounts.'}
          </p>
        )}
      </main>

      <CreateUser open={creating} onClose={() => setCreating(false)} onCreated={reload} />
    </div>
  );
}

function Stat({ icon: Icon, label, value, detail, accent }: { icon: typeof Users; label: string; value: number; detail: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl border bg-card/90 p-4 shadow-[0_10px_30px_-24px_hsl(200_32%_13%/0.5)] ${accent ? 'border-primary/40' : ''}`}>
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground"><Icon className={`h-4 w-4 ${accent ? 'text-primary' : ''}`} /> {label}</div>
      <p className="mt-1 text-3xl font-extrabold tracking-tight">{value}</p>
      <p className="truncate text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function Panel({ title, icon: Icon, action, children }: { title: string; icon: typeof Users; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-2xl border bg-card/90 p-4 shadow-[0_10px_30px_-24px_hsl(200_32%_13%/0.5)] md:p-5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-bold"><Icon className="h-5 w-5 text-primary" /> {title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

const Refresh = ({ onClick }: { onClick: () => void }) => (
  <button type="button" onClick={onClick} className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">
    <RefreshCw className="h-3.5 w-3.5" /> Refresh
  </button>
);

const Empty = ({ text }: { text: string }) => <p className="py-8 text-center text-sm text-muted-foreground">{text}</p>;

const STATUS: Record<DesklineRequest['status'], string> = {
  waiting: 'bg-primary/12 text-primary',
  accepted: 'bg-emerald-500/12 text-emerald-700',
  missed: 'bg-amber-500/15 text-amber-700',
};

function RequestList({ requests, byRa, now }: { requests: DesklineRequest[]; byRa: Map<string, Account>; now: number }) {
  if (!requests.length) return <Empty text="No requests since the relay started. PCs send one when someone selects Initiate." />;
  return (
    <ul className="divide-y divide-foreground/8">
      {requests.map((r) => {
        const target = r.ra ? byRa.get(r.ra) : undefined;
        return (
          <li key={r.id} className="flex flex-wrap items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{r.name || 'Windows PC'} <span className="font-normal text-muted-foreground">· {r.mode}</span></p>
              <p className="text-xs text-muted-foreground">
                {r.ra ? `To ${target ? target.displayName : 'unknown user'} (${raLabel(r.ra)})` : 'To viewers with the access code'}
                {r.acceptedBy ? ` · accepted by ${r.acceptedBy.name}` : ''} · {relativeTime(r.at, now)}
              </p>
            </div>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${STATUS[r.status]}`}>{r.status}</span>
          </li>
        );
      })}
    </ul>
  );
}

function UsersPanel({ users, me, now, loading, onRole, onToggle, onRename, onReset, onDelete }: {
  users: Account[]; me: Account; now: number; loading: boolean;
  onRole: (u: Account, role: Account['role']) => void; onToggle: (u: Account) => void;
  onRename: (u: Account, name: string) => Promise<boolean>; onReset: (u: Account, password: string) => Promise<boolean>; onDelete: (u: Account) => void;
}) {
  const [query, setQuery] = useState('');
  const [reset, setReset] = useState<Account | null>(null);
  const [rename, setRename] = useState<Account | null>(null);
  const q = query.trim().toLowerCase().replace(/^ra-?/, '');
  const shown = users.filter((u) => !q || u.username.includes(q) || u.displayName.toLowerCase().includes(q) || u.raId.includes(q));
  return (
    <Panel title="Users" icon={Users} action={
      <label className="flex items-center gap-1.5 rounded-lg border bg-background px-2 py-1">
        <Search className="h-3.5 w-3.5 text-muted-foreground" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or RA ID" aria-label="Search users" className="w-40 bg-transparent text-xs outline-none" />
      </label>
    }>
      {loading ? <Empty text="Loading accounts…" /> : shown.length === 0 ? <Empty text="No accounts match." /> : (
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="px-1 py-2 font-semibold">Name</th>
                <th className="px-1 py-2 font-semibold">RA ID</th>
                <th className="px-1 py-2 font-semibold">Role</th>
                <th className="px-1 py-2 font-semibold">Status</th>
                <th className="px-1 py-2 font-semibold">Last sign-in</th>
                <th className="px-1 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-foreground/8">
              {shown.map((u) => (
                <tr key={u.id} data-testid={`user-${u.username}`} className={u.disabled ? 'opacity-60' : ''}>
                  <td className="px-1 py-2.5">
                    <p className="font-semibold">{u.displayName}{u.id === me.id && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span>}</p>
                    <p className="text-xs text-muted-foreground">@{u.username}</p>
                  </td>
                  <td className="px-1 py-2.5"><CopyRa raId={u.raId} /></td>
                  <td className="px-1 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${u.role === 'admin' ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'}`}>
                      {u.role === 'admin' ? 'Admin' : 'RA user'}
                    </span>
                  </td>
                  <td className="px-1 py-2.5">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${u.disabled ? 'text-muted-foreground' : 'text-emerald-700'}`}>
                      <i className={`h-1.5 w-1.5 rounded-full ${u.disabled ? 'bg-foreground/30' : 'bg-emerald-500'}`} /> {u.disabled ? 'Disabled' : 'Active'}
                    </span>
                  </td>
                  <td className="px-1 py-2.5 text-xs text-muted-foreground">{relativeTime(u.lastLoginAt, now)}</td>
                  <td className="px-1 py-2.5 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger aria-label={`Actions for ${u.displayName}`} data-testid={`button-actions-${u.username}`} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                        <MoreHorizontal className="h-4 w-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setRename(u)}>Rename</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setReset(u)} data-testid={`button-reset-${u.username}`}>Reset password</DropdownMenuItem>
                        {u.id !== me.id && (
                          <>
                            <DropdownMenuItem onSelect={() => onRole(u, u.role === 'admin' ? 'ra' : 'admin')}>{u.role === 'admin' ? 'Make RA user' : 'Make admin'}</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onToggle(u)}>{u.disabled ? 'Enable account' : 'Disable account'}</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => onDelete(u)} className="text-destructive focus:text-destructive" data-testid={`button-delete-${u.username}`}>Delete account</DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Give each person their RA ID to enter in the winss132r app on a PC (tray icon, Set RA ID). Initiate on that PC then goes straight to their portal.
      </p>
      <ResetPassword user={reset} onClose={() => setReset(null)} onReset={onReset} />
      <Rename user={rename} onClose={() => setRename(null)} onRename={onRename} />
    </Panel>
  );
}

function CopyRa({ raId }: { raId: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" title="Copy RA ID" onClick={() => { void navigator.clipboard.writeText(raLabel(raId)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); }}
      className="inline-flex items-center gap-1.5 rounded-lg bg-primary/8 px-2 py-1 font-mono text-xs font-bold text-primary hover:bg-primary/12">
      {raLabel(raId)} {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3 opacity-60" />}
    </button>
  );
}

const inputCls = 'w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40';

function PasswordField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2">
      <input className={`${inputCls} font-mono`} value={value} onChange={(e) => onChange(e.target.value)} minLength={8} required aria-label="Password" autoComplete="new-password" />
      <button type="button" onClick={() => onChange(generatePassword())} className="shrink-0 rounded-xl border px-3 text-xs font-semibold hover:bg-muted">Generate</button>
      <button type="button" aria-label="Copy password" disabled={!value} onClick={() => { void navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); }}
        className="shrink-0 rounded-xl border px-2.5 hover:bg-muted disabled:opacity-40">
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}

function CreateUser({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState(generatePassword);
  const [role, setRole] = useState<Account['role']>('ra');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ user: Account; password: string } | null>(null);
  const close = () => { setDisplayName(''); setUsername(''); setPassword(generatePassword()); setRole('ra'); setError(null); setCreated(null); onClose(); };
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await createUser({ displayName: displayName.trim() || undefined, username: username.trim(), password, role });
      setCreated({ user, password });
      onCreated();
    } catch (reason) {
      setError(errorText(reason, 'Could not create the account.'));
    } finally {
      setBusy(false);
    }
  }
  const summary = created && `winss132r portal: ${window.location.origin}\nUsername: ${created.user.username}\nPassword: ${created.password}\nYour RA ID: ${raLabel(created.user.raId)}`;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{created ? 'Account created' : 'Add user'}</DialogTitle>
          <DialogDescription>
            {created ? 'Share these sign-in details with them privately. The password is not shown again.' : 'Each account gets its own RA ID for PCs to send requests to.'}
          </DialogDescription>
        </DialogHeader>
        {created ? (
          <div className="space-y-3">
            <div className="rounded-2xl bg-foreground p-4 text-background">
              <p className="font-mono text-[11px] uppercase tracking-widest text-background/60">RA ID</p>
              <p className="font-mono text-3xl font-bold tracking-wider" data-testid="text-new-ra">{raLabel(created.user.raId)}</p>
              <p className="mt-3 text-sm">@{created.user.username} · <span className="font-mono">{created.password}</span></p>
            </div>
            <CopyButton text={summary!} label="Copy sign-in details" />
          </div>
        ) : (
          <form id="create-user" onSubmit={submit} className="space-y-3">
            <label className="block text-xs font-semibold text-muted-foreground">Full name
              <input className={`${inputCls} mt-1`} value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={60} placeholder="e.g. Priya Kumar" autoFocus data-testid="input-new-name" />
            </label>
            <label className="block text-xs font-semibold text-muted-foreground">Username
              <input className={`${inputCls} mt-1`} value={username} onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, ''))} maxLength={32} required
                placeholder="e.g. priya" autoCapitalize="none" spellCheck={false} data-testid="input-new-username" />
            </label>
            <div className="text-xs font-semibold text-muted-foreground">Password
              <div className="mt-1"><PasswordField value={password} onChange={setPassword} /></div>
            </div>
            <fieldset>
              <legend className="text-xs font-semibold text-muted-foreground">Role</legend>
              <div className="mt-1 grid grid-cols-2 gap-2">
                {([['ra', 'RA user', 'Answers requests and connects to PCs'], ['admin', 'Admin', 'Also manages users and sessions']] as const).map(([value, title, text]) => (
                  <button key={value} type="button" onClick={() => setRole(value)} aria-pressed={role === value}
                    className={`rounded-xl border p-3 text-left ${role === value ? 'border-primary bg-primary/8 ring-2 ring-primary/20' : 'hover:bg-muted'}`}>
                    <span className="block text-sm font-bold">{title}</span>
                    <span className="block text-xs text-muted-foreground">{text}</span>
                  </button>
                ))}
              </div>
            </fieldset>
            {error && <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          </form>
        )}
        <DialogFooter>
          {created ? (
            <button type="button" onClick={close} className="rounded-xl bg-foreground px-4 py-2 text-sm font-bold text-background">Done</button>
          ) : (
            <>
              <button type="button" onClick={close} className="rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-muted">Cancel</button>
              <button type="submit" form="create-user" disabled={busy || !username || password.length < 8} data-testid="button-create-user"
                className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-40">
                <Plus className="h-4 w-4" /> {busy ? 'Creating…' : 'Create account'}
              </button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" onClick={() => { void navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }).catch(() => {}); }}
      className="flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-muted">
      {copied ? <><Check className="h-4 w-4" /> Copied</> : <><Copy className="h-4 w-4" /> {label}</>}
    </button>
  );
}

function ResetPassword({ user, onClose, onReset }: { user: Account | null; onClose: () => void; onReset: (u: Account, p: string) => Promise<boolean> }) {
  const [password, setPassword] = useState(generatePassword);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const close = () => { setPassword(generatePassword()); setDone(false); onClose(); };
  return (
    <Dialog open={!!user} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reset password for {user?.displayName}</DialogTitle>
          <DialogDescription>{done ? 'Share the new password with them privately.' : 'They are signed out everywhere and must use the new password.'}</DialogDescription>
        </DialogHeader>
        {done ? (
          <>
            <p className="rounded-xl bg-foreground px-4 py-3 font-mono text-lg font-bold text-background">{password}</p>
            <CopyButton text={password} label="Copy password" />
          </>
        ) : <PasswordField value={password} onChange={setPassword} />}
        <DialogFooter>
          {done ? <button type="button" onClick={close} className="rounded-xl bg-foreground px-4 py-2 text-sm font-bold text-background">Done</button> : (
            <>
              <button type="button" onClick={close} className="rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-muted">Cancel</button>
              <button type="button" disabled={busy || password.length < 8}
                onClick={async () => { if (!user) return; setBusy(true); if (await onReset(user, password)) setDone(true); else close(); setBusy(false); }}
                className="rounded-xl bg-foreground px-4 py-2 text-sm font-bold text-background disabled:opacity-40">Reset password</button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Rename({ user, onClose, onRename }: { user: Account | null; onClose: () => void; onRename: (u: Account, n: string) => Promise<boolean> }) {
  const [name, setName] = useState('');
  useEffect(() => { setName(user?.displayName ?? ''); }, [user]);
  return (
    <Dialog open={!!user} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Rename {user?.username}</DialogTitle></DialogHeader>
        <form id="rename-user" onSubmit={async (e) => { e.preventDefault(); if (user && await onRename(user, name)) onClose(); }}>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus aria-label="Full name" />
        </form>
        <DialogFooter>
          <button type="button" onClick={onClose} className="rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-muted">Cancel</button>
          <button type="submit" form="rename-user" className="rounded-xl bg-foreground px-4 py-2 text-sm font-bold text-background">Save</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
