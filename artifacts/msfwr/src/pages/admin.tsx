import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createUser, deleteUser, getAdminOverview, getGetAdminOverviewQueryKey, getListUsersQueryKey, listUsers, updateUser,
  type Account, type AdminOverview, type MsfwrRequest,
} from '@workspace/api-client-react';
import {
  Activity, ArrowLeft, Building2, Check, Copy, Database, KeyRound, Laptop, MonitorPlay, MoreHorizontal, Plus, RefreshCw, Search, ShieldCheck,
  Users, X,
} from 'lucide-react';
import { Link } from 'wouter';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LinkRecordList } from '@/components/access-pins';
import { Brand, RaBadge, UserMenu } from '@/components/user-menu';
import { errorText, raLabel, useAuth } from '@/lib/auth';
import { relativeTime } from '@/lib/unattended';
import { takeLanding } from './sign-in';
import { SubscriptionsPanel, PaymentsPanel, SessionHistoryPanel } from './billing-admin';
import { AiBuddyPanel, SessionSummariesPanel } from './admin-buddy';
import { InspectBuddyPanel } from '@/components/inspect-buddy';
import { DashboardPanel, RegistrationsPanel, SiteSettingsPanel, useDashboard, type Registration } from './admin-dashboard';

type Tab = 'dashboard' | 'users' | 'subscriptions' | 'payments' | 'pcs' | 'sessions' | 'summaries' | 'buddy' | 'inspect' | 'requests' | 'registrations' | 'activity' | 'site';
const TABS: Tab[] = ['dashboard', 'users', 'subscriptions', 'payments', 'pcs', 'sessions', 'summaries', 'buddy', 'inspect', 'requests', 'registrations', 'activity', 'site'];

// Ends a session from the console (not part of the generated client).
async function endSessionAsAdmin(id: string) {
  const res = await fetch(`/api/admin/sessions/${encodeURIComponent(id)}/end`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', credentials: 'same-origin',
  });
  if (!res.ok) throw Object.assign(new Error('end failed'), { status: res.status, data: await res.json().catch(() => null) });
}

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


