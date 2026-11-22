import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, BadgeCheck, CalendarClock, Check, Copy, CreditCard, Download, IndianRupee,
  MonitorPlay, MoreHorizontal, Package, Plus, RefreshCw, ShieldAlert,
} from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu as Menu, DropdownMenuContent as MenuContent, DropdownMenuItem as MenuItem,
  DropdownMenuSeparator as MenuSep, DropdownMenuTrigger as MenuTrigger,
} from '@/components/ui/dropdown-menu';
import { errorText, raLabel } from '@/lib/auth';
import { relativeTime } from '@/lib/unattended';

// --- Types mirroring the /api/billing responses ---
export type Interval = 'monthly' | 'quarterly' | 'annual';
export type SubStatus = 'active' | 'suspended' | 'expired' | 'trial' | 'none';

export type Plan = {
  id: string; name: string; description: string; priceInr: number; interval: Interval;
  sessionQuota: number; maxConcurrentViewers: number; maxSessionMinutes: number; archived: boolean;
};
export type Subscription = {
  accountId: string; planId: string | null; status: Exclude<SubStatus, 'none'>;
  currentPeriodStart: number; currentPeriodEnd: number; sessionsUsed: number;
  licenseVersion: number; autoRenew: boolean; requireLicense: boolean; notes: string;
};
export type Entitlement = {
  subscribed: boolean; status: SubStatus; reason?: string; plan?: Plan;
  sessionsUsed: number; sessionQuota: number; remaining: number | null; currentPeriodEnd: number | null;
  licenseVersion: number;
};
export type Company = {
  id: string; displayName: string; username: string; raId: string; disabled: boolean;
  subscription: Subscription | null; entitlement: Entitlement;
  nextDue: { id: string; amountInr: number; dueDate: number; status: PaymentStatus } | null;
};
export type PaymentStatus = 'paid' | 'due' | 'overdue';
export type Payment = {
  id: string; accountId: string; amountInr: number; interval: Interval | null;
  periodStart: number | null; periodEnd: number | null; dueDate: number; status: PaymentStatus;
  paidAt: number | null; method: string; reference: string; note: string; createdAt: number;
};
export type Summary = {
  companies: number; plans: number; activeSubscriptions: number; expiredSubscriptions: number;
  suspendedSubscriptions: number; mrrInr: number; overdueCount: number; overdueAmountInr: number;
  upcomingCount: number; sessionsThisMonth: number;
};

