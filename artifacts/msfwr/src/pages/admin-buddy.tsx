import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen, ClipboardList, KeyRound, Loader2, Pencil, Plus, RefreshCw, Search, Sparkles, Trash2, TriangleAlert, Users,
} from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { errorText, raLabel } from '@/lib/auth';

// Admin console: the session summaries page and AI Buddy (IT support
// assistance) settings with its knowledge base.

type Mode = 'attended' | 'unattended' | 'link';

export type SummaryRow = {
  id: string; live: boolean; pcName: string; mode: Mode; operator: string; company: string; raId: string;
  startedAt: number; endedAt: number | null; durationMs: number; viewers: number;
  summary: string; summaryBy: '' | 'ai' | 'auto'; issues: string[]; captureCount: number; resolution: string; hasRecord: boolean;
};

type BuddyCapture = { at: number; text: string; issues: string[] };
type BuddyRecord = {
  id: string; pcName: string; operator: string; startedAt: number; endedAt?: number; issues: string[]; suggested: string[];
  summary: string; summaryBy: '' | 'ai' | 'auto'; summaryAt: number; notes: string; resolution: string; captures: BuddyCapture[];
};

type BuddySettings = {
  enabled: boolean; ai: boolean; autoAssist: boolean; model: string; captureSeconds: number;
  apiKeySet: boolean; envKeySet: boolean; aiReady: boolean;
};

type KbEntry = {
  id: string; title: string; symptoms: string; keywords: string[]; steps: string; source: 'builtin' | 'admin' | 'session';
  createdBy: string; updatedAt: number; uses: number;
};

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
const send = <T,>(path: string, method: string, body?: unknown) => api<T>(path, { method, body: JSON.stringify(body ?? {}) });

