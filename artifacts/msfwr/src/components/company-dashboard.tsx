import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle, BadgeCheck, BellRing, CalendarClock, CalendarDays, Clock, Gauge, IndianRupee, KeyRound, Laptop, Link2, MonitorPlay,
  RefreshCw, Sparkles, Timer, TrendingUp, Zap,
} from 'lucide-react';
import { raLabel } from '@/lib/auth';
import { relativeTime } from '@/lib/unattended';

// The company's landing page after sign-in: subscription, renewal, usage
// against the quota, what is live right now, and the last 30 days.

type Mode = 'attended' | 'unattended' | 'link';
export type CompanyDashboard = {
  now: number;
  company: { name: string; raId: string };
  subscription: null | {
    status: 'active' | 'trial' | 'expired' | 'suspended';
    plan: null | { name: string; description: string; interval: 'monthly' | 'quarterly' | 'annual'; priceInr: number; maxConcurrentViewers: number; maxSessionMinutes: number };
    startedAt: number | null; currentPeriodStart: number | null; currentPeriodEnd: number | null; autoRenew: boolean;
  };
  usage: {
    used: number; quota: number; planQuota: number; grace: number; remaining: number | null; urls: number; extraSessions: number;
    blocked: boolean; reason: string | null; message: string | null; graceLog: { amount: number; at: number }[];
  };
  live: { id: string; name: string; mode: Mode; viewers: number; liveAt?: number }[];
  pcs: { online: number; busy: number; list: { id: string; name: string; state: 'online' | 'busy' }[] };
  requests: { waiting: number; accepted: number; missed: number };
  links: { active: number; thisPeriod: number; total: number; recent: { code: string; pcName: string; status: 'active' | 'expired' | 'cleared'; online: boolean; claimedAt: number | null; expiresAt: number; sessions: number }[] };
  history: { days: { day: number; sessions: number; minutes: number }[]; sessions30: number; minutes30: number; avgMinutes: number; longestMinutes: number; byMode: Record<Mode, number>; hours: number[]; topPcs: { name: string; sessions: number; minutes: number }[] };
  payments: { open: { id: string; amountInr: number; dueDate: number; status: string; note: string }[]; openAmountInr: number; lastPaid: { amountInr: number; paidAt: number | null; note: string } | null };
};

export const COMPANY_DASHBOARD_KEY = ['company-dashboard'] as const;

async function load(): Promise<CompanyDashboard> {
  const res = await fetch('/api/company/dashboard', { credentials: 'same-origin' });
  if (!res.ok) throw Object.assign(new Error('dashboard failed'), { status: res.status, data: await res.json().catch(() => null) });
  return res.json() as Promise<CompanyDashboard>;
}