// --- API helper (cookie session, same origin) ---
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/billing${path}`, {
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
const dateFmt = (ms: number | null | undefined) =>
  ms ? new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const INTERVAL_LABEL: Record<Interval, string> = { monthly: 'Monthly', quarterly: 'Quarterly', annual: 'Annual' };

const inputCls = 'w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40';

const STATUS_STYLE: Record<SubStatus, string> = {
  active: 'bg-emerald-500/12 text-emerald-700',
  trial: 'bg-primary/12 text-primary',
  expired: 'bg-amber-500/15 text-amber-700',
  suspended: 'bg-destructive/12 text-destructive',
  none: 'bg-muted text-muted-foreground',
};
const STATUS_LABEL: Record<SubStatus, string> = {
  active: 'Active', trial: 'Trial', expired: 'Expired', suspended: 'Suspended', none: 'No subscription',
};

function StatusBadge({ status }: { status: SubStatus }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status]}</span>;
}

function Card({ title, icon: Icon, action, children }: { title: string; icon: typeof Package; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-2xl border bg-card/90 p-4 shadow-[0_10px_30px_-24px_hsl(200_32%_13%/0.5)] md:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-bold"><Icon className="h-5 w-5 text-primary" /> {title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}
const Empty = ({ text }: { text: string }) => <p className="py-6 text-center text-sm text-muted-foreground">{text}</p>;

// =============================== Subscriptions ===============================

export function SubscriptionsPanel({ onError }: { onError: (msg: string | null) => void }) {
  const qc = useQueryClient();
  const summary = useQuery({ queryKey: ['billing', 'summary'], queryFn: () => api<Summary>('/summary'), refetchInterval: 20_000 });
  const plans = useQuery({ queryKey: ['billing', 'plans'], queryFn: () => api<{ plans: Plan[] }>('/plans') });
  const companies = useQuery({ queryKey: ['billing', 'companies'], queryFn: () => api<{ companies: Company[] }>('/companies'), refetchInterval: 20_000 });

  const [planEdit, setPlanEdit] = useState<Plan | null | 'new'>(null);
  const [subEdit, setSubEdit] = useState<Company | null>(null);
  const [clientFor, setClientFor] = useState<Company | null>(null);

  const reload = () => {
    void qc.invalidateQueries({ queryKey: ['billing'] });
  };
  async function run(action: () => Promise<unknown>, fallback: string) {
    onError(null);
    try { await action(); reload(); return true; } catch (e) { onError(errorText(e, fallback)); return false; }
  }

  const planList = plans.data?.plans ?? [];
  const activePlans = planList.filter((p) => !p.archived);
  const s = summary.data;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric icon={BadgeCheck} label="Active subscriptions" value={s ? String(s.activeSubscriptions) : '—'} detail={s ? `${s.expiredSubscriptions} expired · ${s.suspendedSubscriptions} suspended` : ''} accent />
        <Metric icon={IndianRupee} label="Monthly revenue" value={s ? inr(s.mrrInr) : '—'} detail="Across active plans" />
        <Metric icon={AlertTriangle} label="Overdue" value={s ? inr(s.overdueAmountInr) : '—'} detail={s ? `${s.overdueCount} payment(s)` : ''} accent={!!s && s.overdueCount > 0} />
        <Metric icon={MonitorPlay} label="Sessions (30 days)" value={s ? String(s.sessionsThisMonth) : '—'} detail="Counted against quotas" />
      </div>

      <Card title="Plans" icon={Package} action={
        <button type="button" onClick={() => setPlanEdit('new')} data-testid="button-add-plan"
          className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-sm font-bold text-primary-foreground active:scale-[0.98]">
          <Plus className="h-4 w-4" /> New plan
        </button>}>
        {planList.length === 0 ? <Empty text="No plans yet. Create a plan (INR, monthly / quarterly / annual) to assign to companies." /> : (
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead><tr className="text-xs text-muted-foreground">
                <th className="px-1 py-2 font-semibold">Plan</th><th className="px-1 py-2 font-semibold">Price</th>
                <th className="px-1 py-2 font-semibold">Billing</th><th className="px-1 py-2 font-semibold">Session quota</th>
                <th className="px-1 py-2 font-semibold">Limits</th><th className="px-1 py-2" />
              </tr></thead>
              <tbody className="divide-y divide-foreground/8">
                {planList.map((p) => (
                  <tr key={p.id} data-testid={`plan-${p.id}`} className={p.archived ? 'opacity-50' : ''}>
                    <td className="px-1 py-2.5"><p className="font-semibold">{p.name}{p.archived && <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">(archived)</span>}</p>
                      {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}</td>
                    <td className="px-1 py-2.5 font-semibold">{inr(p.priceInr)}</td>
                    <td className="px-1 py-2.5">{INTERVAL_LABEL[p.interval]}</td>
                    <td className="px-1 py-2.5">{p.sessionQuota ? `${p.sessionQuota} / period` : 'Unlimited'}</td>
                    <td className="px-1 py-2.5 text-xs text-muted-foreground">
                      {p.maxConcurrentViewers ? `${p.maxConcurrentViewers} viewers` : 'Default viewers'}{p.maxSessionMinutes ? ` · ${p.maxSessionMinutes} min` : ''}
                    </td>
                    <td className="px-1 py-2.5 text-right">
                      <Menu>
                        <MenuTrigger aria-label={`Actions for ${p.name}`} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><MoreHorizontal className="h-4 w-4" /></MenuTrigger>
                        <MenuContent align="end">
                          <MenuItem onSelect={() => setPlanEdit(p)}>Edit</MenuItem>
                          {p.archived
                            ? <MenuItem onSelect={() => void run(() => api(`/plans/${p.id}`, { method: 'PATCH', body: JSON.stringify({ archived: false }) }), 'Could not restore the plan.')}>Restore</MenuItem>
                            : <MenuItem onSelect={() => void run(() => api(`/plans/${p.id}`, { method: 'DELETE' }), 'Could not remove the plan.')} className="text-destructive focus:text-destructive">Archive / delete</MenuItem>}
                        </MenuContent>
                      </Menu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Company subscriptions" icon={CreditCard} action={<button type="button" onClick={reload} className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"><RefreshCw className="h-3.5 w-3.5" /> Refresh</button>}>
        {(companies.data?.companies.length ?? 0) === 0 ? <Empty text="No company accounts yet. Add a company on the Companies tab, then configure its subscription here." /> : (
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead><tr className="text-xs text-muted-foreground">
                <th className="px-1 py-2 font-semibold">Company</th><th className="px-1 py-2 font-semibold">Status</th>
                <th className="px-1 py-2 font-semibold">Plan</th><th className="px-1 py-2 font-semibold">Usage</th>
                <th className="px-1 py-2 font-semibold">Renews / ends</th><th className="px-1 py-2 font-semibold">Next due</th><th className="px-1 py-2" />
              </tr></thead>
              <tbody className="divide-y divide-foreground/8">
                {companies.data!.companies.map((c) => {
                  const ent = c.entitlement;
                  const plan = ent.plan ?? planList.find((p) => p.id === c.subscription?.planId);
                  return (
                    <tr key={c.id} data-testid={`sub-${c.username}`}>
                      <td className="px-1 py-2.5"><p className="font-semibold">{c.displayName}</p><p className="font-mono text-xs text-muted-foreground">{raLabel(c.raId)}</p></td>
                      <td className="px-1 py-2.5"><StatusBadge status={ent.status} />{ent.reason === 'quota' && <span className="mt-0.5 block text-[11px] text-amber-700">Quota reached</span>}</td>
                      <td className="px-1 py-2.5">{plan ? plan.name : <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-1 py-2.5 text-xs">{ent.sessionQuota ? `${ent.sessionsUsed} / ${ent.sessionQuota}` : ent.subscribed ? `${ent.sessionsUsed} · unlimited` : '—'}</td>
                      <td className="px-1 py-2.5 text-xs text-muted-foreground">{dateFmt(ent.currentPeriodEnd)}</td>
                      <td className="px-1 py-2.5 text-xs">{c.nextDue ? <span className={c.nextDue.status === 'overdue' ? 'font-semibold text-destructive' : 'text-muted-foreground'}>{inr(c.nextDue.amountInr)} · {dateFmt(c.nextDue.dueDate)}</span> : <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-1 py-2.5 text-right">
                        <Menu>
                          <MenuTrigger aria-label={`Actions for ${c.displayName}`} data-testid={`button-sub-actions-${c.username}`} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><MoreHorizontal className="h-4 w-4" /></MenuTrigger>
                          <MenuContent align="end">
                            <MenuItem onSelect={() => setSubEdit(c)} data-testid={`button-configure-sub-${c.username}`}>Configure subscription</MenuItem>
                            <MenuItem onSelect={() => setClientFor(c)} data-testid={`button-configure-client-${c.username}`}>Configure client…</MenuItem>
                            {c.subscription && <MenuItem onSelect={() => void run(() => api(`/subscriptions/${c.id}/renew`, { method: 'POST', body: JSON.stringify({ markPaid: false }) }), 'Could not renew.')}>Renew one period (create due)</MenuItem>}
                            {c.subscription && <>
                              <MenuSep />
                              <MenuItem onSelect={() => { if (window.confirm(`Revoke every existing license for ${c.displayName}? Its configured clients stop working until they are reconfigured with a new license.`)) void run(() => api(`/subscriptions/${c.id}/revoke-license`, { method: 'POST', body: '{}' }), 'Could not revoke licenses.'); }} className="text-destructive focus:text-destructive">Revoke licenses</MenuItem>
                            </>}
                          </MenuContent>
                        </Menu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">A company with no subscription is not restricted. Once you assign a plan, its PCs only work while the subscription is active and within quota — the relay enforces this at registration.</p>
      </Card>

      <PlanDialog edit={planEdit} onClose={() => setPlanEdit(null)} onSaved={reload} onError={onError} />
      <SubscriptionDialog company={subEdit} plans={activePlans} onClose={() => setSubEdit(null)} onSaved={reload} onError={onError} />
      <ClientConfigDialog company={clientFor} onClose={() => setClientFor(null)} />
    </div>
  );
}

function Metric({ icon: Icon, label, value, detail, accent }: { icon: typeof Package; label: string; value: string; detail: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl border bg-card/90 p-4 ${accent ? 'border-primary/40' : ''}`}>
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground"><Icon className={`h-4 w-4 ${accent ? 'text-primary' : ''}`} /> {label}</div>
      <p className="mt-1 text-2xl font-extrabold tracking-tight">{value}</p>
      <p className="truncate text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

