import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, BookOpen, Camera, ClipboardList, Eye, Loader2, Radio, Search, Sparkles, TriangleAlert, Upload, X,
} from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { errorText } from '@/lib/auth';

// Admin console → Inspect Buddy.
// A control-room view of every ongoing remote session, with a per-session
// "Question Watcher": the AI engine watches the screen (OCR of live frames),
// detects the start of an exam, captures each question in order, researches
// the answer in the document repository first and online as a fallback, and
// asks the admin to accept or correct the recommendation before it is kept.
// When the exam finishes, a reading material (questions only) and a Q&A
// document are auto-stored in the repository.

type Mode = 'attended' | 'unattended' | 'link';

const MODE_LABEL: Record<Mode, string> = { attended: 'Attended', unattended: 'Unattended', link: 'Remote URL' };

export type WatcherSession = {
  sessionId: string; pcName: string; mode: Mode; company: string; operator: string; startedAt: number;
  viewers: number; captureCount: number; lastSeenText: string;
};

export type QuestionState = 'pending' | 'researching' | 'recommended' | 'accepted' | 'corrected';
export type SourceKind = 'repo' | 'online' | 'ai';

export type WatcherQuestion = {
  index: number; at: number; text: string; screenshotUrl: string | null;
  state: QuestionState; answer: string; explanation: string; confidence: number;
  source: SourceKind; sources: string[]; correctedAnswer: string;
};

export type WatcherStatus = 'off' | 'watching' | 'exam-detected' | 'completed';

export type WatcherView = {
  sessionId: string; enabled: boolean; status: WatcherStatus; startedAt: number | null;
  completedAt: number | null; questions: WatcherQuestion[]; documentsStored: string[]; error: string | null;
  lastSeenText?: string;
};

