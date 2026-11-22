import { useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { changePassword } from '@workspace/api-client-react';
import { Check, ChevronDown, Copy, KeyRound, LogOut, Radio, ShieldCheck, UserRound } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { errorText, raLabel, useAuth } from '@/lib/auth';

export function Brand({ subtitle = 'Remote support · Windows' }: { subtitle?: string }) {
  return (
    <Link href="/" className="flex items-center gap-2.5" data-testid="text-brand">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-foreground text-background shadow-sm">
        <Radio className="h-4.5 w-4.5 text-primary" />
      </span>
      <span className="leading-tight">
        <span className="block text-lg font-bold tracking-tight">Msfwr</span>
        <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{subtitle}</span>
      </span>
    </Link>
  );
}

// The signed-in user's RA ID, which IT gives to a PC so its requests reach them.
export function RaBadge({ compact = false }: { compact?: boolean }) {
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" data-testid="button-copy-ra" title="Copy your RA ID. Enter it in the Msfwr window on a PC so the PC and its requests come to you."
      onClick={() => { void navigator.clipboard.writeText(raLabel(user.raId)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); }}
      className="flex items-center gap-2 rounded-xl border border-primary/25 bg-primary/8 px-3 py-1.5 font-mono text-xs font-bold text-primary hover:bg-primary/12">
      {!compact && <span className="font-sans text-[10px] font-semibold uppercase tracking-widest text-primary/75">Your RA ID</span>}
      {raLabel(user.raId)}
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5 opacity-70" />}
    </button>
  );
}

export function UserMenu() {
  const { user, signOut, refresh } = useAuth();
  const [password, setPassword] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger data-testid="button-user-menu"
          className="flex items-center gap-2 rounded-xl border border-foreground/10 bg-card/80 px-2.5 py-1.5 text-sm font-semibold hover:bg-card">
          <span className="grid h-6 w-6 place-items-center rounded-lg bg-foreground text-[11px] font-bold uppercase text-background">
            {user.displayName.slice(0, 1)}
          </span>
          <span className="hidden max-w-32 truncate xl:inline">{user.displayName}</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel className="font-normal">
            <p className="truncate font-semibold">{user.displayName}</p>
            <p className="truncate text-xs text-muted-foreground">{user.username} · {user.role === 'admin' ? 'Admin' : 'Company'}</p>
            <p className="mt-1 font-mono text-xs font-bold text-primary">{raLabel(user.raId)}</p>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild><Link href="/"><UserRound className="mr-2 h-4 w-4" /> Requests and PCs</Link></DropdownMenuItem>
          {user.role === 'admin' && (
            <DropdownMenuItem asChild><Link href="/admin" data-testid="link-admin"><ShieldCheck className="mr-2 h-4 w-4" /> Admin console</Link></DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => setPassword(true)}><KeyRound className="mr-2 h-4 w-4" /> Change password</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void signOut()} data-testid="button-sign-out"><LogOut className="mr-2 h-4 w-4" /> Sign out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <PasswordDialog open={password} onClose={() => setPassword(false)} onDone={refresh} />
    </>
  );
}

function PasswordDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => Promise<void> }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const close = () => { setCurrent(''); setNext(''); setConfirm(''); setError(null); setDone(false); onClose(); };
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== confirm) { setError('The new passwords do not match.'); return; }
    setBusy(true);
    setError(null);
    try {
      await changePassword({ current, next });
      setDone(true);
      await onDone();
    } catch (reason) {
      setError(errorText(reason, 'Could not change the password.'));
    } finally {
      setBusy(false);
    }
  }
  const input = 'w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40';
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>Other browsers signed in to your account are signed out.</DialogDescription>
        </DialogHeader>
        {done ? (
          <p className="flex items-center gap-2 rounded-xl bg-emerald-500/10 px-3 py-3 text-sm text-emerald-700"><Check className="h-4 w-4" /> Password changed.</p>
        ) : (
          <form id="password-form" onSubmit={submit} className="space-y-3">
            <input className={input} type="password" placeholder="Current password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
            <input className={input} type="password" placeholder="New password (8+ characters)" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} minLength={8} required />
            <input className={input} type="password" placeholder="Confirm new password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={8} required />
            {error && <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          </form>
        )}
        <DialogFooter>
          {done ? (
            <button type="button" onClick={close} className="rounded-xl bg-foreground px-4 py-2 text-sm font-bold text-background">Done</button>
          ) : (
            <>
              <button type="button" onClick={close} className="rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-muted">Cancel</button>
              <button type="submit" form="password-form" disabled={busy || next.length < 8} className="rounded-xl bg-foreground px-4 py-2 text-sm font-bold text-background disabled:opacity-40">
                {busy ? 'Saving…' : 'Change password'}
              </button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
