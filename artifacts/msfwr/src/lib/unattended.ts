// Saved unattended PCs and the history of their Initiate requests. Access
// codes are password-equivalent, so everything here stays in this browser's
// localStorage and is never sent anywhere except to the relay as a lookup.

export const HEX = /^[A-F0-9]{12}$/;

export type SavedPC = {
  code: string;
  // The PC name the host reports (Windows computer name).
  name: string;
  // An optional label IT gives the PC in this browser.
  label?: string;
  addedAt: number;
  lastRequestAt?: number;
  lastConnectedAt?: number;
};

export type RequestStatus = 'waiting' | 'accepted' | 'missed' | 'dismissed';

export type RequestEntry = {
  id: string;
  code: string;
  name: string;
  at: number;
  // Set when the relay stopped reporting the request.
  closedAt?: number;
  status: RequestStatus;
  // True while the relay still reports this request.
  open: boolean;
};

const PCS_KEY = 'Msfwr.pcs';
const LEGACY_KEY = 'Msfwr.savedPCs';
const REQUESTS_KEY = 'Msfwr.requests';
export const MAX_PCS = 50;
const MAX_REQUESTS = 200;

function read(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private window or full */ }
}

const text = (v: unknown, max = 40) => (typeof v === 'string' ? v.replace(/[^\w .-]/g, '').slice(0, max) : '');
const time = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);

export function loadPCs(): SavedPC[] {
  const raw = read(PCS_KEY);
  const now = Date.now();
  if (!Array.isArray(raw)) {
    // Migrate the plain code list saved by the earlier version of this page.
    const legacy = read(LEGACY_KEY);
    if (Array.isArray(legacy)) {
      const pcs = legacy.filter((c): c is string => typeof c === 'string' && HEX.test(c))
        .slice(0, MAX_PCS).map((code) => ({ code, name: '', addedAt: now }));
      write(PCS_KEY, pcs);
      return pcs;
    }
    return [];
  }
  const seen = new Set<string>();
  const pcs: SavedPC[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (typeof r.code !== 'string' || !HEX.test(r.code) || seen.has(r.code)) continue;
    seen.add(r.code);
    pcs.push({
      code: r.code,
      name: text(r.name),
      label: text(r.label, 48) || undefined,
      addedAt: time(r.addedAt) ?? now,
      lastRequestAt: time(r.lastRequestAt),
      lastConnectedAt: time(r.lastConnectedAt),
    });
    if (pcs.length >= MAX_PCS) break;
  }
  return pcs;
}

export function storePCs(pcs: SavedPC[]) {
  write(PCS_KEY, pcs.slice(0, MAX_PCS));
}

// A company's saved roster of the PCs pointed to its RA ID. Unlike SavedPC it
// holds no access code — a company connects to these by their relay id — so it
// is only a convenience list that keeps a PC visible (to reconnect to) even
// while it is offline. Stored per browser.
export type SavedRaPc = {
  id: string;
  name: string;
  savedAt: number;
};

const RA_PCS_KEY = 'Msfwr.raPcs';
export const MAX_RA_PCS = 100;

export function loadSavedRaPcs(): SavedRaPc[] {
  const raw = read(RA_PCS_KEY);
  if (!Array.isArray(raw)) return [];
  const now = Date.now();
  const seen = new Set<string>();
  const out: SavedRaPc[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== 'string' || !r.id || r.id.length > 64 || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({ id: r.id, name: text(r.name), savedAt: time(r.savedAt) ?? now });
    if (out.length >= MAX_RA_PCS) break;
  }
  return out;
}

export function storeSavedRaPcs(list: SavedRaPc[]) {
  write(RA_PCS_KEY, list.slice(0, MAX_RA_PCS));
}

const STATUSES: RequestStatus[] = ['waiting', 'accepted', 'missed', 'dismissed'];

export function loadRequests(): RequestEntry[] {
  const raw = read(REQUESTS_KEY);
  if (!Array.isArray(raw)) return [];
  const out: RequestEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const at = time(r.at);
    if (typeof r.id !== 'string' || typeof r.code !== 'string' || !HEX.test(r.code) || !at) continue;
    let status = STATUSES.includes(r.status as RequestStatus) ? (r.status as RequestStatus) : 'missed';
    // A request left open when the page closed is over by now unless the
    // next poll reports it again (which starts a fresh entry).
    if (status === 'waiting') status = 'missed';
    out.push({ id: r.id.slice(0, 40), code: r.code, name: text(r.name), at, closedAt: time(r.closedAt) ?? at, status, open: false });
    if (out.length >= MAX_REQUESTS) break;
  }
  return out;
}

export function storeRequests(list: RequestEntry[]) {
  write(REQUESTS_KEY, list.slice(0, MAX_REQUESTS));
}

type Call = { code: string; name: string };

// mergeCalls folds one poll result into the request history. New requests
// are added to the front; requests the relay no longer reports are closed
// (missed unless they were accepted or dismissed). It returns the new list
// and the entries that are new since the last poll.
export function mergeCalls(list: RequestEntry[], calls: Call[], now = Date.now()) {
  const active = new Map(calls.map((c) => [c.code, c]));
  const fresh: RequestEntry[] = [];
  let changed = false;
  const next = list.map((r) => {
    if (!r.open) return r;
    if (active.has(r.code)) {
      active.delete(r.code);
      return r;
    }
    changed = true;
    return { ...r, open: false, closedAt: now, status: r.status === 'waiting' ? 'missed' as const : r.status };
  });
  for (const c of active.values()) {
    fresh.push({ id: `${now.toString(36)}-${c.code}`, code: c.code, name: c.name, at: now, status: 'waiting', open: true });
  }
  if (!fresh.length && !changed) return { list, fresh };
  return { list: [...fresh, ...next].slice(0, MAX_REQUESTS), fresh };
}

export function setRequestStatus(list: RequestEntry[], code: string, status: RequestStatus, now = Date.now()) {
  return list.map((r) => (r.open && r.code === code && r.status === 'waiting'
    ? { ...r, status, closedAt: status === 'accepted' ? now : r.closedAt }
    : r));
}

export function relativeTime(at: number | undefined, now = Date.now()) {
  if (!at) return 'never';
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = new Date(at);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' +
    d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