// --- Plan create/edit dialog ---
function PlanDialog({ edit, onClose, onSaved, onError }: { edit: Plan | null | 'new'; onClose: () => void; onSaved: () => void; onError: (m: string | null) => void }) {
  const open = edit !== null;
  const existing = edit && edit !== 'new' ? edit : null;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [priceInr, setPriceInr] = useState('');
  const [interval, setInterval] = useState<Interval>('monthly');
  const [sessionQuota, setSessionQuota] = useState('');
  const [maxViewers, setMaxViewers] = useState('');
  const [maxMinutes, setMaxMinutes] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(existing?.name ?? '');
    setDescription(existing?.description ?? '');
    setPriceInr(existing ? String(existing.priceInr) : '');
    setInterval(existing?.interval ?? 'monthly');
    setSessionQuota(existing?.sessionQuota ? String(existing.sessionQuota) : '');
    setMaxViewers(existing?.maxConcurrentViewers ? String(existing.maxConcurrentViewers) : '');
    setMaxMinutes(existing?.maxSessionMinutes ? String(existing.maxSessionMinutes) : '');
  }, [open, existing]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); onError(null);
    const body = {
      name: name.trim(), description: description.trim(), priceInr: Number(priceInr) || 0, interval,
      sessionQuota: Number(sessionQuota) || 0, maxConcurrentViewers: Number(maxViewers) || 0, maxSessionMinutes: Number(maxMinutes) || 0,
    };
    try {
      if (existing) await api(`/plans/${existing.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      else await api('/plans', { method: 'POST', body: JSON.stringify(body) });
      onSaved(); onClose();
    } catch (err) { onError(errorText(err, 'Could not save the plan.')); }
    finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{existing ? 'Edit plan' : 'New plan'}</DialogTitle>
          <DialogDescription>Plans are priced in Indian rupees and billed monthly, quarterly or annually.</DialogDescription></DialogHeader>
        <form id="plan-form" onSubmit={submit} className="space-y-3">
          <label className="block text-xs font-semibold text-muted-foreground">Name
            <input className={`${inputCls} mt-1`} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required autoFocus data-testid="input-plan-name" placeholder="e.g. Business" /></label>
          <label className="block text-xs font-semibold text-muted-foreground">Description <span className="font-normal">(optional)</span>
            <input className={`${inputCls} mt-1`} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={240} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-semibold text-muted-foreground">Price (INR)
              <input type="number" min={0} className={`${inputCls} mt-1`} value={priceInr} onChange={(e) => setPriceInr(e.target.value)} required data-testid="input-plan-price" placeholder="999" /></label>
            <label className="block text-xs font-semibold text-muted-foreground">Billing interval
              <select className={`${inputCls} mt-1`} value={interval} onChange={(e) => setInterval(e.target.value as Interval)} data-testid="select-plan-interval">
                <option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annual">Annual</option>
              </select></label>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label className="block text-xs font-semibold text-muted-foreground">Session quota
              <input type="number" min={0} className={`${inputCls} mt-1`} value={sessionQuota} onChange={(e) => setSessionQuota(e.target.value)} placeholder="0 = ∞" /></label>
            <label className="block text-xs font-semibold text-muted-foreground">Max viewers
              <input type="number" min={0} className={`${inputCls} mt-1`} value={maxViewers} onChange={(e) => setMaxViewers(e.target.value)} placeholder="0" /></label>
            <label className="block text-xs font-semibold text-muted-foreground">Max minutes
              <input type="number" min={0} className={`${inputCls} mt-1`} value={maxMinutes} onChange={(e) => setMaxMinutes(e.target.value)} placeholder="0" /></label>
          </div>
          <p className="text-[11px] text-muted-foreground">Session quota 0 means unlimited. A quota counts each session that goes live during the billing period.</p>
        </form>
        <DialogFooter>
          <button type="button" onClick={onClose} className="rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-muted">Cancel</button>
          <button type="submit" form="plan-form" disabled={busy || !name.trim()} data-testid="button-save-plan" className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-40">{busy ? 'Saving…' : 'Save plan'}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Subscription configure dialog ---
function SubscriptionDialog({ company, plans, onClose, onSaved, onError }: { company: Company | null; plans: Plan[]; onClose: () => void; onSaved: () => void; onError: (m: string | null) => void }) {
  const open = !!company;
  const [planId, setPlanId] = useState<string>('');
  const [status, setStatus] = useState<Exclude<SubStatus, 'none'>>('active');
  const [autoRenew, setAutoRenew] = useState(true);
  const [requireLicense, setRequireLicense] = useState(false);
  const [periodEnd, setPeriodEnd] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!company) return;
    const sub = company.subscription;
    setPlanId(sub?.planId ?? (plans[0]?.id ?? ''));
    setStatus(sub?.status ?? 'active');
    setAutoRenew(sub?.autoRenew ?? true);
    setRequireLicense(sub?.requireLicense ?? false);
    setPeriodEnd(sub?.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toISOString().slice(0, 10) : '');
    setNotes(sub?.notes ?? '');
  }, [company, plans]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!company) return;
    setBusy(true); onError(null);
    const body: Record<string, unknown> = { planId: planId || null, status, autoRenew, requireLicense, notes: notes.trim() };
    if (periodEnd) body.currentPeriodEnd = new Date(periodEnd + 'T00:00:00').getTime();
    try { await api(`/subscriptions/${company.id}`, { method: 'PUT', body: JSON.stringify(body) }); onSaved(); onClose(); }
    catch (err) { onError(errorText(err, 'Could not save the subscription.')); }
    finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Subscription — {company?.displayName}</DialogTitle>
          <DialogDescription>{company && raLabel(company.raId)}. While this is not active, or over quota, the company's PCs cannot start sessions.</DialogDescription></DialogHeader>
        <form id="sub-form" onSubmit={submit} className="space-y-3">
          <label className="block text-xs font-semibold text-muted-foreground">Plan
            <select className={`${inputCls} mt-1`} value={planId} onChange={(e) => setPlanId(e.target.value)} data-testid="select-sub-plan">
              <option value="">No plan (unlimited, not metered)</option>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name} — {inr(p.priceInr)} / {INTERVAL_LABEL[p.interval].toLowerCase()}{p.sessionQuota ? ` · ${p.sessionQuota} sessions` : ''}</option>)}
            </select></label>
          <fieldset><legend className="text-xs font-semibold text-muted-foreground">Status</legend>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {([['active', 'Active'], ['suspended', 'Suspended'], ['expired', 'Expired'], ['trial', 'Trial']] as const).map(([v, label]) => (
                <button key={v} type="button" onClick={() => setStatus(v)} aria-pressed={status === v} data-testid={`status-${v}`}
                  className={`rounded-xl border px-3 py-2 text-left text-sm font-semibold ${status === v ? 'border-primary bg-primary/8 ring-2 ring-primary/20' : 'hover:bg-muted'}`}>{label}</button>
              ))}
            </div></fieldset>
          <label className="block text-xs font-semibold text-muted-foreground">Period ends <span className="font-normal">(leave empty to set from the plan interval)</span>
            <input type="date" className={`${inputCls} mt-1`} value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} data-testid="input-period-end" /></label>
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={autoRenew} onChange={(e) => setAutoRenew(e.target.checked)} className="h-4 w-4" /> Auto-renew the period when it lapses
          </label>
          <label className="flex items-start gap-2 text-sm font-semibold" data-testid="toggle-require-license">
            <input type="checkbox" checked={requireLicense} onChange={(e) => setRequireLicense(e.target.checked)} className="mt-0.5 h-4 w-4" />
            <span>Require a licensed client<span className="block text-xs font-normal text-muted-foreground">PCs must present a valid license to register — blocks copied clients and enforces revocation. Configure each PC's client first.</span></span>
          </label>
          <label className="block text-xs font-semibold text-muted-foreground">Notes <span className="font-normal">(optional)</span>
            <textarea className={`${inputCls} mt-1`} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} rows={2} /></label>
        </form>
        <DialogFooter>
          <button type="button" onClick={onClose} className="rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-muted">Cancel</button>
          <button type="submit" form="sub-form" disabled={busy} data-testid="button-save-sub" className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-40">{busy ? 'Saving…' : 'Save subscription'}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Configure client dialog (license + config download) ---
type ClientBundle = {
  config: { version: number; company: string; relay: string; raId: string; license: string; issuedAt: number };
  configFileName: string; buildCommand: string;
  subscription: { status: SubStatus; plan: { name: string; interval: Interval; priceInr: number } | null; sessionQuota: number; sessionsUsed: number; remaining: number | null; currentPeriodEnd: number | null };
};

function ClientConfigDialog({ company, onClose }: { company: Company | null; onClose: () => void }) {
  const open = !!company;
  const [bundle, setBundle] = useState<ClientBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!company) { setBundle(null); setError(null); return; }
    setLoading(true); setError(null);
    const origin = encodeURIComponent(window.location.origin);
    api<ClientBundle>(`/companies/${company.id}/client?origin=${origin}`)
      .then(setBundle).catch((e) => setError(errorText(e, 'Could not generate the client configuration.')))
      .finally(() => setLoading(false));
  }, [company]);

  function download() {
    if (!bundle) return;
    const blob = new Blob([JSON.stringify(bundle.config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = bundle.configFileName; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Configure client — {company?.displayName}</DialogTitle>
          <DialogDescription>A per-company client is pre-configured with the relay URL, RA ID and a signed license. Drop the config file next to the installer, or bake it in with the build command.</DialogDescription></DialogHeader>
        {loading ? <Empty text="Generating license…" /> : error ? <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : bundle ? (
          <div className="space-y-3">
            <div className="rounded-2xl border bg-muted/40 p-3 text-sm">
              <Row label="Relay URL" value={bundle.config.relay} />
              <Row label="RA ID" value={raLabel(bundle.config.raId)} />
              <Row label="Subscription" value={`${STATUS_LABEL[bundle.subscription.status]}${bundle.subscription.plan ? ` · ${bundle.subscription.plan.name}` : ''}`} />
              {bundle.subscription.sessionQuota > 0 && <Row label="Sessions" value={`${bundle.subscription.sessionsUsed} / ${bundle.subscription.sessionQuota} this period`} />}
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold text-muted-foreground">Config file ({bundle.configFileName})</p>
              <pre className="max-h-40 overflow-auto rounded-xl border bg-background p-3 font-mono text-[11px] leading-relaxed" data-testid="client-config-json">{JSON.stringify(bundle.config, null, 2)}</pre>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={download} data-testid="button-download-config" className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-bold text-primary-foreground"><Download className="h-4 w-4" /> Download config</button>
              <CopyChip text={bundle.config.license} label="Copy license" />
              <CopyChip text={bundle.buildCommand} label="Copy build command" />
            </div>
            <details className="rounded-xl border bg-background p-3 text-xs">
              <summary className="cursor-pointer font-semibold">Build a per-company installer</summary>
              <p className="mt-2 text-muted-foreground">Run this where the Windows client is built; it bakes the relay URL, RA ID and license into the installer so the PC needs no manual setup:</p>
              <pre className="mt-2 overflow-auto rounded-lg bg-muted/50 p-2 font-mono text-[11px]">{bundle.buildCommand}</pre>
            </details>
            <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground"><ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> The license is signed by the relay and bound to this company and RA ID. Revoking licenses (on the subscription menu) invalidates it immediately.</p>
          </div>
        ) : null}
        <DialogFooter>
          <button type="button" onClick={onClose} className="rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-muted">Close</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-3 py-1"><span className="text-xs text-muted-foreground">{label}</span><span className="truncate font-mono text-xs font-semibold">{value}</span></div>;
}
function CopyChip({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" onClick={() => { void navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); }}
      className="flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-muted">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {label}</button>
  );
}

// ================================= Payments ==================================

export function PaymentsPanel({ onError }: { onError: (msg: string | null) => void }) {
  const qc = useQueryClient();
  const now = Date.now();
  const dues = useQuery({ queryKey: ['billing', 'dues'], queryFn: () => api<{ overdue: Payment[]; upcoming: Payment[] }>('/dues'), refetchInterval: 20_000 });
  const payments = useQuery({ queryKey: ['billing', 'payments'], queryFn: () => api<{ payments: Payment[] }>('/payments') });
  const companies = useQuery({ queryKey: ['billing', 'companies'], queryFn: () => api<{ companies: Company[] }>('/companies') });
  const [recording, setRecording] = useState(false);

  const byId = useMemo(() => new Map((companies.data?.companies ?? []).map((c) => [c.id, c])), [companies.data]);
  const reload = () => void qc.invalidateQueries({ queryKey: ['billing'] });
  async function run(action: () => Promise<unknown>, fallback: string) {
    onError(null);
    try { await action(); reload(); } catch (e) { onError(errorText(e, fallback)); }
  }
  const nameOf = (id: string) => byId.get(id)?.displayName ?? 'Unknown company';

  const open = [...(dues.data?.overdue ?? []), ...(dues.data?.upcoming ?? [])];
  const history = payments.data?.payments ?? [];

  return (
    <div className="space-y-4">
      <Card title="Dues" icon={CalendarClock} action={
        <button type="button" onClick={() => setRecording(true)} data-testid="button-record-payment" className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-sm font-bold text-primary-foreground"><Plus className="h-4 w-4" /> Record payment</button>}>
        {open.length === 0 ? <Empty text="Nothing due. Renewals create a due payment you can mark paid here." /> : (
          <ul className="divide-y divide-foreground/8">
            {open.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 py-2.5" data-testid={`due-${p.id}`}>
                <span className={`h-2 w-2 shrink-0 rounded-full ${p.status === 'overdue' ? 'bg-destructive' : 'bg-amber-500'}`} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{nameOf(p.accountId)} · {inr(p.amountInr)}</p>
                  <p className="text-xs text-muted-foreground">{p.status === 'overdue' ? 'Overdue' : 'Due'} {dateFmt(p.dueDate)}{p.note ? ` · ${p.note}` : ''}</p>
                </div>
                <button type="button" onClick={() => void run(() => api(`/payments/${p.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'paid' }) }), 'Could not mark it paid.')}
                  data-testid={`button-mark-paid-${p.id}`} className="rounded-xl border border-emerald-500/40 px-3 py-1.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-500/10">Mark paid</button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Payment history" icon={CreditCard} action={<button type="button" onClick={reload} className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"><RefreshCw className="h-3.5 w-3.5" /> Refresh</button>}>
        {history.length === 0 ? <Empty text="No payments recorded yet." /> : (
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead><tr className="text-xs text-muted-foreground">
                <th className="px-1 py-2 font-semibold">Company</th><th className="px-1 py-2 font-semibold">Amount</th>
                <th className="px-1 py-2 font-semibold">Status</th><th className="px-1 py-2 font-semibold">Due / paid</th>
                <th className="px-1 py-2 font-semibold">Method</th><th className="px-1 py-2" />
              </tr></thead>
              <tbody className="divide-y divide-foreground/8">
                {history.map((p) => (
                  <tr key={p.id} data-testid={`payment-${p.id}`}>
                    <td className="px-1 py-2.5 font-semibold">{nameOf(p.accountId)}{p.note && <p className="text-xs font-normal text-muted-foreground">{p.note}</p>}</td>
                    <td className="px-1 py-2.5 font-semibold">{inr(p.amountInr)}</td>
                    <td className="px-1 py-2.5"><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${p.status === 'paid' ? 'bg-emerald-500/12 text-emerald-700' : p.status === 'overdue' ? 'bg-destructive/12 text-destructive' : 'bg-amber-500/15 text-amber-700'}`}>{p.status}</span></td>
                    <td className="px-1 py-2.5 text-xs text-muted-foreground">{p.status === 'paid' ? `Paid ${dateFmt(p.paidAt)}` : `Due ${dateFmt(p.dueDate)}`}</td>
                    <td className="px-1 py-2.5 text-xs text-muted-foreground">{p.method || '—'}{p.reference ? ` · ${p.reference}` : ''}</td>
                    <td className="px-1 py-2.5 text-right">
                      <Menu>
                        <MenuTrigger aria-label="Payment actions" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><MoreHorizontal className="h-4 w-4" /></MenuTrigger>
                        <MenuContent align="end">
                          {p.status !== 'paid' && <MenuItem onSelect={() => void run(() => api(`/payments/${p.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'paid' }) }), 'Could not update.')}>Mark paid</MenuItem>}
                          {p.status === 'paid' && <MenuItem onSelect={() => void run(() => api(`/payments/${p.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'due' }) }), 'Could not update.')}>Mark unpaid</MenuItem>}
                          <MenuSep />
                          <MenuItem onSelect={() => { if (window.confirm('Delete this payment record?')) void run(() => api(`/payments/${p.id}`, { method: 'DELETE' }), 'Could not delete.'); }} className="text-destructive focus:text-destructive">Delete</MenuItem>
                        </MenuContent>
                      </Menu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <PaymentDialog open={recording} companies={companies.data?.companies ?? []} onClose={() => setRecording(false)} onSaved={reload} onError={onError} />
    </div>
  );
}

function PaymentDialog({ open, companies, onClose, onSaved, onError }: { open: boolean; companies: Company[]; onClose: () => void; onSaved: () => void; onError: (m: string | null) => void }) {
  const [accountId, setAccountId] = useState('');
  const [amountInr, setAmountInr] = useState('');
  const [status, setStatus] = useState<PaymentStatus>('paid');
  const [dueDate, setDueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setAccountId(companies[0]?.id ?? ''); setAmountInr(''); setStatus('paid'); setDueDate(new Date().toISOString().slice(0, 10)); setMethod(''); setReference(''); setNote(''); } }, [open, companies]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); onError(null);
    try {
      await api('/payments', { method: 'POST', body: JSON.stringify({
        accountId, amountInr: Number(amountInr) || 0, status,
        dueDate: new Date(dueDate + 'T00:00:00').getTime(), method: method.trim(), reference: reference.trim(), note: note.trim(),
      }) });
      onSaved(); onClose();
    } catch (err) { onError(errorText(err, 'Could not record the payment.')); }
    finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Record a payment</DialogTitle><DialogDescription>Log a payment received, or a due amount to collect.</DialogDescription></DialogHeader>
        <form id="payment-form" onSubmit={submit} className="space-y-3">
          <label className="block text-xs font-semibold text-muted-foreground">Company
            <select className={`${inputCls} mt-1`} value={accountId} onChange={(e) => setAccountId(e.target.value)} required data-testid="select-payment-company">
              {companies.map((c) => <option key={c.id} value={c.id}>{c.displayName} ({raLabel(c.raId)})</option>)}
            </select></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-semibold text-muted-foreground">Amount (INR)
              <input type="number" min={0} className={`${inputCls} mt-1`} value={amountInr} onChange={(e) => setAmountInr(e.target.value)} required data-testid="input-payment-amount" /></label>
            <label className="block text-xs font-semibold text-muted-foreground">{status === 'paid' ? 'Paid on' : 'Due date'}
              <input type="date" className={`${inputCls} mt-1`} value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label>
          </div>
          <fieldset><legend className="text-xs font-semibold text-muted-foreground">Status</legend>
            <div className="mt-1 grid grid-cols-3 gap-2">
              {([['paid', 'Paid'], ['due', 'Due'], ['overdue', 'Overdue']] as const).map(([v, label]) => (
                <button key={v} type="button" onClick={() => setStatus(v)} aria-pressed={status === v}
                  className={`rounded-xl border px-3 py-2 text-sm font-semibold ${status === v ? 'border-primary bg-primary/8 ring-2 ring-primary/20' : 'hover:bg-muted'}`}>{label}</button>
              ))}
            </div></fieldset>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-semibold text-muted-foreground">Method <span className="font-normal">(optional)</span>
              <input className={`${inputCls} mt-1`} value={method} onChange={(e) => setMethod(e.target.value)} maxLength={40} placeholder="UPI, NEFT…" /></label>
            <label className="block text-xs font-semibold text-muted-foreground">Reference <span className="font-normal">(optional)</span>
              <input className={`${inputCls} mt-1`} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} /></label>
          </div>
          <label className="block text-xs font-semibold text-muted-foreground">Note <span className="font-normal">(optional)</span>
            <input className={`${inputCls} mt-1`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={240} /></label>
        </form>
        <DialogFooter>
          <button type="button" onClick={onClose} className="rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-muted">Cancel</button>
          <button type="submit" form="payment-form" disabled={busy || !accountId || !amountInr} data-testid="button-save-payment" className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-40">{busy ? 'Saving…' : 'Record payment'}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