const MODE_LABEL: Record<Mode, string> = { attended: 'Attended', unattended: 'Unattended', link: 'Remote URL' };
const dateTime = (ms: number) => new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const timeOnly = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
function fmtDuration(ms: number) {
  const m = Math.round(ms / 60_000);
  if (m < 1) return '< 1 min';
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

function Card({ title, icon: Icon, action, children }: { title: string; icon: typeof Search; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-2xl border bg-card/90 p-4 shadow-[0_10px_30px_-24px_hsl(200_32%_13%/0.5)] md:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-bold"><Icon className="h-4.5 w-4.5 text-primary" /> {title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}
const Empty = ({ text }: { text: string }) => <p className="py-6 text-center text-sm text-muted-foreground">{text}</p>;
const fieldCls = 'rounded-xl border border-foreground/15 bg-background px-3 py-2 text-sm outline-none focus:border-primary';
const inputCls = 'w-full rounded-xl border border-foreground/15 bg-background px-3 py-2 text-sm outline-none focus:border-primary';

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-foreground/10 bg-background/60 px-3 py-2">
      <p className="text-[11px] font-semibold text-muted-foreground">{label}</p>
      <p className="text-xl font-extrabold">{value}</p>
    </div>
  );
}

// --- Session summaries ---

export function SessionSummariesPanel({ onError }: { onError: (msg: string | null) => void }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['session-summaries'], queryFn: () => api<{ sessions: SummaryRow[] }>('/session-summaries'), refetchInterval: 15_000 });
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<'all' | Mode>('all');
  const [show, setShow] = useState<'all' | 'live' | 'problems' | 'summarized'>('all');
  const [open, setOpen] = useState<SummaryRow | null>(null);

  useEffect(() => { if (list.error) onError(errorText(list.error, 'Could not load the session summaries.')); }, [list.error, onError]);

  const rows = list.data?.sessions ?? [];
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) =>
      (mode === 'all' || r.mode === mode) &&
      (show === 'all' || (show === 'live' && r.live) || (show === 'problems' && r.issues.length > 0) || (show === 'summarized' && !!r.summary)) &&
      (!needle || [r.pcName, r.company, r.operator, r.summary, r.resolution, raLabel(r.raId), ...r.issues].join(' ').toLowerCase().includes(needle)));
  }, [rows, q, mode, show]);

  const ended = rows.filter((r) => !r.live);
  const avg = ended.length ? ended.reduce((t, r) => t + r.durationMs, 0) / ended.length : 0;

  return (
    <Card title="Session summaries" icon={ClipboardList} action={
      <button type="button" onClick={() => void qc.invalidateQueries({ queryKey: ['session-summaries'] })} className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">
        <RefreshCw className="h-3.5 w-3.5" /> Refresh
      </button>}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Sessions" value={rows.length} />
        <Stat label="Live now" value={rows.filter((r) => r.live).length} />
        <Stat label="With problems on screen" value={rows.filter((r) => r.issues.length).length} />
        <Stat label="Average length" value={ended.length ? fmtDuration(avg) : '—'} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <label className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search PC, company, helper, summary or error" aria-label="Search sessions"
            className={`${inputCls} pl-9`} data-testid="input-summary-search" />
        </label>
        <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} aria-label="Mode" className={fieldCls}>
          <option value="all">All modes</option><option value="attended">Attended</option><option value="unattended">Unattended</option><option value="link">Remote URL</option>
        </select>
        <select value={show} onChange={(e) => setShow(e.target.value as typeof show)} aria-label="Show" className={fieldCls}>
          <option value="all">All sessions</option><option value="live">Live now</option><option value="problems">With problems</option><option value="summarized">With a summary</option>
        </select>
      </div>

      {list.isPending ? <Empty text="Loading…" /> : filtered.length === 0 ? (
        <Empty text={rows.length ? 'No session matches these filters.' : 'No sessions yet. Each session appears here when it goes live, and gets a summary when it ends.'} />
      ) : (
        <ul className="mt-3 divide-y divide-foreground/8">
          {filtered.slice(0, 300).map((r) => (
            <li key={`${r.id}-${r.startedAt}`}>
              <button type="button" onClick={() => setOpen(r)} data-testid={`summary-${r.id}`} className="w-full rounded-xl px-2 py-3 text-left hover:bg-muted/60">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{r.pcName || 'Windows PC'}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{MODE_LABEL[r.mode]}</span>
                  {r.live && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">Live</span>}
                  {r.issues.length > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-700"><TriangleAlert className="h-3 w-3" /> {r.issues.length} problem{r.issues.length === 1 ? '' : 's'}</span>}
                  {r.summaryBy === 'ai' && <span className="inline-flex items-center gap-1 rounded-full bg-primary/12 px-2 py-0.5 text-[11px] font-semibold text-primary"><Sparkles className="h-3 w-3" /> AI summary</span>}
                  <span className="ml-auto text-xs text-muted-foreground">{dateTime(r.startedAt)} · {r.live ? `live ${fmtDuration(r.durationMs)}` : fmtDuration(r.durationMs)}</span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {r.company || (r.raId ? raLabel(r.raId) : 'Unknown company')}{r.operator && r.operator !== r.company ? ` · ${r.operator}` : ''} · <Users className="inline h-3 w-3" /> {r.viewers}
                  {r.captureCount ? ` · ${r.captureCount} screens read` : ''}
                </p>
                {r.summary
                  ? <p className="mt-1 line-clamp-2 text-sm">{r.summary}</p>
                  : <p className="mt-1 text-xs italic text-muted-foreground">{r.hasRecord ? (r.live ? 'Summary is written when the session ends.' : 'No summary yet.') : 'No AI Buddy record (AI Buddy was off, or no screen was read).'}</p>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted-foreground">Up to 1000 most recent sessions. Summaries come from AI Buddy, which reads the screen during a session when it is turned on in the AI Buddy tab.</p>
      {open && <SessionDetail row={open} onClose={() => setOpen(null)} />}
    </Card>
  );
}

function SessionDetail({ row, onClose }: { row: SummaryRow; onClose: () => void }) {
  const qc = useQueryClient();
  const record = useQuery({
    queryKey: ['buddy-session', row.id],
    queryFn: () => api<BuddyRecord>(`/buddy/sessions/${encodeURIComponent(row.id)}`).catch((e: { status?: number }) => { if (e.status === 404) return null; throw e; }),
    refetchInterval: row.live ? 8000 : false,
  });
  const [notes, setNotes] = useState('');
  const [resolution, setResolution] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const loaded = record.data;
  useEffect(() => { if (loaded) { setNotes(loaded.notes); setResolution(loaded.resolution); } }, [loaded?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(label: string, fn: () => Promise<unknown>, done: string) {
    setBusy(label); setMsg(null);
    try {
      await fn();
      setMsg(done);
      await qc.invalidateQueries({ queryKey: ['buddy-session', row.id] });
      void qc.invalidateQueries({ queryKey: ['session-summaries'] });
      void qc.invalidateQueries({ queryKey: ['buddy-kb'] });
    } catch (e) { setMsg(errorText(e, 'That did not work.')); } finally { setBusy(null); }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{row.pcName || 'Windows PC'}</DialogTitle>
          <DialogDescription>
            {MODE_LABEL[row.mode]} · {row.company || (row.raId ? raLabel(row.raId) : 'Unknown company')}{row.operator && row.operator !== row.company ? ` · ${row.operator}` : ''} · started {dateTime(row.startedAt)}
            {row.endedAt ? `, ended ${dateTime(row.endedAt)}` : ' · live now'} · {fmtDuration(row.durationMs)} · {row.viewers} viewer{row.viewers === 1 ? '' : 's'}
          </DialogDescription>
        </DialogHeader>

        {record.isPending ? <Empty text="Loading…" /> : !loaded ? (
          <p className="text-sm text-muted-foreground">AI Buddy has no screen record for this session. It was off, or the helper's viewer read no screen.</p>
        ) : (
          <div className="space-y-4 text-sm">
            <section>
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-bold">Summary {loaded.summaryBy === 'ai' && <span className="ml-1 text-xs font-semibold text-primary">by Claude</span>}</h3>
                <button type="button" disabled={!!busy} onClick={() => void act('sum', () => send(`/buddy/sessions/${encodeURIComponent(row.id)}/summarize`, 'POST'), 'Summary updated.')}
                  className="inline-flex items-center gap-1 rounded-lg border border-foreground/15 px-2.5 py-1 text-xs font-semibold hover:bg-muted disabled:opacity-50" data-testid="button-summarize">
                  {busy === 'sum' ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} {loaded.summary ? 'Rewrite' : 'Write summary'}
                </button>
              </div>
              <p className="mt-1 whitespace-pre-wrap">{loaded.summary || <span className="text-muted-foreground">No summary yet.</span>}</p>
            </section>

            {loaded.issues.length > 0 && (
              <section>
                <h3 className="font-bold">Problems seen on screen</h3>
                <ul className="mt-1 space-y-1">{loaded.issues.map((i) => <li key={i} className="flex gap-1.5 text-xs"><TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />{i}</li>)}</ul>
              </section>
            )}

            <section className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-semibold">Helper notes</span>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} className={`${inputCls} mt-1`} />
              </label>
              <label className="block">
                <span className="text-xs font-semibold">Resolution (fix steps, one per line)</span>
                <textarea value={resolution} onChange={(e) => setResolution(e.target.value)} rows={4} className={`${inputCls} mt-1`} data-testid="input-resolution" />
              </label>
            </section>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={!!busy} onClick={() => void act('save', () => send(`/buddy/sessions/${encodeURIComponent(row.id)}`, 'PATCH', { notes, resolution }), 'Saved.')}
                className="rounded-xl bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-50" data-testid="button-save-notes">Save notes</button>
              <button type="button" disabled={!!busy || !resolution.trim()} title={resolution.trim() ? undefined : 'Write the resolution first'}
                onClick={() => void act('kb', async () => {
                  await send(`/buddy/sessions/${encodeURIComponent(row.id)}`, 'PATCH', { notes, resolution });
                  await send(`/buddy/sessions/${encodeURIComponent(row.id)}/kb`, 'POST', {});
                }, 'Added to the knowledge base. Edit it in the AI Buddy tab.')}
                className="inline-flex items-center gap-1 rounded-xl border border-foreground/15 px-3 py-1.5 text-sm font-semibold hover:bg-muted disabled:opacity-50" data-testid="button-to-kb">
                <BookOpen className="h-4 w-4" /> Add fix to knowledge base
              </button>
            </div>
            {msg && <p role="status" className="text-xs text-muted-foreground">{msg}</p>}

            <section>
              <h3 className="font-bold">Screens read ({loaded.captures.length})</h3>
              {loaded.captures.length === 0 ? <p className="text-xs text-muted-foreground">None.</p> : (
                <ul className="mt-1 space-y-1.5">
                  {loaded.captures.map((c) => (
                    <li key={c.at}>
                      <details className="rounded-lg border border-foreground/10 px-3 py-2">
                        <summary className="cursor-pointer text-xs font-semibold">
                          {timeOnly(c.at)} · {c.text.split('\n')[0]?.slice(0, 80) || 'No text'}{c.issues.length ? <span className="ml-1 text-amber-700">· {c.issues.length} problem{c.issues.length === 1 ? '' : 's'}</span> : null}
                        </summary>
                        <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap font-sans text-xs text-muted-foreground">{c.text}</pre>
                      </details>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
        <DialogFooter>
          {loaded && (
            <button type="button" disabled={!!busy} onClick={() => {
              if (!window.confirm('Delete AI Buddy\'s screen record and summary for this session? The session stays in the history.')) return;
              void act('del', () => api(`/buddy/sessions/${encodeURIComponent(row.id)}`, { method: 'DELETE' }), 'Deleted.');
            }} className="mr-auto inline-flex items-center gap-1 rounded-xl border border-destructive/30 px-3 py-1.5 text-sm font-semibold text-destructive hover:bg-destructive/10">
              <Trash2 className="h-4 w-4" /> Delete screen record
            </button>
          )}
          <button type="button" onClick={onClose} className="rounded-xl border px-4 py-1.5 text-sm font-semibold hover:bg-muted">Close</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- AI Buddy settings and knowledge base ---

function Switch({ checked, onChange, label, hint, testId, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string; testId: string; disabled?: boolean }) {
  return (
    <label className={`flex items-start gap-3 rounded-xl border border-foreground/10 px-3 py-2.5 ${disabled ? 'opacity-50' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-4 w-4 accent-[hsl(var(--primary))]" data-testid={testId} />
      <span><span className="block text-sm font-semibold">{label}</span><span className="block text-xs text-muted-foreground">{hint}</span></span>
    </label>
  );
}

export function AiBuddyPanel({ onError }: { onError: (msg: string | null) => void }) {
  return (
    <div className="space-y-4">
      <BuddySettingsCard onError={onError} />
      <KnowledgeBaseCard onError={onError} />
    </div>
  );
}

function BuddySettingsCard({ onError }: { onError: (msg: string | null) => void }) {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['buddy-settings'], queryFn: () => api<BuddySettings>('/buddy/settings') });
  const [draft, setDraft] = useState<BuddySettings | null>(null);
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (settings.data) setDraft(settings.data); }, [settings.data]);
  useEffect(() => { if (settings.error) onError(errorText(settings.error, 'Could not load the AI Buddy settings.')); }, [settings.error, onError]);

  async function save(extra: Record<string, unknown> = {}) {
    if (!draft) return;
    setSaving(true); setSaved(false); onError(null);
    try {
      const next = await send<BuddySettings>('/buddy/settings', 'PATCH', {
        enabled: draft.enabled, ai: draft.ai, autoAssist: draft.autoAssist, model: draft.model, captureSeconds: draft.captureSeconds,
        ...(key.trim() ? { apiKey: key.trim() } : {}), ...extra,
      });
      qc.setQueryData(['buddy-settings'], next);
      setKey(''); setSaved(true);
    } catch (e) { onError(errorText(e, 'Could not save the AI Buddy settings.')); } finally { setSaving(false); }
  }

  if (!draft) return <Card title="AI Buddy" icon={Sparkles}><Empty text="Loading…" /></Card>;
  const set = (patch: Partial<BuddySettings>) => { setDraft({ ...draft, ...patch }); setSaved(false); };
  const keyState = draft.apiKeySet ? 'An API key is saved on the relay.' : draft.envKeySet ? 'Using ANTHROPIC_API_KEY from the relay\'s environment.' : 'No API key yet.';

  return (
    <Card title="AI Buddy" icon={Sparkles}>
      <p className="mb-3 text-sm text-muted-foreground">
        IT support help during live sessions. When it is on, the helper's viewer reads the shared screen a moment after it changes (text recognition runs in the helper's browser),
        points out error messages, suggests matching knowledge base articles and, with Claude turned on, troubleshooting steps. Each session gets a summary in Session summaries.
        Tell the people you support that screen text is recorded, for example in your privacy notice.
      </p>
      <div className="grid gap-2 md:grid-cols-2">
        <Switch checked={draft.enabled} onChange={(v) => set({ enabled: v })} testId="switch-buddy-enabled" label="Turn on AI Buddy"
          hint="Shows the AI Buddy panel next to the screen in every helper's viewer and records screen text." />
        <Switch checked={draft.ai} onChange={(v) => set({ ai: v })} disabled={!draft.enabled} testId="switch-buddy-ai" label="Use Claude"
          hint="Troubleshooting steps on request, and written session summaries. Without it, AI Buddy uses the knowledge base and an automatic summary." />
        <Switch checked={draft.autoAssist} onChange={(v) => set({ autoAssist: v })} disabled={!draft.enabled || !draft.ai} testId="switch-buddy-auto" label="Suggest fixes automatically"
          hint="Ask Claude as soon as a screen shows an error, instead of waiting for the helper to press Suggest a fix." />
        <label className="rounded-xl border border-foreground/10 px-3 py-2.5">
          <span className="block text-sm font-semibold">Read the screen at most every</span>
          <span className="mt-1 flex items-center gap-2">
            <input type="number" min={3} max={120} value={draft.captureSeconds} onChange={(e) => set({ captureSeconds: Number(e.target.value) })} className={`${fieldCls} w-24`} />
            <span className="text-xs text-muted-foreground">seconds</span>
          </span>
        </label>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <label className="block">
          <span className="flex items-center gap-1.5 text-xs font-semibold"><KeyRound className="h-3.5 w-3.5" /> Anthropic API key</span>
          <input type="password" autoComplete="off" value={key} onChange={(e) => { setKey(e.target.value); setSaved(false); }}
            placeholder={draft.apiKeySet ? '•••••••• (saved, type to replace)' : 'sk-ant-…'} className={`${inputCls} mt-1`} data-testid="input-buddy-key" />
          <span className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">{keyState}
            {draft.apiKeySet && <button type="button" onClick={() => void save({ apiKey: '' })} className="font-semibold text-destructive">Remove saved key</button>}
          </span>
        </label>
        <label className="block">
          <span className="text-xs font-semibold">Claude model</span>
          <input value={draft.model} onChange={(e) => set({ model: e.target.value })} className={`${inputCls} mt-1`} />
          <span className="mt-1 block text-xs text-muted-foreground">Default claude-opus-5-5.</span>
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" disabled={saving} onClick={() => void save()} data-testid="button-save-buddy"
          className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50">{saving ? 'Saving…' : 'Save settings'}</button>
        {saved && <span role="status" className="text-xs text-muted-foreground">Saved.</span>}
        <span className={`text-xs font-semibold ${draft.aiReady ? 'text-emerald-700' : 'text-muted-foreground'}`}>
          {draft.aiReady ? 'Claude is ready.' : draft.enabled && draft.ai ? 'Claude needs an API key.' : ''}
        </span>
      </div>
    </Card>
  );
}

const emptyEntry = { title: '', symptoms: '', keywords: '', steps: '' };

function KnowledgeBaseCard({ onError }: { onError: (msg: string | null) => void }) {
  const qc = useQueryClient();
  const kb = useQuery({ queryKey: ['buddy-kb'], queryFn: () => api<{ entries: KbEntry[] }>('/buddy/kb') });
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<{ id?: string; title: string; symptoms: string; keywords: string; steps: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (kb.error) onError(errorText(kb.error, 'Could not load the knowledge base.')); }, [kb.error, onError]);

  const entries = kb.data?.entries ?? [];
  const needle = q.trim().toLowerCase();
  const shown = needle ? entries.filter((e) => [e.title, e.symptoms, e.steps, ...e.keywords].join(' ').toLowerCase().includes(needle)) : entries;

  async function save() {
    if (!editing) return;
    setSaving(true); setProblem(null);
    try {
      const body = { title: editing.title, symptoms: editing.symptoms, keywords: editing.keywords, steps: editing.steps };
      if (editing.id) await send(`/buddy/kb/${editing.id}`, 'PATCH', body);
      else await send('/buddy/kb', 'POST', body);
      await qc.invalidateQueries({ queryKey: ['buddy-kb'] });
      setEditing(null);
    } catch (e) { setProblem(errorText(e, 'Could not save the entry.')); } finally { setSaving(false); }
  }
  async function remove(e: KbEntry) {
    if (!window.confirm(`Delete "${e.title}" from the knowledge base?`)) return;
    try { await api(`/buddy/kb/${e.id}`, { method: 'DELETE' }); await qc.invalidateQueries({ queryKey: ['buddy-kb'] }); }
    catch (err) { onError(errorText(err, 'Could not delete the entry.')); }
  }

  return (
    <Card title={`Knowledge base (${entries.length})`} icon={BookOpen} action={
      <button type="button" onClick={() => { setProblem(null); setEditing({ ...emptyEntry }); }} data-testid="button-add-kb"
        className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground"><Plus className="h-4 w-4" /> Add entry</button>}>
      <p className="mb-2 text-sm text-muted-foreground">Known problems and their fixes. AI Buddy suggests an entry when its keywords or error codes appear on the shared screen, and gives matching entries to Claude.</p>
      <label className="relative block">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the knowledge base" aria-label="Search the knowledge base" className={`${inputCls} pl-9`} />
      </label>
      {shown.length === 0 ? <Empty text={entries.length ? 'No entry matches.' : 'No entries yet.'} /> : (
        <ul className="mt-2 divide-y divide-foreground/8">
          {shown.map((e) => (
            <li key={e.id} className="flex items-start gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{e.title}</p>
                {e.symptoms && <p className="line-clamp-2 text-xs text-muted-foreground">{e.symptoms}</p>}
                <p className="mt-1 flex flex-wrap gap-1">{e.keywords.slice(0, 8).map((k) => <span key={k} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{k}</span>)}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {e.source === 'builtin' ? 'Starter entry' : e.source === 'session' ? `From a session${e.createdBy ? ` by ${e.createdBy}` : ''}` : `Added${e.createdBy ? ` by ${e.createdBy}` : ''}`} · suggested {e.uses} time{e.uses === 1 ? '' : 's'}
                </p>
              </div>
              <button type="button" aria-label={`Edit ${e.title}`} onClick={() => { setProblem(null); setEditing({ id: e.id, title: e.title, symptoms: e.symptoms, keywords: e.keywords.join(', '), steps: e.steps }); }}
                className="rounded-lg p-1.5 hover:bg-muted"><Pencil className="h-4 w-4" /></button>
              <button type="button" aria-label={`Delete ${e.title}`} onClick={() => void remove(e)} className="rounded-lg p-1.5 text-destructive hover:bg-destructive/10"><Trash2 className="h-4 w-4" /></button>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <Dialog open onOpenChange={(o) => { if (!o) setEditing(null); }}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editing.id ? 'Edit entry' : 'Add an entry'}</DialogTitle>
              <DialogDescription>Describe a problem, the words or codes that show it on screen, and the fix.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <label className="block"><span className="text-xs font-semibold">Title</span>
                <input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} className={`${inputCls} mt-1`} data-testid="input-kb-title" /></label>
              <label className="block"><span className="text-xs font-semibold">Symptoms</span>
                <textarea value={editing.symptoms} onChange={(e) => setEditing({ ...editing, symptoms: e.target.value })} rows={2} className={`${inputCls} mt-1`} /></label>
              <label className="block"><span className="text-xs font-semibold">Keywords and error codes (comma separated)</span>
                <input value={editing.keywords} onChange={(e) => setEditing({ ...editing, keywords: e.target.value })} placeholder="0x80070005, access is denied" className={`${inputCls} mt-1`} data-testid="input-kb-keywords" /></label>
              <label className="block"><span className="text-xs font-semibold">Fix steps (one per line)</span>
                <textarea value={editing.steps} onChange={(e) => setEditing({ ...editing, steps: e.target.value })} rows={6} className={`${inputCls} mt-1`} data-testid="input-kb-steps" /></label>
              {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
            </div>
            <DialogFooter>
              <button type="button" onClick={() => setEditing(null)} className="rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-muted">Cancel</button>
              <button type="button" disabled={saving} onClick={() => void save()} data-testid="button-save-kb" className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}