export default function Admin() {
  const { user: me } = useAuth();
  const client = useQueryClient();
  // The open section follows the URL hash (/admin#site), so it survives a reload.
  const [tab, setTabState] = useState<Tab>(() => {
    // Right after signing in, always open on the dashboard.
    if (takeLanding()) { if (typeof window !== 'undefined' && window.location.hash) window.history.replaceState(null, '', window.location.pathname); return 'dashboard'; }
    const h = typeof window !== 'undefined' ? window.location.hash.slice(1) : '';
    return (TABS as string[]).includes(h) ? (h as Tab) : 'dashboard';
  });
  const setTab = (t: string) => {
    if (!(TABS as string[]).includes(t)) return;
    setTabState(t as Tab);
    window.history.replaceState(null, '', t === 'dashboard' ? window.location.pathname : `#${t}`);
  };
  const [prefill, setPrefill] = useState<Registration | null>(null);
  const dashboard = useDashboard();
  const pendingRegistrations = dashboard.data?.registrations.pending ?? 0;
  const [now, setNow] = useState(Date.now);
  const [creating, setCreating] = useState(false);
  const [createKind, setCreateKind] = useState<'admin' | 'company'>('company');
  const [promote, setPromote] = useState<Account | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const users = useQuery({ queryKey: getListUsersQueryKey(), queryFn: () => listUsers(), refetchInterval: 15_000 });
  const overview = useQuery<AdminOverview>({ queryKey: getGetAdminOverviewQueryKey(), queryFn: () => getAdminOverview(), refetchInterval: 4000 });

  useEffect(() => {
    document.title = 'Admin console — WINRSS.net';
    const id = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(id);
  }, []);

  const list = users.data?.users ?? [];
  const live = overview.data?.live.filter((s) => s.state === 'live') ?? [];
  const waiting = overview.data?.requests.filter((r) => r.status === 'waiting') ?? [];
  const pcs = overview.data?.pcs ?? [];
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
            <p className="mt-1 text-sm text-muted-foreground">Manage company accounts (login ID and RA ID), and see PCs, sessions, requests and activity.</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => { setCreateKind('admin'); setCreating(true); }} data-testid="button-add-admin"
              className="flex items-center gap-2 rounded-xl border border-foreground/15 bg-card px-4 py-2.5 text-sm font-bold shadow-sm hover:bg-muted active:scale-[0.98]">
              <ShieldCheck className="h-4 w-4" /> Add WINRSS admin
            </button>
            <button type="button" onClick={() => { setCreateKind('company'); setCreating(true); }} data-testid="button-add-user"
              className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground shadow-sm active:scale-[0.98]">
              <Building2 className="h-4 w-4" /> Add customer company
            </button>
          </div>
        </div>

        {problem && (
          <div role="alert" className="mt-5 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <span className="flex-1">{problem}</span>
            <button type="button" aria-label="Dismiss" onClick={() => setProblem(null)}><X className="h-4 w-4" /></button>
          </div>
        )}

        <nav aria-label="Admin sections" className="mt-6 flex w-full max-w-full gap-1 overflow-x-auto rounded-xl bg-muted/80 p-1 sm:w-fit">
          {([['dashboard', 'Dashboard'], ['users', 'Companies'], ['subscriptions', 'Subscriptions'], ['payments', 'Payments'], ['pcs', `PCs${pcs.length ? ` (${pcs.length})` : ''}`], ['sessions', `Sessions${live.length ? ` (${live.length})` : ''}`], ['summaries', 'Session summaries'], ['buddy', 'AI Buddy'], ['inspect', 'Inspect Buddy'], ['requests', `Initiate${waiting.length ? ` (${waiting.length})` : ''}`], ['registrations', `Access requests${pendingRegistrations ? ` (${pendingRegistrations})` : ''}`], ['activity', 'Activity'], ['site', 'Site settings']] as const).map(([id, text]) => (
            <button key={id} type="button" onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined} data-testid={`admin-tab-${id}`}
              className={`flex-1 whitespace-nowrap rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors sm:flex-none ${tab === id ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
              {text}
            </button>
          ))}
        </nav>

        <section className="dl-rise mt-4">
          {tab === 'dashboard' && <DashboardPanel onOpen={setTab} onError={setProblem} />}
          {tab === 'registrations' && <RegistrationsPanel onError={setProblem} onCreateCompany={(r) => { setPrefill(r); setCreateKind('company'); setCreating(true); }} />}
          {tab === 'site' && <SiteSettingsPanel onError={setProblem} />}
          {tab === 'users' && (
            <UsersPanel users={list} me={me} now={now} loading={users.isPending}
              onRole={(u, role) => { if (role === 'admin') setPromote(u); else void run(() => updateUser(u.id, { role }), 'Could not change the role.'); }}
              onToggle={(u) => void run(() => updateUser(u.id, { disabled: !u.disabled }), 'Could not change the account.')}
              onRename={(u, displayName) => run(() => updateUser(u.id, { displayName }), 'Could not rename the account.')}
              onReset={(u, password) => run(() => updateUser(u.id, { password }), 'Could not reset the password.')}
              onRa={(u, raId) => run(() => updateUser(u.id, { raId }), 'Could not change the RA ID.')}
              onDelete={(u) => {
                if (window.confirm(`Delete ${u.displayName} (login ID ${u.username}, ${raLabel(u.raId)})?\n\nIt can no longer sign in, and PCs pointed to this RA ID no longer reach anyone.`)) {
                  void run(() => deleteUser(u.id), 'Could not delete the account.');
                }
              }} />
          )}
          {tab === 'subscriptions' && <SubscriptionsPanel onError={setProblem} />}
          {tab === 'payments' && <PaymentsPanel onError={setProblem} />}
          {tab === 'pcs' && (
            <Panel title="PCs online" icon={Laptop} action={<Refresh onClick={reload} />}>
              {pcs.length === 0 ? <Empty text="No PC with unattended access is connected to the relay right now." /> : (
                <ul className="divide-y divide-foreground/8">
                  {pcs.map((p) => {
                    const owner = p.ra ? byRa.get(p.ra) : undefined;
                    return (
                      <li key={p.id} className="flex flex-wrap items-center gap-3 py-2.5" data-testid={`pc-${p.name}`}>
                        <span className={`h-2 w-2 rounded-full ${p.state === 'waiting' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{p.name || 'Windows PC'}</p>
                          <p className="text-xs text-muted-foreground">
                            {p.ra ? `Points to ${owner ? owner.displayName : 'an unknown company'} (${raLabel(p.ra)})` : 'No RA ID set'} · online for {duration(p.createdAt, now)}
                          </p>
                        </div>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{p.state === 'waiting' ? 'Online' : 'In a session'}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="mt-3 text-xs text-muted-foreground">A PC re-registers every two minutes, so "online for" restarts then.</p>
            </Panel>
          )}
          {tab === 'pcs' && (
            <div className="mt-4">
              <Panel title="Remote access URLs" icon={KeyRound} action={<Refresh onClick={reload} />}>
                {(overview.data?.links?.length ?? 0) === 0 ? <Empty text="No PC has created a remote access URL yet." /> : (
                  <LinkRecordList records={overview.data!.links!} showCompany companyName={(ra) => byRa.get(ra)?.displayName} />
                )}
                <p className="mt-3 text-xs text-muted-foreground">Every URL a PC creates is recorded here. Opening one needs a company's Access PIN; the first company PIN used authorizes the URL for that company, and only that PIN opens it until it expires.</p>
              </Panel>
            </div>
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
                          {s.operator ? s.operator : s.mode === 'link' ? 'Opened with a remote access URL' : 'Unknown viewer'}{s.ra ? ` · ${raLabel(s.ra)}` : ''} · live for {duration(s.liveAt, now)}
                        </p>
                      </div>
                      <button type="button" data-testid={`button-end-${s.id}`}
                        onClick={() => { if (window.confirm(`End the session with ${s.name || 'this PC'}? The viewer is disconnected at once.`)) void run(() => endSessionAsAdmin(s.id), 'Could not end the session.'); }}
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
          {tab === 'sessions' && <div className="mt-4"><SessionHistoryPanel onError={setProblem} /></div>}
          {tab === 'summaries' && <SessionSummariesPanel onError={setProblem} />}
          {tab === 'buddy' && <AiBuddyPanel onError={setProblem} />}
          {tab === 'inspect' && <InspectBuddyPanel onError={setProblem} />}
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
            {!overview.data.storage.startsWith('PostgreSQL') && ' Keep this on a persistent disk (MSFWR_DATA_DIR) or set DATABASE_URL, or accounts are lost when the relay is redeployed.'}
          </p>
        )}
      </main>

      <CreateUser open={creating} kind={createKind} onKind={setCreateKind} prefill={prefill} onClose={() => { setCreating(false); setPrefill(null); }} onCreated={reload} />
      <PromoteAdmin user={promote} onClose={() => setPromote(null)} onPromote={(u, adminPin) => run(() => updateUser(u.id, { role: 'admin', adminPin }), 'Could not make this account an admin.')} />
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

const STATUS: Record<MsfwrRequest['status'], string> = {
  waiting: 'bg-primary/12 text-primary',
  accepted: 'bg-emerald-500/12 text-emerald-700',
  missed: 'bg-amber-500/15 text-amber-700',
};

function RequestList({ requests, byRa, now }: { requests: MsfwrRequest[]; byRa: Map<string, Account>; now: number }) {
  if (!requests.length) return <Empty text="No requests since the relay started. PCs send one when someone selects Initiate." />;
  return (
    <ul className="divide-y divide-foreground/8">
      {requests.map((r) => {
        const target = r.ra ? byRa.get(r.ra) : undefined;
        return (
          <li key={r.id} className="flex flex-wrap items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{r.name || 'Windows PC'}</p>
              <p className="text-xs text-muted-foreground">
                {r.ra ? `To ${target ? target.displayName : 'an unknown company'} (${raLabel(r.ra)})` : 'To browsers that saved the access code'}
                {r.acceptedBy ? ` · accepted by ${r.acceptedBy}` : ''} · {relativeTime(r.at, now)}
              </p>
            </div>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${STATUS[r.status]}`}>{r.status}</span>
          </li>
        );
      })}
    </ul>
  );
}

function UsersPanel({ users, me, now, loading, onRole, onToggle, onRename, onReset, onRa, onDelete }: {
  users: Account[]; me: Account; now: number; loading: boolean;
  onRole: (u: Account, role: Account['role']) => void; onToggle: (u: Account) => void;
  onRename: (u: Account, name: string) => Promise<boolean>; onReset: (u: Account, password: string) => Promise<boolean>;
  onRa: (u: Account, raId: string) => Promise<boolean>; onDelete: (u: Account) => void;
}) {
  const [query, setQuery] = useState('');
  const [reset, setReset] = useState<Account | null>(null);
  const [rename, setRename] = useState<Account | null>(null);
  const [changeRa, setChangeRa] = useState<Account | null>(null);
  const q = query.trim().toLowerCase().replace(/^ra-?/, '');
  const shown = users.filter((u) => !q || u.username.includes(q) || u.displayName.toLowerCase().includes(q) || u.raId.includes(q));
  return (
    <Panel title="Company accounts" icon={Users} action={
      <label className="flex items-center gap-1.5 rounded-lg border bg-background px-2 py-1">
        <Search className="h-3.5 w-3.5 text-muted-foreground" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, login ID or RA ID" aria-label="Search accounts" className="w-40 bg-transparent text-xs outline-none" />
      </label>
    }>
      {loading ? <Empty text="Loading accounts…" /> : shown.length === 0 ? <Empty text="No accounts match." /> : (
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="px-1 py-2 font-semibold">Company / login ID</th>
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
                    <p className="font-mono text-xs text-muted-foreground">{u.username}</p>
                  </td>
                  <td className="px-1 py-2.5"><CopyRa raId={u.raId} /></td>
                  <td className="px-1 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${u.role === 'admin' ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'}`}>
                      {u.role === 'admin' ? 'Admin' : 'Company'}
                    </span>
                  </td>
                  <td className="px-1 py-2.5">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${u.disabled ? 'text-muted-foreground' : 'text-emerald-700'}`}>
                      <i className={`h-1.5 w-1.5 rounded-full ${u.disabled ? 'bg-foreground/30' : 'bg-emerald-500'}`} /> {u.disabled ? 'Disabled' : 'Active'}
                    </span>
                    {u.mustChangePassword && !u.disabled && (
                      <span className="mt-0.5 block text-[11px] text-amber-700" data-testid={`text-temp-password-${u.username}`}>Temporary password</span>
                    )}
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
                        <DropdownMenuItem onSelect={() => setChangeRa(u)} data-testid={`button-ra-${u.username}`}>Change RA ID</DropdownMenuItem>
                        {u.id !== me.id && (
                          <>
                            <DropdownMenuItem onSelect={() => onRole(u, u.role === 'admin' ? 'company' : 'admin')}>{u.role === 'admin' ? 'Make company' : 'Make admin'}</DropdownMenuItem>
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
        Give each company its RA ID. On a PC, enter it in the WINRSS.net window (RA ID, Save): the PC then shows up for that company when it signs in, and
        Initiate: ask IT to connect goes to it.
      </p>
      <ResetPassword user={reset} onClose={() => setReset(null)} onReset={onReset} />
      <ChangeRa user={changeRa} onClose={() => setChangeRa(null)} onSave={onRa} />
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

// Six digits, typed like a PIN and never shown.
function AdminPinField({ value, onChange, testId }: { value: string; onChange: (v: string) => void; testId?: string }) {
  return (
    <label className="block text-xs font-semibold text-muted-foreground">Admin creation PIN <span className="font-normal">(6 digits)</span>
      <input className={`${inputCls} mt-1 font-mono tracking-[0.4em]`} type="password" inputMode="numeric" autoComplete="off" maxLength={6} required
        value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="••••••" data-testid={testId} />
    </label>
  );
}

function CreateUser({ open, kind, onKind, prefill, onClose, onCreated }: {
  open: boolean; kind: 'admin' | 'company'; onKind: (k: 'admin' | 'company') => void; prefill?: Registration | null; onClose: () => void; onCreated: () => void;
}) {
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState(generatePassword);
  const [raId, setRaId] = useState('');
  const [adminPin, setAdminPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ user: Account; password: string } | null>(null);
  const isAdmin = kind === 'admin';
  // Opened from an accepted access request: start from its company name.
  useEffect(() => {
    if (!open || !prefill) return;
    const name = prefill.company || prefill.name;
    setDisplayName(name);
    setUsername(name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32));
  }, [open, prefill]);
  const reset = () => { setDisplayName(''); setUsername(''); setPassword(generatePassword()); setRaId(''); setAdminPin(''); setError(null); setCreated(null); };
  const close = () => { reset(); onClose(); };
  const switchKind = (k: 'admin' | 'company') => { if (k !== kind) { setError(null); setAdminPin(''); onKind(k); } };
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await createUser(isAdmin
        ? { displayName: displayName.trim() || undefined, username: username.trim(), password, role: 'admin', adminPin }
        : { displayName: displayName.trim() || undefined, username: username.trim(), password, role: 'company', raId: raId.trim() || undefined });
      setCreated({ user, password });
      setAdminPin('');
      onCreated();
    } catch (reason) {
      setError(errorText(reason, 'Could not create the account.'));
    } finally {
      setBusy(false);
    }
  }
  const summary = created && (created.user.role === 'admin'
    ? `WINRSS.net admin console: ${window.location.origin}/admin\nLogin ID: ${created.user.username}\nPassword: ${created.password}`
    : `WINRSS.net sign-in: ${window.location.origin}\nLogin ID: ${created.user.username}\nPassword: ${created.password}\nRA ID (enter it on your PCs): ${raLabel(created.user.raId)}`);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{created ? (created.user.role === 'admin' ? 'Admin account created' : 'Company created') : 'Create an account'}</DialogTitle>
          <DialogDescription>
            {created ? 'Share these sign-in details privately. The password is not shown again.'
              : isAdmin ? 'A WINRSS admin manages every company, subscription and setting in this console. It needs the admin creation PIN.'
              : 'A customer company signs in with its login ID. PCs pointed to its RA ID show up for it, with their requests.'}
          </DialogDescription>
        </DialogHeader>
        {!created && (
          <div role="tablist" aria-label="Account type" className="grid grid-cols-2 gap-1 rounded-xl bg-muted/80 p-1">
            {([['company', 'Customer company creation', Building2], ['admin', 'WINRSS admin account creation', ShieldCheck]] as const).map(([value, label, Icon]) => (
              <button key={value} type="button" role="tab" aria-selected={kind === value} onClick={() => switchKind(value)} data-testid={`create-tab-${value}`}
                className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-bold transition-colors ${kind === value
                  ? value === 'admin' ? 'bg-foreground text-background shadow-sm' : 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'}`}>
                <Icon className="h-3.5 w-3.5 shrink-0" /> <span className="text-left leading-tight">{label}</span>
              </button>
            ))}
          </div>
        )}
        {created ? (
          <div className="space-y-3">
            <div className="rounded-2xl bg-foreground p-4 text-background">
              {created.user.role === 'admin' ? (
                <>
                  <p className="font-mono text-[11px] uppercase tracking-widest text-background/60">WINRSS admin</p>
                  <p className="font-mono text-2xl font-bold" data-testid="text-new-admin">{created.user.username}</p>
                </>
              ) : (
                <>
                  <p className="font-mono text-[11px] uppercase tracking-widest text-background/60">RA ID</p>
                  <p className="font-mono text-3xl font-bold tracking-wider" data-testid="text-new-ra">{raLabel(created.user.raId)}</p>
                </>
              )}
              <p className="mt-3 text-sm">{created.user.displayName} · login ID <span className="font-mono">{created.user.username}</span> · <span className="font-mono">{created.password}</span></p>
            </div>
            <CopyButton text={summary!} label="Copy sign-in details" />
          </div>
        ) : (
          <form id="create-user" onSubmit={submit} className="space-y-3" key={kind}>
            <label className="block text-xs font-semibold text-muted-foreground">{isAdmin ? 'Admin name' : 'Company name'}
              <input className={`${inputCls} mt-1`} value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={80}
                placeholder={isAdmin ? 'e.g. Priya (WINRSS support)' : 'e.g. Acme Ltd'} autoFocus data-testid="input-new-name" />
            </label>
            <label className="block text-xs font-semibold text-muted-foreground">Login ID
              <input className={`${inputCls} mt-1`} value={username} onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, ''))} maxLength={32} required
                placeholder={isAdmin ? 'e.g. priya' : 'e.g. acme'} autoCapitalize="none" spellCheck={false} data-testid="input-new-username" />
            </label>
            {!isAdmin && (
              <label className="block text-xs font-semibold text-muted-foreground">RA ID <span className="font-normal">(six digits; leave empty to generate one)</span>
                <input className={`${inputCls} mt-1 font-mono`} value={raId} onChange={(e) => setRaId(e.target.value.toUpperCase())} maxLength={9}
                  placeholder="RA-123456" spellCheck={false} data-testid="input-new-ra" />
              </label>
            )}
            <div className="text-xs font-semibold text-muted-foreground">Temporary password <span className="font-normal">(they choose their own at first sign-in)</span>
              <div className="mt-1"><PasswordField value={password} onChange={setPassword} /></div>
            </div>
            {isAdmin && (
              <div className="rounded-xl border border-foreground/15 bg-muted/40 p-3">
                <AdminPinField value={adminPin} onChange={setAdminPin} testId="input-admin-pin" />
                <p className="mt-1.5 text-[11px] text-muted-foreground">Ask the WINRSS owner for this PIN. It is checked by the relay and never stored in the browser.</p>
              </div>
            )}
            {error && <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          </form>
        )}
        <DialogFooter>
          {created ? (
            <button type="button" onClick={close} className="rounded-xl bg-foreground px-4 py-2 text-sm font-bold text-background">Done</button>
          ) : (
            <>
              <button type="button" onClick={close} className="rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-muted">Cancel</button>
              <button type="submit" form="create-user" disabled={busy || !username || password.length < 8 || (isAdmin && adminPin.length !== 6)} data-testid="button-create-user"
                className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold disabled:opacity-40 ${isAdmin ? 'bg-foreground text-background' : 'bg-primary text-primary-foreground'}`}>
                <Plus className="h-4 w-4" /> {busy ? 'Creating…' : isAdmin ? 'Create admin' : 'Create company'}
              </button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Making an existing account an admin needs the same PIN.
function PromoteAdmin({ user, onClose, onPromote }: { user: Account | null; onClose: () => void; onPromote: (u: Account, pin: string) => Promise<boolean> }) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const close = () => { setPin(''); onClose(); };
  return (
    <Dialog open={!!user} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Make {user?.displayName} a WINRSS admin?</DialogTitle>
          <DialogDescription>Admins manage every company, subscription and setting. Enter the admin creation PIN to continue.</DialogDescription>
        </DialogHeader>
        <form id="promote-admin" onSubmit={async (e) => { e.preventDefault(); if (!user) return; setBusy(true); await onPromote(user, pin); setBusy(false); close(); }}>
          <AdminPinField value={pin} onChange={setPin} testId="input-promote-pin" />
        </form>
        <DialogFooter>
          <button type="button" onClick={close} className="rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-muted">Cancel</button>
          <button type="submit" form="promote-admin" disabled={busy || pin.length !== 6} className="rounded-xl bg-foreground px-4 py-2 text-sm font-bold text-background disabled:opacity-40">Make admin</button>
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
          <DialogDescription>{done ? 'Share the new password with them privately.' : 'They are signed out everywhere, sign in with this password, then choose their own.'}</DialogDescription>
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
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus aria-label="Company name" />
        </form>
        <DialogFooter>
          <button type="button" onClick={onClose} className="rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-muted">Cancel</button>
          <button type="submit" form="rename-user" className="rounded-xl bg-foreground px-4 py-2 text-sm font-bold text-background">Save</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChangeRa({ user, onClose, onSave }: { user: Account | null; onClose: () => void; onSave: (u: Account, raId: string) => Promise<boolean> }) {
  const [value, setValue] = useState('');
  useEffect(() => { setValue(user ? raLabel(user.raId) : ''); }, [user]);
  return (
    <Dialog open={!!user} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Change RA ID for {user?.displayName}</DialogTitle>
          <DialogDescription>PCs still set to the old RA ID stop showing up for this company until they are given the new one.</DialogDescription>
        </DialogHeader>
        <form id="change-ra" onSubmit={async (e) => { e.preventDefault(); if (user && await onSave(user, value)) onClose(); }}>
          <input className={`${inputCls} font-mono`} value={value} onChange={(e) => setValue(e.target.value.toUpperCase())} maxLength={9} autoFocus aria-label="RA ID" data-testid="input-change-ra" />
        </form>
        <DialogFooter>
          <button type="button" onClick={onClose} className="rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-muted">Cancel</button>
          <button type="submit" form="change-ra" className="rounded-xl bg-foreground px-4 py-2 text-sm font-bold text-background">Save</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
