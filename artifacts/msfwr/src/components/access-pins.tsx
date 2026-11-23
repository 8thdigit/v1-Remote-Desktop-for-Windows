import { useEffect, useState } from 'react';
import type { MsfwrCompanyPin, MsfwrLinkRecord } from '@workspace/api-client-react';
import { Building2, Check, Copy, KeyRound, Link2, Timer } from 'lucide-react';
import { raLabel } from '@/lib/auth';

// Company Access PINs and the remote access URL register.
//
// Opening a remote access URL needs a four-digit Access PIN from a company.
// Each company sees its own current PIN, which changes every three minutes
// until it is used. The first PIN entered on a URL authorizes that URL for
// its company: from then on only that PIN opens it, until the URL expires.

const when = (at: number) =>
  new Date(at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function minutes(ms: number) {
  const m = Math.round(ms / 60_000);
  return m < 1 ? '<1 min' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function urlOf(code: string) {
  const base = typeof window === 'undefined' ? '' : window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}/r/${code}`;
}

function CopyText({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" title={label} aria-label={label}
      onClick={() => { void navigator.clipboard?.writeText(text).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }).catch(() => {}); }}
      className="rounded p-1 text-muted-foreground hover:text-foreground">
      {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
    </button>
  );
}

// The company's current PIN with a countdown. A new one arrives with the next
// poll once this one expires or is used.
export function CompanyPinCard({ pin }: { pin: MsfwrCompanyPin }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const left = Math.max(0, Math.ceil((pin.expiresAt - now) / 1000));
  const total = Math.max(1, (pin.expiresAt - pin.issuedAt) / 1000);
  return (
    <div className="mt-4 flex flex-wrap items-center gap-4 rounded-2xl border border-primary/30 bg-primary/5 p-4" data-testid="card-company-pin">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary"><KeyRound className="h-5 w-5" /></span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold">Your Access PIN for the next remote access URL</p>
        <p className="text-xs text-muted-foreground">
          Tell it to the person opening the URL, separately from the URL. The first time it is entered on a URL, that URL is authorized for
          your company and the PIN keeps working for it until the URL expires. An unused PIN changes every 3 minutes.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span className="font-mono text-3xl font-extrabold tracking-[0.3em]" data-testid="text-company-pin">{left ? pin.pin : '····'}</span>
        <CopyText text={pin.pin} label="Copy PIN" />
      </div>
      <div className="w-full">
        <div className="h-1 overflow-hidden rounded-full bg-foreground/10">
          <div className="h-full rounded-full bg-primary transition-[width] duration-1000" style={{ width: `${(left / total) * 100}%` }} />
        </div>
        <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
          <Timer className="h-3 w-3" /> {left ? `Changes in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} unless used` : 'Getting a new PIN…'}
        </p>
      </div>
    </div>
  );
}

const STATUS: Record<MsfwrLinkRecord['status'], [string, string]> = {
  active: ['Active', 'bg-emerald-500/12 text-emerald-700'],
  expired: ['Expired', 'bg-foreground/8 text-muted-foreground'],
  cleared: ['Cleared on the PC', 'bg-foreground/8 text-muted-foreground'],
};

function RecordRow({ r, showCompany, companyName }: { r: MsfwrLinkRecord; showCompany: boolean; companyName?: (raId: string) => string | undefined }) {
  const [label, cls] = r.blocked && r.status === 'active' ? ['Blocked: too many wrong PINs', 'bg-destructive/10 text-destructive']
    : r.locked && r.status === 'active' ? ['Locked for 15 min', 'bg-amber-500/15 text-amber-700'] : STATUS[r.status];
  const url = urlOf(r.code);
  const used = r.sessions.reduce((t, s) => t + s.durationMs, 0);
  return (
    <li className="py-3" data-testid={`link-record-${r.code}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Link2 className="h-4 w-4 shrink-0 text-primary" />
        <span className="truncate font-mono text-sm font-semibold" title={url}>{url.replace(/^https?:\/\//, '')}</span>
        <CopyText text={url} label="Copy URL" />
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{label}</span>
        {r.status === 'active' && r.viewers > 0 && <span className="rounded-full bg-primary/12 px-2 py-0.5 text-[11px] font-semibold text-primary">{r.viewers} connected now</span>}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        PC <span className="font-semibold text-foreground">{r.pcName || 'Windows PC'}</span>
        {showCompany && r.pcRa ? ` (points to ${raLabel(r.pcRa)})` : ''} · created {when(r.createdAt)} · valid until {when(r.expiresAt)} ({r.ttlHours} h)
        {r.revokedAt ? ` · cleared ${when(r.revokedAt)}` : ''}
      </p>
      {r.claim ? (
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs">
          <span className="flex items-center gap-1 font-semibold">
            <Building2 className="h-3.5 w-3.5 text-primary" />
            Authorized {showCompany ? <>by {companyName?.(r.claim.raId) ?? r.claim.company} ({raLabel(r.claim.raId)})</> : ''} {when(r.claim.at)}
          </span>
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono font-bold tracking-[0.2em]" data-testid={`text-link-pin-${r.code}`}>PIN {r.claim.pin}</span>
          <span className="text-muted-foreground">
            {r.sessions.length ? `${r.sessions.length} ${r.sessions.length === 1 ? 'session' : 'sessions'} ended, ${minutes(used)} in all` : 'No session ended yet'}
          </span>
        </p>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">Not authorized by any company yet.</p>
      )}
    </li>
  );
}

export function LinkRecordList({ records, showCompany = false, companyName }: {
  records: MsfwrLinkRecord[]; showCompany?: boolean; companyName?: (raId: string) => string | undefined;
}) {
  return (
    <ul className="divide-y divide-foreground/8" data-testid="list-link-records">
      {records.map((r) => <RecordRow key={r.code} r={r} showCompany={showCompany} companyName={companyName} />)}
    </ul>
  );
}
