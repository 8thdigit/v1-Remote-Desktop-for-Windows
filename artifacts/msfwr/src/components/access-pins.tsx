import { useState } from 'react';
import type { MsfwrRaLink } from '@workspace/api-client-react';
import { Check, Copy, Eye, EyeOff, KeyRound } from 'lucide-react';

// Remote access URLs and their Access PINs. Whoever opens a URL also needs its
// four-digit Access PIN, which only the company behind the PC's RA ID (and
// relay admins) can see here. The company shares it separately from the URL.

function validUntil(at: number) {
  return new Date(at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function StatePill({ link }: { link: MsfwrRaLink }) {
  const [text, cls] = link.blocked
    ? ['Blocked: too many wrong PINs', 'bg-destructive/10 text-destructive']
    : link.locked
      ? ['Locked for 15 min', 'bg-amber-500/15 text-amber-700']
      : link.online
        ? ['PC online', 'bg-emerald-500/12 text-emerald-700']
        : ['PC offline', 'bg-foreground/8 text-muted-foreground'];
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{text}</span>;
}

function PinRow({ link, detail }: { link: MsfwrRaLink; detail?: string }) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(link.accessPin);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked: the PIN can still be read off the screen */ }
  }
  return (
    <li className="flex flex-wrap items-center gap-3 py-2.5" data-testid={`access-pin-${link.name}`}>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><KeyRound className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          <span className="truncate">{link.name || 'Windows PC'}</span> <StatePill link={link} />
        </p>
        <p className="text-xs text-muted-foreground">
          {detail ? `${detail} · ` : ''}Valid until {validUntil(link.expiresAt)}
          {link.sessions ? ` · used ${link.sessions} ${link.sessions === 1 ? 'time' : 'times'}` : ''}
        </p>
      </div>
      <div className="flex items-center gap-1 rounded-lg bg-muted/70 px-2.5 py-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Access PIN</span>
        <span className="min-w-[4.5ch] font-mono text-lg font-bold tracking-[0.25em]" data-testid={`text-access-pin-${link.name}`}>
          {shown ? link.accessPin : '••••'}
        </span>
        <button type="button" onClick={() => setShown((v) => !v)} title={shown ? 'Hide PIN' : 'Show PIN'} aria-label={shown ? 'Hide PIN' : 'Show PIN'}
          data-testid={`button-show-pin-${link.name}`} className="rounded p-1 text-muted-foreground hover:text-foreground">
          {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
        <button type="button" onClick={() => void copy()} title="Copy PIN" aria-label="Copy PIN"
          className="rounded p-1 text-muted-foreground hover:text-foreground">
          {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
    </li>
  );
}

export function AccessPinList({ links, detail }: { links: MsfwrRaLink[]; detail?: (link: MsfwrRaLink) => string | undefined }) {
  return (
    <ul className="divide-y divide-foreground/8" data-testid="list-access-pins">
      {links.map((link) => <PinRow key={link.id} link={link} detail={detail?.(link)} />)}
    </ul>
  );
}