const inr = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);
const dateFmt = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const dayFmt = (ms: number) => new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const INTERVAL: Record<string, string> = { monthly: 'month', quarterly: 'quarter', annual: 'year' };
const MODE: Record<Mode, string> = { attended: 'Attended', unattended: 'Unattended', link: 'Remote URL' };
const STATUS: Record<string, [string, string]> = {
  active: ['Active', 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400'],
  trial: ['Trial', 'bg-sky-500/12 text-sky-700 dark:text-sky-400'],
  expired: ['Expired', 'bg-destructive/12 text-destructive'],
  suspended: ['Suspended', 'bg-amber-500/15 text-amber-700 dark:text-amber-400'],
};

function minutesText(m: number) {
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim();
}

// Counts up to the value once, so the numbers feel alive on arrival.
function useCountUp(value: number, ms = 700) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setShown(value); return; }
    let raf = 0;
    const start = performance.now();
    const from = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      setShown(Math.round(from + (value - from) * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return shown;
}

function Num({ value }: { value: number }) {
  return <>{useCountUp(value)}</>;
}

function Card({ title, icon: Icon, action, children, className = '' }: { title: string; icon: typeof Gauge; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border bg-card/90 p-4 shadow-[0_10px_30px_-24px_hsl(200_32%_13%/0.5)] md:p-5 ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-bold"><Icon className="h-4.5 w-4.5 text-primary" /> {title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Tile({ icon: Icon, label, value, detail, tone, onClick, testId }: {
  icon: typeof Gauge; label: string; value: ReactNode; detail: ReactNode; tone?: 'accent' | 'warn' | 'live'; onClick?: () => void; testId?: string;
}) {
  const ring = tone === 'warn' ? 'border-destructive/40' : tone === 'accent' ? 'border-primary/40' : tone === 'live' ? 'border-emerald-500/40' : '';
  const iconTone = tone === 'warn' ? 'text-destructive' : tone === 'accent' ? 'text-primary' : tone === 'live' ? 'text-emerald-600' : 'text-muted-foreground';
  const body = (
    <>
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
        <Icon className={`h-4 w-4 ${iconTone}`} /> {label}
        {tone === 'live' && <span className="relative ml-auto flex h-2 w-2"><span className="dl-ping absolute inset-0 rounded-full bg-emerald-500" /><span className="relative h-2 w-2 rounded-full bg-emerald-500" /></span>}
      </div>
      <p className="mt-1 text-3xl font-extrabold tracking-tight" data-testid={testId}>{value}</p>
      <p className="truncate text-xs text-muted-foreground">{detail}</p>
    </>
  );
  const cls = `rounded-2xl border bg-card/90 p-4 text-left shadow-[0_10px_30px_-24px_hsl(200_32%_13%/0.5)] ${ring}`;
  return onClick
    ? <button type="button" onClick={onClick} className={`${cls} transition-all hover:-translate-y-0.5 hover:bg-card hover:shadow-md`}>{body}</button>
    : <div className={cls}>{body}</div>;
}

// A ring showing used against the quota (or the period elapsed when unlimited).
function UsageRing({ used, quota, grace }: { used: number; quota: number; grace: number }) {
  const pct = quota ? Math.min(1, used / quota) : 0;
  const animated = useCountUp(Math.round(pct * 1000), 900) / 1000;
  const r = 52;
  const c = 2 * Math.PI * r;
  const tone = pct >= 1 ? 'hsl(var(--destructive))' : pct >= 0.8 ? 'hsl(38 92% 50%)' : 'hsl(var(--primary))';
  const planShare = quota && grace ? (quota - grace) / quota : 1;
  return (
    <div className="relative grid h-36 w-36 shrink-0 place-items-center">
      <svg viewBox="0 0 128 128" className="absolute inset-0 -rotate-90" role="img" aria-label={quota ? `${used} of ${quota} used` : `${used} used, unlimited`}>
        <circle cx="64" cy="64" r={r} fill="none" stroke="hsl(var(--foreground) / 0.08)" strokeWidth="12" />
        {grace > 0 && (
          // The grace part of the quota, marked as a thin outer arc.
          <circle cx="64" cy="64" r={r + 9} fill="none" stroke="hsl(var(--primary) / 0.35)" strokeWidth="3" strokeDasharray={`${(1 - planShare) * 2 * Math.PI * (r + 9)} ${2 * Math.PI * (r + 9)}`}
            strokeDashoffset={-planShare * 2 * Math.PI * (r + 9)} strokeLinecap="round" />
        )}
        {quota > 0 && <circle cx="64" cy="64" r={r} fill="none" stroke={tone} strokeWidth="12" strokeLinecap="round" strokeDasharray={`${animated * c} ${c}`} />}
      </svg>
      <div className="text-center">
        <p className="text-3xl font-extrabold tracking-tight" data-testid="dash-usage"><Num value={used} /></p>
        <p className="text-xs font-semibold text-muted-foreground">{quota ? `of ${quota} used` : 'used · unlimited'}</p>
      </div>
    </div>
  );
}

// Sessions per day: one series, hover for the day.
function DayBars({ days }: { days: CompanyDashboard['history']['days'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [metric, setMetric] = useState<'sessions' | 'minutes'>('sessions');
  const values = days.map((d) => d[metric]);
  const max = Math.max(1, ...values);
  return (
    <div>
      <div className="mb-2 flex justify-end">
        <div className="flex gap-1 rounded-lg bg-muted/80 p-0.5 text-[11px]">
          {(['sessions', 'minutes'] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMetric(m)} aria-pressed={metric === m}
              className={`rounded-md px-2 py-0.5 font-semibold capitalize ${metric === m ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}>{m}</button>
          ))}
        </div>
      </div>
      <div className="relative flex h-40 items-end gap-[2px] border-b border-foreground/15" onMouseLeave={() => setHover(null)} role="img"
        aria-label={`${metric} per day for the last 30 days`}>
        {[0.25, 0.5, 0.75].map((g) => <div key={g} className="pointer-events-none absolute inset-x-0 border-t border-dashed border-foreground/8" style={{ bottom: `${g * 100}%` }} />)}
        {days.map((d, i) => (
          <div key={d.day} className="flex h-full flex-1 cursor-default items-end" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0}>
            <div className={`w-full rounded-t-[4px] transition-all duration-500 ${hover === i ? 'bg-primary' : 'bg-primary/65'}`}
              style={{ height: values[i] ? `${Math.max(3, (values[i] / max) * 100)}%` : '0%' }} />
          </div>
        ))}
        {hover !== null && (
          <div className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border bg-popover px-2.5 py-1.5 text-xs shadow-md"
            style={{ left: `${Math.min(88, Math.max(12, ((hover + 0.5) / days.length) * 100))}%` }}>
            <p className="font-semibold">{dayFmt(days[hover].day)}</p>
            <p className="text-muted-foreground">{days[hover].sessions} session{days[hover].sessions === 1 ? '' : 's'} · {minutesText(days[hover].minutes)}</p>
          </div>
        )}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
        <span>{days[0] && dayFmt(days[0].day)}</span><span>{days[14] && dayFmt(days[14].day)}</span><span>Today</span>
      </div>
    </div>
  );
}

// When sessions start, by hour of day: a one-hue strip, darker is busier.
function HourStrip({ hours }: { hours: number[] }) {
  const max = Math.max(1, ...hours);
  const [hover, setHover] = useState<number | null>(null);
  const busiest = hours.indexOf(Math.max(...hours));
  const label = (h: number) => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;
  return (
    <div>
      <div className="grid gap-[2px]" style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }} onMouseLeave={() => setHover(null)}>
        {hours.map((n, h) => (
          <div key={h} onMouseEnter={() => setHover(h)} title={`${label(h)}: ${n} session${n === 1 ? '' : 's'}`}
            className={`h-8 rounded-[4px] ${hover === h ? 'ring-2 ring-foreground/40' : ''}`}
            style={{ background: n ? `hsl(var(--primary) / ${0.15 + 0.85 * (n / max)})` : 'hsl(var(--foreground) / 0.06)' }} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted-foreground"><span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>11 PM</span></div>
      <p className="mt-2 text-xs text-muted-foreground">
        {hover !== null ? <><b className="text-foreground">{label(hover)}</b> · {hours[hover]} session{hours[hover] === 1 ? '' : 's'}</>
          : hours.some(Boolean) ? <>Busiest hour: <b className="text-foreground">{label(busiest)}</b></> : 'No sessions in the last 30 days.'}
      </p>
    </div>
  );
}

function Meter({ label, value, max, detail }: { label: string; value: number; max: number; detail?: string }) {
  return (
    <div>
      <div className="flex justify-between gap-2 text-sm"><span className="truncate font-semibold">{label}</span><span className="shrink-0 text-muted-foreground">{detail ?? value}</span></div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-foreground/8">
        <div className="h-full rounded-full bg-primary/80 transition-[width] duration-700" style={{ width: `${max ? Math.max(value ? 3 : 0, (value / max) * 100) : 0}%` }} />
      </div>
    </div>
  );
}

export function CompanyDashboardView({ onOpen }: { onOpen: (tab: 'pcs' | 'connect' | 'download') => void }) {
  const q = useQuery({ queryKey: COMPANY_DASHBOARD_KEY, queryFn: load, refetchInterval: 10_000 });
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(id); }, []);
  const d = q.data;
  const greeting = useMemo(() => {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  }, []);

  if (!d) {
    return (
      <div className="grid gap-3 md:grid-cols-4" aria-busy="true">
        {q.isError ? <p className="col-span-full py-10 text-center text-sm text-muted-foreground">The dashboard could not be loaded. <button type="button" className="font-semibold text-primary underline" onClick={() => void q.refetch()}>Try again</button></p>
          : Array.from({ length: 8 }, (_, i) => <div key={i} className="dl-pulse h-28 rounded-2xl border bg-card/60" />)}
      </div>
    );
  }

  const sub = d.subscription;
  const u = d.usage;
  const end = sub?.currentPeriodEnd ?? null;
  const start = sub?.currentPeriodStart ?? null;
  const daysLeft = end ? Math.ceil((end - now) / 86_400_000) : null;
  const periodPct = end && start && end > start ? Math.min(1, Math.max(0, (now - start) / (end - start))) : 0;
  const usagePct = u.quota ? u.used / u.quota : 0;
  // A simple projection: at this pace, will the quota last the period?
  const projected = u.quota && periodPct > 0.05 ? Math.round(u.used / periodPct) : null;
  const modeMax = Math.max(1, ...Object.values(d.history.byMode));
  const pcMax = Math.max(1, ...d.history.topPcs.map((p) => p.sessions));
  const [statusLabel, statusCls] = sub ? STATUS[sub.status] ?? STATUS.active : ['No plan', 'bg-muted text-muted-foreground'];

  return (
    <div className="space-y-4" data-testid="company-dashboard">
      {/* Hero */}
      <div className="dl-rise relative overflow-hidden rounded-3xl border bg-gradient-to-br from-primary/12 via-card to-card p-5 shadow-[0_18px_40px_-28px_hsl(14_78%_40%/0.6)] md:p-7">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-primary/10 blur-2xl" />
        <div className="relative flex flex-wrap items-center gap-6">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">{greeting} · {raLabel(d.company.raId)}</p>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight md:text-4xl" data-testid="dash-company">{d.company.name}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusCls}`} data-testid="dash-status">{statusLabel}</span>
              {sub?.plan && <span className="rounded-full border bg-background/70 px-2.5 py-1 text-xs font-semibold">{sub.plan.name} · {inr(sub.plan.priceInr)}/{INTERVAL[sub.plan.interval]}</span>}
              {sub?.autoRenew && <span className="rounded-full border bg-background/70 px-2.5 py-1 text-xs font-semibold text-muted-foreground">Auto-renews</span>}
            </div>
            {sub ? (
              <div className="mt-4 max-w-md">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{dateFmt(start)}</span>
                  <span className="font-semibold text-foreground" data-testid="dash-renewal">
                    {daysLeft === null ? '—' : daysLeft > 0 ? `${sub.autoRenew ? 'Renews' : 'Ends'} in ${daysLeft} day${daysLeft === 1 ? '' : 's'}` : 'Period ended'} · {dateFmt(end)}
                  </span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-foreground/10">
                  <div className={`h-full rounded-full transition-[width] duration-1000 ${daysLeft !== null && daysLeft <= 7 ? 'bg-amber-500' : 'bg-foreground/70'}`} style={{ width: `${periodPct * 100}%` }} />
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">{Math.round(periodPct * 100)}% of this billing period has passed</p>
              </div>
            ) : (
              <p className="mt-3 max-w-md text-sm text-muted-foreground">Your company has no subscription plan on record, so nothing is limited. Ask your WINRSS.net provider about plans.</p>
            )}
          </div>
          <div className="flex items-center gap-5">
            <UsageRing used={u.used} quota={u.quota} grace={u.grace} />
            <div className="space-y-2 text-sm">
              <p className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-primary" /> <b><Num value={u.urls} /></b> <span className="text-muted-foreground">URLs authorized</span></p>
              <p className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-primary/50" /> <b><Num value={u.extraSessions} /></b> <span className="text-muted-foreground">extra sessions</span></p>
              {u.quota > 0 && <p className="text-xs text-muted-foreground">Plan {u.planQuota}{u.grace ? ` + ${u.grace} grace` : ''} · <b className="text-foreground">{u.remaining ?? 0}</b> left</p>}
              {projected !== null && u.quota > 0 && (
                <p className={`flex items-center gap-1 text-xs ${projected > u.quota ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}`}>
                  <TrendingUp className="h-3.5 w-3.5" /> On pace for ~{projected} this period
                </p>
              )}
            </div>
          </div>
        </div>
        {u.blocked && (
          <div role="alert" className="relative mt-5 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive" data-testid="dash-blocked">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span><b>{u.reason === 'quota' ? 'Usage limit reached.' : 'Sessions are paused.'}</b> {u.message} No new Access PIN is issued until this is resolved.</span>
          </div>
        )}
        {!u.blocked && u.quota > 0 && usagePct >= 0.8 && (
          <div className="relative mt-5 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>You have used {Math.round(usagePct * 100)}% of this period's quota. When it runs out, the Access PIN stops and new sessions are refused.</span>
          </div>
        )}
      </div>

      {/* Key numbers */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Tile icon={MonitorPlay} label="Live now" value={<Num value={d.live.length} />} testId="dash-live" tone={d.live.length ? 'live' : undefined}
          detail={d.live.length ? `${d.live.reduce((t, s) => t + s.viewers, 0)} viewer(s) connected` : 'No active session'} />
        <Tile icon={Laptop} label="PCs online" value={<Num value={d.pcs.online + d.pcs.busy} />} detail={`${d.pcs.busy} in a session`} onClick={() => onOpen('pcs')} />
        <Tile icon={BellRing} label="Initiate waiting" value={<Num value={d.requests.waiting} />} tone={d.requests.waiting ? 'accent' : undefined}
          detail={`${d.requests.accepted} accepted · ${d.requests.missed} missed`} onClick={() => onOpen('pcs')} />
        <Tile icon={Link2} label="Active URLs" value={<Num value={d.links.active} />} detail={`${d.links.thisPeriod} this period · ${d.links.total} in all`} onClick={() => onOpen('pcs')} />
        <Tile icon={CalendarDays} label="Sessions · 30 days" value={<Num value={d.history.sessions30} />} detail={`${minutesText(d.history.minutes30)} in total`} />
        <Tile icon={Timer} label="Average session" value={<>{d.history.avgMinutes}<span className="text-base font-bold text-muted-foreground"> min</span></>} detail={`Longest ${minutesText(d.history.longestMinutes)}`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Activity, last 30 days" icon={CalendarClock} className="lg:col-span-2">
          <DayBars days={d.history.days} />
        </Card>
        <Card title="Live sessions" icon={Zap} action={<span className="text-xs text-muted-foreground">updates every 10 s</span>}>
          {d.live.length === 0 ? (
            <div className="grid place-items-center py-8 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-muted"><MonitorPlay className="h-5 w-5 text-muted-foreground" /></span>
              <p className="mt-2 text-sm text-muted-foreground">No one is connected right now.</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {d.live.map((s) => (
                <li key={s.id} className="flex items-center gap-3 rounded-xl border bg-background/60 p-2.5">
                  <span className="relative flex h-2.5 w-2.5"><span className="dl-ping absolute inset-0 rounded-full bg-emerald-500" /><span className="relative h-2.5 w-2.5 rounded-full bg-emerald-500" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{s.name || 'Windows PC'}</p>
                    <p className="text-xs text-muted-foreground">{MODE[s.mode]} · {s.viewers} viewer{s.viewers === 1 ? '' : 's'}</p>
                  </div>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">{s.liveAt ? clock(now - s.liveAt) : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="When you connect" icon={Clock}>
          <HourStrip hours={d.history.hours} />
          <div className="mt-4 space-y-2.5">
            {(['link', 'unattended', 'attended'] as const).map((m) => (
              <Meter key={m} label={MODE[m]} value={d.history.byMode[m] ?? 0} max={modeMax} />
            ))}
          </div>
        </Card>
        <Card title="Most supported PCs" icon={Laptop}>
          {d.history.topPcs.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">Sessions in the last 30 days appear here.</p> : (
            <div className="space-y-3">
              {d.history.topPcs.map((p) => <Meter key={p.name} label={p.name} value={p.sessions} max={pcMax} detail={`${p.sessions} · ${minutesText(p.minutes)}`} />)}
            </div>
          )}
        </Card>
        <Card title="Plan and billing" icon={BadgeCheck}>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-xl bg-muted/60 px-3 py-2"><dt className="text-xs text-muted-foreground">Plan</dt><dd className="truncate font-bold">{sub?.plan?.name ?? '—'}</dd></div>
            <div className="rounded-xl bg-muted/60 px-3 py-2"><dt className="text-xs text-muted-foreground">Price</dt><dd className="font-bold">{sub?.plan ? `${inr(sub.plan.priceInr)}` : '—'}</dd></div>
            <div className="rounded-xl bg-muted/60 px-3 py-2"><dt className="text-xs text-muted-foreground">Customer since</dt><dd className="font-bold">{dateFmt(sub?.startedAt)}</dd></div>
            <div className="rounded-xl bg-muted/60 px-3 py-2"><dt className="text-xs text-muted-foreground">Renewal date</dt><dd className="font-bold">{dateFmt(end)}</dd></div>
          </dl>
          {d.payments.open.length > 0 ? (
            <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/8 p-3 text-sm">
              <p className="flex items-center gap-1.5 font-semibold"><IndianRupee className="h-4 w-4" /> {inr(d.payments.openAmountInr)} due</p>
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                {d.payments.open.map((p) => <li key={p.id} className={p.status === 'overdue' ? 'font-semibold text-destructive' : ''}>{inr(p.amountInr)} · {p.status === 'overdue' ? 'overdue since' : 'due'} {dateFmt(p.dueDate)}</li>)}
              </ul>
            </div>
          ) : (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground"><Sparkles className="h-3.5 w-3.5 text-emerald-600" /> No payments due{d.payments.lastPaid ? ` · last paid ${inr(d.payments.lastPaid.amountInr)} on ${dateFmt(d.payments.lastPaid.paidAt)}` : ''}.</p>
          )}
          {u.graceLog.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">Grace this period: {u.graceLog.map((g) => `+${g.amount} on ${dayFmt(g.at)}`).join(', ')}</p>
          )}
        </Card>
      </div>

      <Card title="Recent remote access URLs" icon={KeyRound} action={
        <button type="button" onClick={() => void q.refetch()} className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">
          <RefreshCw className={`h-3.5 w-3.5 ${q.isFetching ? 'animate-spin' : ''}`} /> Refresh
        </button>}>
        {d.links.recent.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">URLs authorized with your Access PIN appear here.</p> : (
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead><tr className="text-xs text-muted-foreground"><th className="px-1 py-2 font-semibold">PC</th><th className="px-1 py-2 font-semibold">Authorized</th><th className="px-1 py-2 font-semibold">Sessions</th><th className="px-1 py-2 font-semibold">Status</th></tr></thead>
              <tbody className="divide-y divide-foreground/8">
                {d.links.recent.map((l) => (
                  <tr key={l.code}>
                    <td className="px-1 py-2"><p className="font-semibold">{l.pcName || 'Windows PC'}</p><p className="font-mono text-[11px] text-muted-foreground">/r/{l.code}</p></td>
                    <td className="px-1 py-2 text-xs text-muted-foreground">{l.claimedAt ? relativeTime(l.claimedAt, now) : '—'}</td>
                    <td className="px-1 py-2">{l.sessions}</td>
                    <td className="px-1 py-2">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${l.status === 'active' ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400' : 'bg-foreground/8 text-muted-foreground'}`}>
                        {l.status === 'active' && <i className={`h-1.5 w-1.5 rounded-full ${l.online ? 'bg-emerald-500' : 'bg-foreground/30'}`} />}
                        {l.status === 'active' ? (l.online ? 'Active · PC online' : 'Active · PC offline') : l.status === 'expired' ? 'Expired' : 'Cleared'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">Each URL authorized with your Access PIN counts once toward your usage, and so does each session started while another of yours is already live.</p>
      </Card>
    </div>
  );
}

function clock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(sec).padStart(2, '0')}`;
}