export type RepoDoc = {
  id: string; title: string; category: string; filename: string; bytes: number;
  uploadedBy: string; uploadedAt: number; origin: 'upload' | 'auto';
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

const timeOnly = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const dateTime = (ms: number) => new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function fmtDuration(ms: number) {
  const m = Math.round(ms / 60_000);
  if (m < 1) return '< 1 min';
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

const STATUS_META: Record<WatcherStatus, { label: string; cls: string }> = {
  off: { label: 'Watcher off', cls: 'bg-muted text-muted-foreground' },
  watching: { label: 'Watching screen', cls: 'bg-sky-500/15 text-sky-700' },
  'exam-detected': { label: 'Exam detected — capturing', cls: 'bg-violet-500/15 text-violet-700' },
  completed: { label: 'Completed — stored in repo', cls: 'bg-emerald-500/15 text-emerald-700' },
};

const QSTATE_META: Record<QuestionState, { label: string; cls: string }> = {
  pending: { label: 'Captured', cls: 'bg-muted text-muted-foreground' },
  researching: { label: 'Researching…', cls: 'bg-sky-500/15 text-sky-700' },
  recommended: { label: 'Needs review', cls: 'bg-amber-500/15 text-amber-700' },
  accepted: { label: 'Accepted', cls: 'bg-emerald-500/15 text-emerald-700' },
  corrected: { label: 'Corrected by admin', cls: 'bg-primary/12 text-primary' },
};

const SOURCE_LABEL: Record<SourceKind, string> = { repo: 'Document repository', online: 'Online research', ai: 'AI knowledge' };

// --- Control room: list of ongoing sessions with watcher controls ---

export function InspectBuddyPanel({ onError }: { onError: (msg: string | null) => void }) {
  const qc = useQueryClient();
  const [view, setView] = useState<'list' | 'repo'>('list');
  const [openSession, setOpenSession] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const list = useQuery({ queryKey: ['buddy-sessions'], queryFn: () => api<{ sessions: WatcherSession[] }>('/buddy/sessions'), refetchInterval: 10_000 });
  const watchers = useQuery({
    queryKey: ['buddy-watchers'],
    queryFn: async () => {
      const { sessions } = await api<{ sessions: WatcherSession[] }>('/buddy/sessions');
      const states = await Promise.all(sessions.map((s) =>
        api<WatcherView>(`/buddy/watchers/${encodeURIComponent(s.sessionId)}`).catch(() => null)));
      const map: Record<string, WatcherView | null> = {};
      sessions.forEach((s, i) => { map[s.sessionId] = states[i]; });
      return { sessions, map };
    },
    refetchInterval: 5_000,
  });

  useEffect(() => { if (list.error) onError(errorText(list.error, 'Could not load the ongoing sessions.')); }, [list.error, onError]);

  const rows = watchers.data?.sessions ?? [];
  const map = watchers.data?.map ?? {};
  const needle = q.trim().toLowerCase();
  const filtered = useMemo(() => rows.filter((r) => !needle ||
    [r.pcName, r.company, r.operator].join(' ').toLowerCase().includes(needle)), [rows, needle]);

  const liveWatched = rows.filter((r) => (map[r.sessionId]?.enabled ?? false)).length;
  const exams = rows.filter((r) => { const w = map[r.sessionId]; return w && w.status !== 'off' && w.status !== 'watching'; }).length;
  const pendingReview = rows.reduce((t, r) => t + (map[r.sessionId]?.questions.filter((x) => x.state === 'recommended').length ?? 0), 0);

  async function toggle(sessionId: string, enable: boolean) {
    try {
      await send(`/buddy/watchers/${encodeURIComponent(sessionId)}`, enable ? 'POST' : 'DELETE');
      await qc.invalidateQueries({ queryKey: ['buddy-watchers'] });
    } catch (e) { onError(errorText(e, 'Could not change the watcher.')); }
  }

  if (view === 'repo') return <RepoPanel onBack={() => setView('list')} onError={onError} />;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-card/90 p-4 shadow-[0_10px_30px_-24px_hsl(200_32%_13%/0.5)] md:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-bold"><Radio className="h-4.5 w-4.5 text-primary" /> Control room — ongoing sessions</h2>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setView('repo')} data-testid="button-open-repo"
              className="inline-flex items-center gap-1.5 rounded-xl border border-foreground/15 px-3 py-1.5 text-xs font-semibold hover:bg-muted">
              <BookOpen className="h-3.5 w-3.5" /> Document repository
            </button>
            <button type="button" onClick={() => void qc.invalidateQueries({ queryKey: ['buddy-watchers'] })}
              className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">
              <RefreshLike /> Refresh
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Ongoing sessions" value={rows.length} />
          <Stat label="Watchers enabled" value={liveWatched} />
          <Stat label="Exams in progress" value={exams} />
          <Stat label="Awaiting your review" value={pendingReview} />
        </div>

        <label className="relative mt-3 block min-w-[200px]">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search PC, company or helper" aria-label="Search sessions"
            className="w-full rounded-xl border border-foreground/15 bg-background px-3 py-2 pl-9 text-sm outline-none focus:border-primary" data-testid="input-inspect-search" />
        </label>

        {watchers.isPending ? <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p> : filtered.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{rows.length ? 'No session matches this search.' : 'No ongoing sessions right now. Sessions appear here live as soon as a helper connects.'}</p>
        ) : (
          <ul className="mt-3 divide-y divide-foreground/8">
            {filtered.map((r) => {
              const w = map[r.sessionId];
              const st: WatcherStatus = w?.enabled ? w.status : 'off';
              const meta = STATUS_META[st];
              const qs = w?.questions ?? [];
              const reviewed = qs.filter((x) => x.state === 'accepted' || x.state === 'corrected').length;
              return (
                <li key={r.sessionId} className="px-1 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{r.pcName || 'Windows PC'}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{MODE_LABEL[r.mode]}</span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700"><Eye className="h-3 w-3" /> Live · {r.viewers} viewer{r.viewers === 1 ? '' : 's'}</span>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${meta.cls}`} data-testid={`watcher-status-${r.sessionId}`}>{meta.label}</span>
                    {qs.some((x) => x.state === 'recommended') && <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-700"><TriangleAlert className="h-3 w-3" /> {qs.filter((x) => x.state === 'recommended').length} to review</span>}
                    <span className="ml-auto text-xs text-muted-foreground">since {timeOnly(r.startedAt)} · {fmtDuration(Date.now() - r.startedAt)}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{r.company || 'Unknown company'}{r.operator && r.operator !== r.company ? ` · ${r.operator}` : ''} · {r.captureCount} screens read</p>
                  {st !== 'off' && (
                    <p className="mt-1 line-clamp-1 text-xs italic text-muted-foreground">Last seen: “{(w?.lastSeenText ?? r.lastSeenText ?? '').slice(0, 140) || '—'}”</p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <label className={`inline-flex items-center gap-2 rounded-xl border border-foreground/15 px-3 py-1.5 text-xs font-semibold ${st === 'off' ? '' : 'border-primary/40 bg-primary/5'}`}>
                      <input type="checkbox" checked={st !== 'off'} onChange={(e) => void toggle(r.sessionId, e.target.checked)} className="h-4 w-4 accent-[hsl(var(--primary))]" data-testid={`toggle-watcher-${r.sessionId}`} />
                      Question Watcher
                    </label>
                    {st !== 'off' && (
                      <>
                        <span className="text-xs text-muted-foreground">{qs.length} question{qs.length === 1 ? '' : 's'} captured · {reviewed} reviewed</span>
                        <button type="button" onClick={() => setOpenSession(r.sessionId)} data-testid={`button-open-watcher-${r.sessionId}`}
                          className="inline-flex items-center gap-1 rounded-xl bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">
                          <ClipboardList className="h-3.5 w-3.5" /> Open watcher
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted-foreground">Enable the Question Watcher on any session: the AI engine then reads every screen in parallel, detects when an exam starts, captures each question in order, researches the answer in the document repository first (online research as fallback) and waits for you to accept or correct it.</p>
      </div>

      {openSession && <WatcherDetail sessionId={openSession} onClose={() => setOpenSession(null)} onError={onError} />}
    </div>
  );
}

function RefreshLike() { return <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" /></svg>; }

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-foreground/10 bg-background/60 px-3 py-2">
      <p className="text-[11px] font-semibold text-muted-foreground">{label}</p>
      <p className="text-xl font-extrabold">{value}</p>
    </div>
  );
}

// --- Per-session watcher detail: ordered questions, review workflow ---

function WatcherDetail({ sessionId, onClose, onError }: { sessionId: string; onClose: () => void; onError: (msg: string | null) => void }) {
  const qc = useQueryClient();
  const w = useQuery({
    queryKey: ['buddy-watcher', sessionId],
    queryFn: () => api<WatcherView & { lastSeenText?: string }>(`/buddy/watchers/${encodeURIComponent(sessionId)}`),
    refetchInterval: 4_000,
  });
  const [busy, setBusy] = useState<number | null>(null);
  const [correcting, setCorrecting] = useState<WatcherQuestion | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function decide(index: number, action: 'accept' | 'correct', answer?: string) {
    setBusy(index); setMsg(null);
    try {
      await send(`/buddy/watchers/${encodeURIComponent(sessionId)}/questions/${index}/${action}`, 'POST', answer ? { answer } : undefined);
      setMsg(action === 'accept' ? 'Answer accepted.' : 'Correction saved.');
      await qc.invalidateQueries({ queryKey: ['buddy-watcher', sessionId] });
      await qc.invalidateQueries({ queryKey: ['buddy-watchers'] });
    } catch (e) { onError(errorText(e, 'That decision did not go through.')); } finally { setBusy(null); }
  }

  const data = w.data;
  const questions = [...(data?.questions ?? [])].sort((a, b) => a.index - b.index);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92dvh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Camera className="h-4.5 w-4.5 text-primary" /> Question Watcher</DialogTitle>
          <DialogDescription>
            Session {sessionId.slice(0, 8)} · {data ? STATUS_META[data.status].label : 'loading…'}
            {data?.startedAt ? ` · started ${dateTime(data.startedAt)}` : ''}
            {data?.completedAt ? ` · finished ${dateTime(data.completedAt)}` : ''}
          </DialogDescription>
        </DialogHeader>

        {w.isPending ? <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p> : !data ? (
          <p className="text-sm text-muted-foreground">The watcher could not be loaded.</p>
        ) : (
          <div className="space-y-4">
            {data.error && <p className="rounded-xl bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-700">{data.error}</p>}

            {data.questions.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                {data.status === 'watching' ? 'Watching the screen… waiting for an exam to start.' : 'No question captured yet.'}
              </p>
            ) : (
              <ol className="space-y-3">
                {questions.map((x) => (
                  <li key={x.index} className="rounded-xl border border-foreground/12 bg-background/60 p-3" data-testid={`question-${x.index}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-foreground/8 px-2 py-0.5 text-[11px] font-bold">Q{x.index}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${QSTATE_META[x.state].cls}`}>{QSTATE_META[x.state].label}</span>
                      <span className="text-[11px] text-muted-foreground">{timeOnly(x.at)}</span>
                      {x.screenshotUrl && <a href={x.screenshotUrl} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"><Camera className="h-3 w-3" /> Screenshot</a>}
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm font-medium">{x.text}</p>

                    {(x.state === 'recommended' || x.state === 'accepted' || x.state === 'corrected') && (
                      <div className="mt-2 rounded-lg border border-foreground/10 bg-card px-3 py-2 text-sm">
                        <p className="flex flex-wrap items-center gap-2">
                          <Sparkles className="h-3.5 w-3.5 text-primary" />
                          <span className="font-bold">{x.state === 'corrected' ? x.correctedAnswer : x.answer}</span>
                          <span className="ml-auto text-[11px] font-semibold text-muted-foreground">{SOURCE_LABEL[x.source]} · {Math.round(x.confidence * 100)}%</span>
                        </p>
                        {x.explanation && <p className="mt-1 text-xs text-muted-foreground">{x.explanation}</p>}
                        {x.sources.length > 0 && <p className="mt-1 text-[11px] text-muted-foreground">Sources: {x.sources.join(' · ')}</p>}
                      </div>
                    )}

                    {x.state === 'recommended' && (
                      <div className="mt-2 flex gap-2">
                        <button type="button" disabled={busy === x.index} data-testid={`button-accept-${x.index}`}
                          onClick={() => void decide(x.index, 'accept')}
                          className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Accept answer</button>
                        <button type="button" disabled={busy === x.index} data-testid={`button-correct-${x.index}`}
                          onClick={() => setCorrecting(x)}
                          className="inline-flex items-center gap-1 rounded-xl border border-foreground/15 px-3 py-1.5 text-xs font-semibold hover:bg-muted disabled:opacity-50"><X className="h-3 w-3" /> Correct it</button>
                      </div>
                    )}
                    {x.state === 'researching' && <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Searching the repository, then online…</p>}
                  </li>
                ))}
              </ol>
            )}

            {data.documentsStored.length > 0 && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
                <p className="font-bold text-emerald-800">Auto-stored in the repository</p>
                <ul className="mt-1 space-y-0.5 text-xs text-emerald-800/90">{data.documentsStored.map((d) => <li key={d}>• {d}</li>)}</ul>
              </div>
            )}
            {msg && <p role="status" className="text-xs text-muted-foreground">{msg}</p>}
          </div>
        )}
        {correcting && <CorrectDialog question={correcting} onClose={() => setCorrecting(null)} onSubmit={(answer) => { setCorrecting(null); void decide(correcting.index, 'correct', answer); }} />}
      </DialogContent>
    </Dialog>
  );
}

