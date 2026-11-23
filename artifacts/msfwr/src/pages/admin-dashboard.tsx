import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, BadgeCheck, Building2, CalendarClock, Check, ClipboardList, ImageIcon, IndianRupee, Inbox, Laptop, Mail, MessageSquare, MonitorPlay,
  Phone, RefreshCw, Save, Send, Settings2, Trash2, Upload, X,
} from 'lucide-react';
import { errorText, raLabel } from '@/lib/auth';
import { relativeTime } from '@/lib/unattended';
import { SITE_KEY, type AssetInfo, type SiteSettings } from '@/lib/site';

// The admin dashboard, the access requests from the sign-in page, and the
// site settings. All three talk to /api/admin with the login cookie.

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/admin${path}`, {
    credentials: 'same-origin',
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    ...init,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw Object.assign(new Error('request failed'), { status: res.status, data });
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

const inr = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);
const dateFmt = (ms: number) => new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const dayFmt = (ms: number) => new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

export type RegistrationComment = { id: string; text: string; by: string; at: number };
export type Registration = {
  id: string; name: string; company: string; email: string; mobile: string; message: string;
  status: 'pending' | 'accepted' | 'rejected'; outcome: '' | 'converted' | 'closed'; actionPlan: string;
  comments: RegistrationComment[]; note: string; createdAt: number; updatedAt: number;
};

// A wa.me link that opens WhatsApp (web or app) on a chat with this number.
// Numbers without a country code are taken as Indian, as the request form asks.
export function whatsappLink(mobile: string, text?: string) {
  let digits = mobile.replace(/\D/g, '');
  if (!mobile.trim().startsWith('+')) {
    if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
    if (digits.length === 10) digits = `91${digits}`;
  }
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}
type DuePayment = { id: string; accountId: string; company: string; amountInr: number; dueDate: number; status: string };
type LiveSession = { id: string; name?: string; mode: string; operator?: string; ra?: string; liveAt?: number };
export type Dashboard = {
  now: number;
  companies: { total: number; active: number; disabled: number; admins: number };
  sessions: { live: LiveSession[]; pending: number; pcsOnline: number; waitingRequests: number; last30Days: number; days: { day: number; sessions: number; minutes: number }[] };
  subscriptions: { active: number; trial: number; expired: number; suspended: number; none: number; mrrInr: number; expiringSoon: { accountId: string; company: string; status: string; currentPeriodEnd: number }[] };
  payments: { overdueCount: number; overdueAmountInr: number; upcomingCount: number; upcomingAmountInr: number; overdue: DuePayment[]; upcoming: DuePayment[] };
  registrations: { pending: number; accepted: number; rejected: number; converted: number; closed: number; total: number; latest: Registration[] };
  activity: { at: number; kind: string; text: string }[];
};

export const DASHBOARD_KEY = ['admin-dashboard'] as const;
export const REGISTRATIONS_KEY = ['admin-registrations'] as const;

export function useDashboard() {
  return useQuery<Dashboard>({ queryKey: DASHBOARD_KEY, queryFn: () => api<Dashboard>('/dashboard'), refetchInterval: 10_000 });
}

function Card({ title, icon: Icon, action, children, className = '' }: { title: string; icon: typeof Inbox; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border bg-card/90 p-4 shadow-[0_10px_30px_-24px_hsl(200_32%_13%/0.5)] md:p-5 ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-bold"><Icon className="h-4.5 w-4.5 text-primary" /> {title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

function Tile({ icon: Icon, label, value, detail, tone, onClick, testId }: {
  icon: typeof Inbox; label: string; value: ReactNode; detail: ReactNode; tone?: 'accent' | 'warn'; onClick?: () => void; testId?: string;
}) {
  const ring = tone === 'warn' ? 'border-destructive/40' : tone === 'accent' ? 'border-primary/40' : '';
  const iconTone = tone === 'warn' ? 'text-destructive' : tone === 'accent' ? 'text-primary' : '';
  const body = (
    <>
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground"><Icon className={`h-4 w-4 ${iconTone}`} /> {label}</div>
      <p className="mt-1 text-3xl font-extrabold tracking-tight" data-testid={testId}>{value}</p>
      <p className="truncate text-xs text-muted-foreground">{detail}</p>
    </>
  );
  const cls = `rounded-2xl border bg-card/90 p-4 text-left shadow-[0_10px_30px_-24px_hsl(200_32%_13%/0.5)] ${ring}`;
  return onClick
    ? <button type="button" onClick={onClick} className={`${cls} transition-colors hover:bg-card`}>{body}</button>
    : <div className={cls}>{body}</div>;
}

const Empty = ({ text }: { text: string }) => <p className="py-6 text-center text-sm text-muted-foreground">{text}</p>;

// Sessions per day over the last 14 days: one series, so no legend; the
// card title names it. Hovering a bar shows its day and count.
function SessionBars({ days }: { days: Dashboard['sessions']['days'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((d) => d.sessions));
  const total = days.reduce((t, d) => t + d.sessions, 0);
  return (
    <div>
      <div className="relative flex h-32 items-end gap-[2px] border-b border-foreground/15" onMouseLeave={() => setHover(null)} role="img"
        aria-label={`Sessions per day for the last 14 days, ${total} in total`}>
        {days.map((d, i) => (
          <div key={d.day} className="flex h-full flex-1 items-end" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0}>
            <div className={`w-full rounded-t-[4px] ${hover === i ? 'bg-primary' : 'bg-primary/70'}`}
              style={{ height: d.sessions ? `${Math.max(4, (d.sessions / max) * 100)}%` : '0%' }} />
          </div>
        ))}
        {hover !== null && (
          <div className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border bg-popover px-2.5 py-1.5 text-xs shadow-md"
            style={{ left: `${((hover + 0.5) / days.length) * 100}%` }}>
            <p className="font-semibold">{dayFmt(days[hover].day)}</p>
            <p className="text-muted-foreground">{days[hover].sessions} session{days[hover].sessions === 1 ? '' : 's'} · {days[hover].minutes} min</p>
          </div>
        )}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
        <span>{days[0] && dayFmt(days[0].day)}</span>
        <span>Today</span>
      </div>
    </div>
  );
}

export function DashboardPanel({ onOpen, onError }: { onOpen: (tab: string) => void; onError: (m: string | null) => void }) {
  const q = useDashboard();
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 5000); return () => window.clearInterval(id); }, []);
  useEffect(() => { if (q.isError) onError(errorText(q.error, 'Could not load the dashboard.')); }, [q.isError, q.error, onError]);
  const d = q.data;
  if (!d) return <Empty text={q.isError ? 'The dashboard could not be loaded.' : 'Loading the dashboard…'} />;
  const subTotal = d.subscriptions.active + d.subscriptions.trial + d.subscriptions.expired + d.subscriptions.suspended;
  return (
    <div className="space-y-4" data-testid="admin-dashboard">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Tile icon={MonitorPlay} label="Live sessions" value={d.sessions.live.length} testId="stat-live"
          detail={d.sessions.pending ? `${d.sessions.pending} waiting to be approved` : 'Right now'} tone={d.sessions.live.length ? 'accent' : undefined} onClick={() => onOpen('sessions')} />
        <Tile icon={Building2} label="Companies" value={d.companies.total} testId="stat-companies"
          detail={`${d.companies.active} active · ${d.companies.disabled} disabled`} onClick={() => onOpen('users')} />
        <Tile icon={BadgeCheck} label="Subscriptions" value={d.subscriptions.active + d.subscriptions.trial} testId="stat-subscriptions"
          detail={`${d.subscriptions.trial} trial · ${d.subscriptions.expired} expired`} onClick={() => onOpen('subscriptions')} />
        <Tile icon={IndianRupee} label="Monthly revenue" value={inr(d.subscriptions.mrrInr)} detail="From active plans" onClick={() => onOpen('subscriptions')} />
        <Tile icon={AlertTriangle} label="Payments overdue" value={d.payments.overdueCount} testId="stat-overdue"
          detail={d.payments.overdueCount ? inr(d.payments.overdueAmountInr) : 'Nothing overdue'} tone={d.payments.overdueCount ? 'warn' : undefined} onClick={() => onOpen('payments')} />
        <Tile icon={Inbox} label="Access requests" value={d.registrations.pending} testId="stat-registrations"
          detail={`pending · ${d.registrations.total} in total`} tone={d.registrations.pending ? 'accent' : undefined} onClick={() => onOpen('registrations')} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Ongoing sessions" icon={MonitorPlay} className="lg:col-span-2"
          action={<span className="text-xs text-muted-foreground"><Laptop className="mr-1 inline h-3.5 w-3.5" />{d.sessions.pcsOnline} PCs online · {d.sessions.waitingRequests} Initiate waiting</span>}>
          {d.sessions.live.length === 0 ? <Empty text="No one is connected to a PC right now." /> : (
            <ul className="divide-y divide-foreground/8">
              {d.sessions.live.slice(0, 8).map((s) => (
                <li key={s.id} className="flex items-center gap-3 py-2 text-sm">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                  <span className="min-w-0 flex-1 truncate"><span className="font-semibold">{s.name || 'Windows PC'}</span>
                    <span className="text-muted-foreground"> · {s.operator || (s.mode === 'link' ? 'Remote access URL' : 'Unknown viewer')}{s.ra ? ` · ${raLabel(s.ra)}` : ''}</span></span>
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{s.liveAt ? relativeTime(s.liveAt, now).replace(' ago', '') : ''}</span>
                </li>
              ))}
            </ul>
          )}
          {d.sessions.live.length > 8 && <button type="button" onClick={() => onOpen('sessions')} className="mt-2 text-xs font-semibold text-primary">See all {d.sessions.live.length}</button>}
        </Card>
        <Card title="Sessions, last 14 days" icon={CalendarClock} action={<span className="text-xs text-muted-foreground">{d.sessions.last30Days} in 30 days</span>}>
          <SessionBars days={d.sessions.days} />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Payment dues" icon={IndianRupee} action={<button type="button" onClick={() => onOpen('payments')} className="text-xs font-semibold text-primary">Payments</button>}>
          <p className="text-xs text-muted-foreground">Overdue {inr(d.payments.overdueAmountInr)} · due in 30 days {inr(d.payments.upcomingAmountInr)}</p>
          {d.payments.overdue.length + d.payments.upcoming.length === 0 ? <Empty text="No open dues." /> : (
            <ul className="mt-2 divide-y divide-foreground/8">
              {[...d.payments.overdue, ...d.payments.upcoming].slice(0, 8).map((p) => (
                <li key={p.id} className="flex items-center gap-2 py-2 text-sm">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${p.status === 'overdue' ? 'bg-destructive/12 text-destructive' : 'bg-amber-500/15 text-amber-700'}`}>
                    {p.status === 'overdue' ? 'Overdue' : 'Due'}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-semibold">{p.company}</span>
                  <span className="shrink-0 text-right text-xs"><span className="font-semibold">{inr(p.amountInr)}</span><br /><span className="text-muted-foreground">{dateFmt(p.dueDate)}</span></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Subscriptions" icon={BadgeCheck} action={<button type="button" onClick={() => onOpen('subscriptions')} className="text-xs font-semibold text-primary">Manage</button>}>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            {([['Active', d.subscriptions.active], ['Trial', d.subscriptions.trial], ['Expired', d.subscriptions.expired], ['Suspended', d.subscriptions.suspended], ['No plan', d.subscriptions.none]] as const).map(([k, v]) => (
              <div key={k} className="rounded-xl bg-muted/60 px-3 py-2"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="text-lg font-bold">{v}</dd></div>
            ))}
            <div className="rounded-xl bg-muted/60 px-3 py-2"><dt className="text-xs text-muted-foreground">With a plan</dt><dd className="text-lg font-bold">{subTotal}</dd></div>
          </dl>
          {d.subscriptions.expiringSoon.length > 0 && (
            <>
              <p className="mt-3 text-xs font-semibold text-muted-foreground">Ending within 7 days</p>
              <ul className="mt-1 space-y-1 text-sm">
                {d.subscriptions.expiringSoon.map((s) => (
                  <li key={s.accountId} className="flex justify-between gap-2"><span className="truncate">{s.company}</span><span className="shrink-0 text-xs text-muted-foreground">{dateFmt(s.currentPeriodEnd)}</span></li>
                ))}
              </ul>
            </>
          )}
        </Card>
        <Card title="New access requests" icon={Inbox} action={<button type="button" onClick={() => onOpen('registrations')} className="text-xs font-semibold text-primary">All requests</button>}>
          <p className="text-xs text-muted-foreground">{d.registrations.pending} pending · {d.registrations.accepted} accepted · {d.registrations.rejected} rejected · {d.registrations.converted} converted</p>
          {d.registrations.latest.length === 0 ? <Empty text="No pending requests." /> : (
            <ul className="mt-2 divide-y divide-foreground/8">
              {d.registrations.latest.map((r) => (
                <li key={r.id} className="py-2 text-sm">
                  <p className="truncate font-semibold">{r.name}{r.company ? <span className="font-normal text-muted-foreground"> · {r.company}</span> : null}</p>
                  <p className="truncate text-xs text-muted-foreground">{r.email} · {r.mobile} · {relativeTime(r.createdAt, now)}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Recent activity" icon={RefreshCw} action={<button type="button" onClick={() => onOpen('activity')} className="text-xs font-semibold text-primary">All activity</button>}>
        {d.activity.length === 0 ? <Empty text="Nothing yet." /> : (
          <ul className="divide-y divide-foreground/8">
            {d.activity.map((a, i) => (
              <li key={`${a.at}-${i}`} className="flex items-start gap-3 py-2 text-sm">
                <span className="flex-1">{a.text}</span>
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{relativeTime(a.at, now)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// --- Access requests from the sign-in page ---

const REG_STATUS: Record<Registration['status'], [string, string]> = {
  pending: ['Pending', 'bg-primary/12 text-primary'],
  accepted: ['Accepted', 'bg-emerald-500/12 text-emerald-700'],
  rejected: ['Rejected', 'bg-muted text-muted-foreground'],
};
const OUTCOME: Record<Exclude<Registration['outcome'], ''>, [string, string]> = {
  converted: ['Converted to customer', 'bg-emerald-600 text-white'],
  closed: ['Query closed', 'bg-foreground/80 text-background'],
};
type RegFilter = 'pending' | 'accepted' | 'rejected' | 'converted' | 'closed' | 'all';
const FILTERS: [RegFilter, string][] = [['pending', 'Pending'], ['accepted', 'Accepted'], ['rejected', 'Rejected'], ['converted', 'Converted'], ['closed', 'Closed'], ['all', 'All']];

const regPath = (id: string, rest = '') => `/registrations/${encodeURIComponent(id)}${rest}`;

export function RegistrationsPanel({ onError, onCreateCompany }: { onError: (m: string | null) => void; onCreateCompany: (r: Registration) => void }) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: REGISTRATIONS_KEY, queryFn: () => api<{ registrations: Registration[] }>('/registrations'), refetchInterval: 20_000 });
  const [filter, setFilter] = useState<RegFilter>('pending');
  const [open, setOpen] = useState<string | null>(null);
  const [now] = useState(Date.now);
  const list = q.data?.registrations ?? [];
  const matches = (r: Registration, f: RegFilter) => f === 'all' || (f === 'converted' || f === 'closed' ? r.outcome === f : r.status === f);
  const shown = list.filter((r) => matches(r, filter));

  async function act(fn: () => Promise<unknown>, fallback: string) {
    onError(null);
    try {
      await fn();
      await client.invalidateQueries({ queryKey: REGISTRATIONS_KEY });
      void client.invalidateQueries({ queryKey: DASHBOARD_KEY });
      return true;
    } catch (e) { onError(errorText(e, fallback)); return false; }
  }
  const patch = (r: Registration, body: Record<string, unknown>) =>
    act(() => api(regPath(r.id), { method: 'PATCH', body: JSON.stringify(body) }), 'Could not update the request.');

  return (
    <Card title="Access requests" icon={Inbox} action={
      <div className="flex flex-wrap gap-1 rounded-lg bg-muted/80 p-0.5 text-xs">
        {FILTERS.map(([f, label]) => (
          <button key={f} type="button" onClick={() => setFilter(f)} data-testid={`reg-filter-${f}`}
            className={`rounded-md px-2.5 py-1 font-semibold ${filter === f ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}>
            {label}{f !== 'all' ? ` (${list.filter((r) => matches(r, f)).length})` : ''}
          </button>
        ))}
      </div>
    }>
      <p className="-mt-1 mb-2 text-xs text-muted-foreground">People who asked to buy WINRSS.net from the "Request access" form on the sign-in page. Accept or reject each one, keep an action plan and comments, and close it as converted to customer or query closed.</p>
      {q.isPending ? <Empty text="Loading…" /> : shown.length === 0 ? <Empty text={filter === 'pending' ? 'No pending requests.' : 'No requests here.'} /> : (
        <ul className="divide-y divide-foreground/8">
          {shown.map((r) => (
            <RegistrationRow key={r.id} r={r} now={now} expanded={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)}
              onPatch={(body) => patch(r, body)} onCreateCompany={() => onCreateCompany(r)}
              onComment={(text) => act(() => api(regPath(r.id, '/comments'), { method: 'POST', body: JSON.stringify({ text }) }), 'Could not add the comment.')}
              onRemoveComment={(id) => act(() => api(regPath(r.id, `/comments/${encodeURIComponent(id)}`), { method: 'DELETE' }), 'Could not remove the comment.')}
              onDelete={() => { if (window.confirm(`Delete the request from ${r.name}?`)) void act(() => api(regPath(r.id), { method: 'DELETE' }), 'Could not delete the request.'); }} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function WhatsAppIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91A9.85 9.85 0 0 0 12.04 2Zm0 18.15a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24a8.24 8.24 0 0 1 8.24 8.25c0 4.54-3.7 8.23-8.25 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.51.11-.11.25-.29.37-.43.13-.15.17-.25.25-.42.08-.17.04-.31-.02-.43-.06-.13-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48a.92.92 0 0 0-.66.31c-.23.25-.87.85-.87 2.07 0 1.22.89 2.4 1.01 2.56.13.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.23-.17-.48-.29Z" />
    </svg>
  );
}

function RegistrationRow({ r, now, expanded, onToggle, onPatch, onComment, onRemoveComment, onCreateCompany, onDelete }: {
  r: Registration; now: number; expanded: boolean; onToggle: () => void;
  onPatch: (body: Record<string, unknown>) => Promise<boolean>; onComment: (text: string) => Promise<boolean>;
  onRemoveComment: (id: string) => Promise<boolean>; onCreateCompany: () => void; onDelete: () => void;
}) {
  const [plan, setPlan] = useState(r.actionPlan);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setPlan(r.actionPlan); }, [r.actionPlan]);
  const [statusLabel, statusCls] = REG_STATUS[r.status];
  const wa = whatsappLink(r.mobile, `Hi ${r.name}, this is WINRSS.net. Thank you for your interest in remote support for Windows.`);
  const run = async (fn: () => Promise<boolean>) => { setBusy(true); try { return await fn(); } finally { setBusy(false); } };
  const btn = 'inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold disabled:opacity-50';
  return (
    <li className="py-3" data-testid={`registration-${r.id}`}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{r.name}{r.company && <span className="font-normal text-muted-foreground"> · {r.company}</span>}
            <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusCls}`}>{statusLabel}</span>
            {r.outcome && <span className={`ml-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${OUTCOME[r.outcome][1]}`}>{OUTCOME[r.outcome][0]}</span>}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <a href={`mailto:${r.email}`} className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"><Mail className="h-3.5 w-3.5" />{r.email}</a>
            <a href={`tel:${r.mobile.replace(/[^+\d]/g, '')}`} className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"><Phone className="h-3.5 w-3.5" />{r.mobile}</a>
            <a href={wa} target="_blank" rel="noreferrer" data-testid={`link-whatsapp-${r.id}`}
              className="inline-flex items-center gap-1 rounded-full bg-[#25D366]/12 px-2 py-0.5 text-xs font-semibold text-[#128C4A] hover:bg-[#25D366]/20 dark:text-[#4ADE80]">
              <WhatsAppIcon className="h-3.5 w-3.5" /> WhatsApp
            </a>
            <span className="text-xs leading-5 text-muted-foreground">{relativeTime(r.createdAt, now)}</span>
          </p>
          {r.message && <p className="mt-1.5 whitespace-pre-line rounded-lg bg-muted/60 px-3 py-2 text-sm">{r.message}</p>}
          {!expanded && (r.actionPlan || r.comments.length > 0) && (
            <p className="mt-1.5 truncate text-xs text-muted-foreground">
              {r.actionPlan && <><b className="text-foreground">Plan:</b> {r.actionPlan.split('\n')[0]} </>}
              {r.comments.length > 0 && <>· {r.comments.length} comment{r.comments.length === 1 ? '' : 's'}</>}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {r.status !== 'accepted' && (
            <button type="button" disabled={busy} onClick={() => void run(() => onPatch({ status: 'accepted' }))} data-testid={`button-accept-${r.id}`}
              className={`${btn} border-emerald-600/30 text-emerald-700 hover:bg-emerald-500/10`}><Check className="h-3.5 w-3.5" /> Accept</button>
          )}
          {r.status !== 'rejected' && (
            <button type="button" disabled={busy} onClick={() => void run(() => onPatch({ status: 'rejected' }))} data-testid={`button-reject-${r.id}`}
              className={`${btn} border-destructive/30 text-destructive hover:bg-destructive/10`}><X className="h-3.5 w-3.5" /> Reject</button>
          )}
          {r.status === 'accepted' && r.outcome !== 'closed' && (
            <button type="button" onClick={onCreateCompany} data-testid={`button-create-company-${r.id}`}
              className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground"><Building2 className="h-3.5 w-3.5" /> Create company</button>
          )}
          {r.status !== 'pending' && (
            <button type="button" disabled={busy} onClick={() => void run(() => onPatch({ status: 'pending', outcome: '' }))} className={`${btn} hover:bg-muted`}>Reopen</button>
          )}
          <button type="button" onClick={onToggle} aria-expanded={expanded} data-testid={`button-followup-${r.id}`}
            className={`${btn} ${expanded ? 'border-primary/40 bg-primary/8 text-primary' : 'hover:bg-muted'}`}>
            <MessageSquare className="h-3.5 w-3.5" /> Follow-up{r.comments.length ? ` (${r.comments.length})` : ''}
          </button>
          <button type="button" aria-label="Delete request" title="Delete" onClick={onDelete}
            className="rounded-lg border px-2 py-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      </div>

      {expanded && (
        <div className="dl-rise mt-3 grid gap-4 rounded-xl border bg-background/60 p-3 md:grid-cols-2" data-testid={`followup-${r.id}`}>
          <div className="space-y-3">
            <div>
              <p className="mb-1 text-xs font-semibold text-muted-foreground">Outcome</p>
              <div className="flex flex-wrap gap-1 rounded-lg bg-muted/80 p-0.5 text-xs">
                {([['', 'In progress'], ['converted', 'Converted to customer'], ['closed', 'Query closed']] as const).map(([value, label]) => (
                  <button key={value || 'open'} type="button" disabled={busy} aria-pressed={r.outcome === value} data-testid={`outcome-${value || 'open'}-${r.id}`}
                    onClick={() => { if (r.outcome !== value) void run(() => onPatch({ outcome: value })); }}
                    className={`flex-1 rounded-md px-2.5 py-1.5 font-semibold ${r.outcome === value ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <label className="block">
              <span className="mb-1 flex items-center gap-1 text-xs font-semibold text-muted-foreground"><ClipboardList className="h-3.5 w-3.5" /> Action plan</span>
              <textarea className={inputCls} rows={4} value={plan} maxLength={4000} onChange={(e) => setPlan(e.target.value)} data-testid={`input-plan-${r.id}`}
                placeholder={'e.g. Call on Monday 11 AM\nShare pricing for 10 PCs\nSet up a trial account'} />
            </label>
            <div className="flex justify-end">
              <button type="button" disabled={busy || plan === r.actionPlan} onClick={() => void run(() => onPatch({ actionPlan: plan }))} data-testid={`button-save-plan-${r.id}`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-xs font-bold text-background disabled:opacity-40"><Save className="h-3.5 w-3.5" /> Save plan</button>
            </div>
          </div>
          <div>
            <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-muted-foreground"><MessageSquare className="h-3.5 w-3.5" /> Comments</p>
            {r.comments.length === 0 ? <p className="rounded-lg bg-muted/50 px-3 py-3 text-center text-xs text-muted-foreground">No comments yet. Log calls, WhatsApp chats and decisions here.</p> : (
              <ul className="max-h-56 space-y-2 overflow-y-auto pr-1">
                {r.comments.map((c) => (
                  <li key={c.id} className="group rounded-lg bg-muted/60 px-3 py-2 text-sm">
                    <p className="whitespace-pre-line">{c.text}</p>
                    <p className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                      <span>{c.by || 'Note'} · {relativeTime(c.at, Date.now())}</span>
                      <button type="button" onClick={() => void run(() => onRemoveComment(c.id))} aria-label="Remove comment"
                        className="opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus:opacity-100"><Trash2 className="h-3 w-3" /></button>
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); const t = comment.trim(); if (t) void run(async () => { const ok = await onComment(t); if (ok) setComment(''); return ok; }); }}>
              <input className={inputCls} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} placeholder="Add a comment…" data-testid={`input-comment-${r.id}`} />
              <button type="submit" disabled={busy || !comment.trim()} data-testid={`button-comment-${r.id}`}
                className="shrink-0 rounded-xl bg-primary px-3 text-sm font-bold text-primary-foreground disabled:opacity-40"><Send className="h-4 w-4" /></button>
            </form>
          </div>
        </div>
      )}
    </li>
  );
}

// --- Site settings ---

function Toggle({ checked, onChange, label, hint, testId }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; testId?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 py-2">
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} data-testid={testId}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-foreground/20'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
      <span className="text-sm"><span className="font-semibold">{label}</span>{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</span>
    </label>
  );
}

const inputCls = 'w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40';

function ImageSlot({ kind, label, hint, asset, accept, onChange }: {
  kind: 'logo' | 'favicon' | 'og'; label: string; hint: string; asset: AssetInfo; accept: string;
  onChange: (kind: 'logo' | 'favicon' | 'og', file: File | null) => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const run = async (file: File | null) => { setBusy(true); try { await onChange(kind, file); } finally { setBusy(false); } };
  return (
    <div className="flex items-center gap-3 rounded-xl border p-3">
      <div className={`grid shrink-0 place-items-center overflow-hidden rounded-lg bg-muted ${kind === 'og' ? 'h-16 w-28' : 'h-14 w-14'}`}>
        {asset ? <img src={asset.url} alt="" className="h-full w-full object-contain" /> : <ImageIcon className="h-5 w-5 text-muted-foreground" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-xs text-muted-foreground">{asset ? `${asset.type.replace('image/', '').toUpperCase()} · ${Math.ceil(asset.bytes / 1024)} KB` : hint}</p>
      </div>
      <input ref={input} type="file" accept={accept} className="hidden" data-testid={`file-${kind}`}
        onChange={(e) => { const f = e.target.files?.[0] ?? null; e.target.value = ''; if (f) void run(f); }} />
      <button type="button" disabled={busy} onClick={() => input.current?.click()} data-testid={`button-upload-${kind}`}
        className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold hover:bg-muted disabled:opacity-50">
        <Upload className="h-3.5 w-3.5" /> {busy ? 'Saving…' : asset ? 'Replace' : 'Upload'}
      </button>
      {asset && (
        <button type="button" disabled={busy} onClick={() => void run(null)} aria-label={`Remove ${label}`} title="Use the default"
          className="rounded-lg border px-2 py-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
      )}
    </div>
  );
}

function readDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function SiteSettingsPanel({ onError }: { onError: (m: string | null) => void }) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: ['admin-site'], queryFn: () => api<SiteSettings>('/site') });
  const [draft, setDraft] = useState<SiteSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (q.data && !draft) setDraft(q.data); }, [q.data, draft]);

  const apply = (next: SiteSettings) => {
    client.setQueryData(['admin-site'], next);
    client.setQueryData(SITE_KEY, next);
  };
  if (!draft) return <Empty text={q.isError ? 'Could not load the site settings.' : 'Loading…'} />;
  const dirty = JSON.stringify({ ...draft, logo: 0, favicon: 0, ogImage: 0 }) !== JSON.stringify({ ...q.data, logo: 0, favicon: 0, ogImage: 0 });
  const set = (fn: (d: SiteSettings) => SiteSettings) => { setSaved(false); setDraft((d) => (d ? fn(structuredClone(d)) : d)); };

  async function save() {
    if (!draft) return;
    setBusy(true);
    onError(null);
    try {
      const next = await api<SiteSettings>('/site', { method: 'PATCH', body: JSON.stringify({ tabs: draft.tabs, signIn: draft.signIn, og: draft.og, pages: draft.pages }) });
      apply(next);
      setDraft(next);
      setSaved(true);
    } catch (e) { onError(errorText(e, 'Could not save the site settings.')); } finally { setBusy(false); }
  }

  async function changeImage(kind: 'logo' | 'favicon' | 'og', file: File | null) {
    onError(null);
    try {
      const next = file
        ? await api<SiteSettings>(`/site/asset/${kind}`, { method: 'PUT', body: JSON.stringify({ dataUrl: await readDataUrl(file) }) })
        : await api<SiteSettings>(`/site/asset/${kind}`, { method: 'DELETE' });
      apply(next);
      setDraft((d) => (d ? { ...d, logo: next.logo, favicon: next.favicon, ogImage: next.ogImage } : d));
    } catch (e) { onError(errorText(e, 'Could not save the image.')); }
  }

  const onlyOne = [draft.tabs.pcs, draft.tabs.connect, draft.tabs.download].filter(Boolean).length === 1;
  return (
    <div className="space-y-4" data-testid="site-settings">
      <div className="sticky top-16 z-20 flex items-center justify-between gap-3 rounded-2xl border bg-card/95 px-4 py-3 shadow-sm backdrop-blur">
        <p className="text-sm text-muted-foreground">{dirty ? 'You have unsaved changes.' : saved ? 'Saved. Visitors see the changes on their next page load.' : 'Images save as soon as you upload them.'}</p>
        <div className="flex gap-2">
          {dirty && <button type="button" onClick={() => setDraft(q.data ?? null)} className="rounded-xl border px-3 py-1.5 text-sm font-semibold hover:bg-muted">Discard</button>}
          <button type="button" disabled={!dirty || busy} onClick={() => void save()} data-testid="button-save-site"
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-1.5 text-sm font-bold text-primary-foreground disabled:opacity-40">
            <Save className="h-4 w-4" /> {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Portal sections" icon={Settings2}>
          <p className="-mt-1 text-xs text-muted-foreground">Which tabs signed-in companies see. At least one stays on.</p>
          <Toggle label="Requests & PCs" hint="Initiate requests, PCs pointed to the company's RA ID, saved PCs." checked={draft.tabs.pcs}
            onChange={(v) => { if (v || !onlyOne) set((d) => { d.tabs.pcs = v; return d; }); }} testId="toggle-tab-pcs" />
          <Toggle label="Connect with a code" hint="Joining a PC with its one-time 12-character code." checked={draft.tabs.connect}
            onChange={(v) => { if (v || !onlyOne) set((d) => { d.tabs.connect = v; return d; }); }} testId="toggle-tab-connect" />
          <Toggle label="Get the app" hint="Installer download and setup steps." checked={draft.tabs.download}
            onChange={(v) => { if (v || !onlyOne) set((d) => { d.tabs.download = v; return d; }); }} testId="toggle-tab-download" />
          <p className="mt-3 border-t pt-3 text-xs font-semibold text-muted-foreground">Sign-in page</p>
          <Toggle label="Request access form" hint="Lets visitors send their email, mobile and a message to buy the system." checked={draft.signIn.requestAccess}
            onChange={(v) => set((d) => { d.signIn.requestAccess = v; return d; })} testId="toggle-request-access" />
          <Toggle label="Download link" hint="The Windows app download link under the sign-in form." checked={draft.signIn.downloadLink}
            onChange={(v) => set((d) => { d.signIn.downloadLink = v; return d; })} testId="toggle-download-link" />
        </Card>

        <Card title="Logo and favicon" icon={ImageIcon}>
          <div className="space-y-3">
            <ImageSlot kind="logo" label="Website logo" hint="Square works best. PNG, SVG, WebP or JPEG, up to 512 KB." asset={draft.logo}
              accept="image/png,image/svg+xml,image/webp,image/jpeg,image/gif" onChange={changeImage} />
            <ImageSlot kind="favicon" label="Favicon" hint="The browser tab icon. ICO, PNG or SVG, up to 256 KB." asset={draft.favicon}
              accept="image/x-icon,image/vnd.microsoft.icon,image/png,image/svg+xml" onChange={changeImage} />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Remove an image to go back to the built-in WINRSS.net mark.</p>
        </Card>
      </div>

      <Card title="Social sharing (OG tags)" icon={Upload}>
        <p className="-mt-1 mb-3 text-xs text-muted-foreground">What WhatsApp, LinkedIn, Facebook, X and Slack show when someone shares a link to this site.</p>
        <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
          <div className="space-y-3">
            <label className="block text-sm"><span className="mb-1 block text-xs font-semibold text-muted-foreground">Title</span>
              <input className={inputCls} value={draft.og.title} maxLength={120} data-testid="input-og-title"
                onChange={(e) => set((d) => { d.og.title = e.target.value; return d; })} /></label>
            <label className="block text-sm"><span className="mb-1 block text-xs font-semibold text-muted-foreground">Description</span>
              <textarea className={inputCls} rows={3} value={draft.og.description} maxLength={300} data-testid="input-og-description"
                onChange={(e) => set((d) => { d.og.description = e.target.value; return d; })} /></label>
            <ImageSlot kind="og" label="Share image" hint="1200 × 630 PNG, JPEG or WebP, up to 1.5 MB." asset={draft.ogImage}
              accept="image/png,image/jpeg,image/webp" onChange={changeImage} />
          </div>
          <div className="overflow-hidden rounded-xl border bg-background" aria-label="Share preview">
            <div className="grid aspect-[1200/630] place-items-center bg-muted">
              {draft.ogImage ? <img src={draft.ogImage.url} alt="" className="h-full w-full object-cover" /> : <ImageIcon className="h-6 w-6 text-muted-foreground" />}
            </div>
            <div className="p-3">
              <p className="font-mono text-[10px] uppercase text-muted-foreground">{typeof window !== 'undefined' ? window.location.host : ''}</p>
              <p className="truncate text-sm font-semibold">{draft.og.title || 'WINRSS.net'}</p>
              <p className="line-clamp-2 text-xs text-muted-foreground">{draft.og.description}</p>
            </div>
          </div>
        </div>
      </Card>

      {(['disclaimer', 'privacy'] as const).map((key) => (
        <Card key={key} title={key === 'privacy' ? 'Privacy policy page' : 'Disclaimer page'} icon={Settings2}
          action={<a href={`/${key}`} target="_blank" rel="noreferrer" className="text-xs font-semibold text-primary">Open /{key}</a>}>
          <Toggle label={`Show a link to this page`} hint="In the footer of the portal and the sign-in page." checked={draft.pages[key].enabled}
            onChange={(v) => set((d) => { d.pages[key].enabled = v; return d; })} testId={`toggle-page-${key}`} />
          <div className="mt-2 space-y-3">
            <label className="block text-sm"><span className="mb-1 block text-xs font-semibold text-muted-foreground">Page title</span>
              <input className={inputCls} value={draft.pages[key].title} maxLength={80}
                onChange={(e) => set((d) => { d.pages[key].title = e.target.value; return d; })} /></label>
            <label className="block text-sm"><span className="mb-1 block text-xs font-semibold text-muted-foreground">Content</span>
              <textarea className={`${inputCls} font-mono text-[13px]`} rows={10} value={draft.pages[key].body} data-testid={`input-page-${key}`}
                placeholder={key === 'privacy' ? 'Leave empty to show the built-in privacy notice.' : '## Heading\n\nA paragraph of text.\n\n- A bullet point\n- Another one'}
                onChange={(e) => set((d) => { d.pages[key].body = e.target.value; return d; })} /></label>
            <p className="text-xs text-muted-foreground">Plain text. A blank line starts a new paragraph, <code>## </code> starts a heading and <code>- </code> a bullet point.</p>
          </div>
        </Card>
      ))}
    </div>
  );
}