function CorrectDialog({ question, onClose, onSubmit }: { question: WatcherQuestion; onClose: () => void; onSubmit: (answer: string) => void }) {
  const [answer, setAnswer] = useState(question.correctedAnswer || question.answer);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Correct the answer to Q{question.index}</DialogTitle>
          <DialogDescription className="line-clamp-3">{question.text}</DialogDescription></DialogHeader>
        <textarea autoFocus value={answer} onChange={(e) => setAnswer(e.target.value)} rows={4}
          className="w-full rounded-xl border border-foreground/15 bg-background px-3 py-2 text-sm outline-none focus:border-primary" data-testid="input-correction" />
        <DialogFooter>
          <button type="button" onClick={onClose} className="rounded-xl border border-foreground/15 px-3 py-1.5 text-sm font-semibold hover:bg-muted">Cancel</button>
          <button type="button" disabled={!answer.trim()} onClick={() => onSubmit(answer.trim())} data-testid="button-save-correction"
            className="rounded-xl bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-50">Save correction</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Document repository: categorized uploads + auto-stored materials ---

function RepoPanel({ onBack, onError }: { onBack: () => void; onError: (msg: string | null) => void }) {
  const qc = useQueryClient();
  const docs = useQuery({ queryKey: ['buddy-repo'], queryFn: () => api<{ documents: RepoDoc[]; categories: string[] }>('/buddy/repo/documents') });
  const [category, setCategory] = useState('General');
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [uploading, setUploading] = useState(false);
  const [filter, setFilter] = useState('all');
  const [msg, setMsg] = useState<string | null>(null);

  async function upload() {
    if (!file) return;
    setUploading(true); setMsg(null);
    try {
      const buf = await file.arrayBuffer();
      await api('/buddy/repo/documents', { method: 'POST', body: JSON.stringify({
        category: category.trim() || 'General', title: title.trim() || file.name, filename: file.name, dataBase64: toBase64(buf),
      }) });
      setMsg(`Uploaded “${file.name}” to ${category}.`);
      setFile(null); setTitle('');
      await qc.invalidateQueries({ queryKey: ['buddy-repo'] });
    } catch (e) { onError(errorText(e, 'Upload failed.')); } finally { setUploading(false); }
  }

  const all = docs.data?.documents ?? [];
  const cats = docs.data?.categories ?? [];
  const shown = filter === 'all' ? all : all.filter((d) => d.category === filter);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-card/90 p-4 md:p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-bold"><BookOpen className="h-4.5 w-4.5 text-primary" /> Document repository</h2>
          <button type="button" onClick={onBack} data-testid="button-repo-back" className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" /> Back to control room</button>
        </div>

        <div className="grid gap-2 sm:grid-cols-[1fr_180px_1fr_auto] sm:items-end">
          <label className="block text-xs font-semibold">Category
            <input list="repo-categories" value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1 w-full rounded-xl border border-foreground/15 bg-background px-3 py-2 text-sm outline-none focus:border-primary" data-testid="input-repo-category" />
            <datalist id="repo-categories">{cats.map((c) => <option key={c} value={c} />)}</datalist>
          </label>
          <label className="block text-xs font-semibold">Title (optional)
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded-xl border border-foreground/15 bg-background px-3 py-2 text-sm outline-none focus:border-primary" data-testid="input-repo-title" />
          </label>
          <label className="block text-xs font-semibold">File
            <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="mt-1 w-full text-xs" data-testid="input-repo-file" />
          </label>
          <button type="button" disabled={!file || uploading} onClick={() => void upload()} data-testid="button-repo-upload"
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Upload
          </button>
        </div>
        {msg && <p role="status" className="mt-2 text-xs text-muted-foreground">{msg}</p>}
        <p className="mt-2 text-xs text-muted-foreground">The Question Watcher searches these documents first when answering an exam question. Completed exams are also stored here automatically (“Reading material” and “Questions & answers”).</p>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {['all', ...cats].map((c) => (
            <button key={c} type="button" onClick={() => setFilter(c)} data-testid={`repo-filter-${c}`}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${filter === c ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>
              {c === 'all' ? 'All categories' : c}
            </button>
          ))}
        </div>

        {docs.isPending ? <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p> : shown.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No documents in this category yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-foreground/8">
            {shown.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm" data-testid={`repo-doc-${d.id}`}>
                <span className="rounded-full bg-primary/12 px-2 py-0.5 text-[11px] font-semibold text-primary">{d.category}</span>
                <span className="font-semibold">{d.title}</span>
                {d.origin === 'auto' && <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] font-semibold text-violet-700"><Sparkles className="h-3 w-3" /> Auto-stored</span>}
                <span className="ml-auto text-xs text-muted-foreground">{d.filename} · {(d.bytes / 1024).toFixed(0)} KB · {dateTime(d.uploadedAt)} · {d.uploadedBy}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function toBase64(buf: ArrayBuffer) {
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
