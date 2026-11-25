import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { MsfwrInput } from "@workspace/api-zod";

const inviteTTL = 3 * 60_000;
const sessionTTL = 30 * 60_000;
const peerTTL = 20_000;
// How long a host's "Initiate" request stays open.
export const callTTL = 2 * 60_000;
// Remote access links created from the client app are valid for 24 hours by
// default, and for any of linkTTLs hours when the PC asks for it.
export const linkTTL = 24 * 60 * 60_000;
export const linkTTLs = [1, 2, 4, 5, 8, 12, 24, 48, 72, 120];
// Wrong access codes allowed on one link before it locks for lockMs.
export const linkTries = 8;
// People who can be connected through one PC's remote access URL at once.
export const linkViewers = 10;
const lockMs = 15 * 60_000;
// Opening a remote access link also needs a four-digit Access PIN issued by a
// company. Each signed-in company sees its own current PIN, which changes
// every companyPinTTL until it is used. The first company PIN entered on a
// link authors (claims) that link for that company: from then on only that
// same PIN opens it, until the link expires, and no other company can claim
// it. Wrong PINs lock the link for lockMs after accessPinTries, and after
// accessPinLimit wrong PINs in all the link stops working until the PC creates
// a new one.
export const companyPinTTL = 3 * 60_000;
export const accessPinTries = 5;
export const accessPinLimit = 20;
const maxRecords = 400;

// Unattended (pre-approved) hosts keep a long random key on the PC. The
// public access code is derived from it, so only the holder of the key can
// register under that code, and the relay does not need to store anything.
export function standingCode(key: string) {
  return createHash("sha256").update("msfwr-standing:" + key).digest("hex").slice(0, 12).toUpperCase();
}

// A link's public code depends on the PC's key as well as the link id, so
// only that PC can restore its link after a relay restart. Link codes start
// with "L" so they never collide with access codes (hex only).
export function linkCode(key: string, id: string) {
  return ("L" + createHash("sha256").update("msfwr-link:" + key + ":" + id).digest("hex").slice(0, 11)).toUpperCase();
}

// A stable id for a PC that the portal can show without revealing its
// access code (which would let anyone connect).
export function pcId(code: string) {
  return createHash("sha256").update("msfwr-pc:" + code).digest("base64url").slice(0, 16);
}

// RA IDs are six digits, shown as RA-123456.
export function normalizeRaId(value: string | undefined) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return /^\d{6}$/.test(digits) ? digits : undefined;
}
export const formatRaId = (raId: string) => `RA-${raId}`;

// The signed-in portal user (a company or an admin) connected as viewer.
export type Operator = { id: string; name: string; raId: string };

// What the store reports to the billing layer when a live session ends, for
// the session history and quota counting. The accountId is resolved by the
// caller from the RA ID.
export type EndedSession = {
  // The live session's internal id.
  sessionId?: string;
  raId: string;
  // The link code, for sessions opened through a remote access URL.
  link?: string;
  pcName: string;
  mode: "attended" | "unattended" | "link";
  operator: string;
  operatorId?: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  viewers: number;
};

// Optional lifecycle hooks. They are best-effort and must never throw into
// the session store; the store swallows their errors. onLive fires once when
// a session first becomes live (for quota counting); onEnd fires once when a
// live session ends (for history).
export type StoreHooks = {
  onLive?: (session: Session) => void;
  onEnd?: (ended: EndedSession) => void;
  // Remote access URL lifecycle, for the persistent URL register.
  // Fired when a PC creates a URL, and again when it re-sends one the relay
  // did not know (after a restart), so the register always has the URL.
  onLinkCreated?: (link: LinkInfo) => void;
  onLinkClaimed?: (code: string, claim: LinkClaim, link: LinkInfo) => void;
  onLinkRevoked?: (code: string, at: number) => void;
};

// The company that authored (claimed) a remote access URL with its PIN.
// clientIp and clientAgent describe the browser that entered the PIN.
export type LinkClaim = {accountId: string; company: string; raId: string; pin: string; at: number; clientIp?: string; clientAgent?: string};
export type LinkInfo = {code: string; name: string; ra?: string; createdAt: number; expiresAt: number; ttlHours: number};
// A signed-in company, as far as PIN issuing is concerned.
export type CompanyRef = {id: string; name: string; raId: string};

export type Session = {
  // Internal id, used by the admin console; never the access code.
  id: string;
  code: string;
  host: string;
  // Viewer tokens and when each was last seen. A session through a remote
  // access URL can have several viewers at once; any other has at most one.
  viewers: Map<string, number>;
  operator?: Operator;
  verification?: string;
  state: "waiting" | "pending" | "live";
  preapproved: boolean;
  // The RA ID this unattended PC's remote access points to.
  ra?: string;
  // Set when the viewer came in through a shared remote access link.
  via?: "link";
  linkCode?: string;
  // The PC name an unattended host reports.
  name?: string;
  // Set while the host's Initiate request is open.
  call?: { name: string; until: number; ra?: string; record: string };
  createdAt: number;
  liveAt?: number;
  // The most viewers connected at once while the session was live, for the
  // ended-session record.
  peakViewers?: number;
  // Set once an ended live session has been recorded, so a later sweep that
  // also calls end() does not record it twice.
  recorded?: boolean;
  expires: number;
  hostSeen: number;
  // The latest full screen (a keyframe) and its sequence number.
  frame?: Buffer;
  keySequence?: number;
  // Changed regions sent since that keyframe, in order. A viewer composes
  // the keyframe and these to get the current screen.
  patches?: FramePatch[];
  patchBytes?: number;
  // Set when the patch log is full; the host is asked for a new keyframe.
  wantKey?: boolean;
  // The sequence number of the newest keyframe or patch.
  sequence: number;
  lastFrame: number;
  input: { item: MsfwrInput; time: number }[];
  // Hosts and viewers that number their requests (X-Msfwr-Seq) may have
  // several in flight; these put them back in order.
  hostOrder?: Reorder<FrameUpdate[] | Buffer | undefined>;
  inputOrder?: Map<string, Reorder<MsfwrInput[]>>; // by viewer
  // The picture quality a viewer asked for; the host reads it from ticks.
  quality?: ViewQuality;
  // Long-polling requests waiting for a frame, input or the session's end.
  watchers?: Set<() => void>;
  closed?: boolean;
};

// One screen update: a keyframe (the whole screen) or a patch (a JPEG of the
// region at x, y).
export type FrameUpdate = { key: boolean; x: number; y: number; data: Buffer };
export type FramePatch = FrameUpdate & { sequence: number };

// Bounds the patch log of one session. Past it, patches are ignored until the
// host sends a new keyframe (the tick reply asks for one).
// Native-resolution screens make larger patches, so the log is sized for them.
export const patchLogBytes = 12 * 1024 * 1024;
export const patchLogCount = 1200;

// Picture quality a viewer can ask the host for: "sharp" keeps the native
// resolution and high JPEG quality for reading text, "balanced" caps the
// screen at 1920 pixels wide, "fast" at 1280 with lower quality for slow links.
export const viewQualities = ["sharp", "balanced", "fast"] as const;
export type ViewQuality = typeof viewQualities[number];

// Puts numbered requests from one sender back in order. A request that
// arrives early waits (at most reorderWait ms, or until reorderMax are
// waiting) for the ones before it; past that the gap is skipped.
// Senders number their requests from 1.
export type Reorder<T> = { next?: number; pending: Map<number, { item: T; at: number }> };
export const reorderWait = 1000;
const reorderMax = 8;
export function reorder<T>(r: Reorder<T>, seq: number, item: T, now: number, resets = false) {
  const ready: T[] = [];
  let skipped = false;
  if (r.next === undefined) r.next = 1;
  if (seq < r.next) return {ready, late: true, skipped};
  if (resets && seq > r.next) {
    // A keyframe replaces everything before it: no need to wait.
    for (const k of [...r.pending.keys()]) if (k < seq) r.pending.delete(k);
    r.next = seq;
  }
  r.pending.set(seq, {item, at: now});
  const drain = () => {
    while (r.pending.has(r.next!)) {
      ready.push(r.pending.get(r.next!)!.item);
      r.pending.delete(r.next!);
      r.next! += 1;
    }
  };
  drain();
  if (r.pending.size) {
    const oldest = Math.min(...[...r.pending.values()].map((p) => p.at));
    if (r.pending.size >= reorderMax || now - oldest > reorderWait) {
      r.next = Math.min(...r.pending.keys());
      skipped = true;
      drain();
    }
  }
  return {ready, late: false, skipped};
}

// Records of the streaming frame channel (/frame?v=3) besides keyframes and
// patches: kind 2 carries the session state as text, kind 3 says the stream
// ends now and the viewer should open the next one. Same 13-byte head as
// encodeFrames, with sequence 0.
export function streamRecord(kind: 2 | 3, text = "") {
  const data = Buffer.from(text, "utf8");
  const head = Buffer.alloc(13);
  head.writeUInt8(kind, 4);
  head.writeUInt32BE(data.length, 9);
  return Buffer.concat([head, data]);
}

// Encodes updates for a viewer: for each, the sequence (u32), kind (u8, 0 for
// a keyframe, 1 for a patch), x and y (u16), the JPEG length (u32) and the
// JPEG. Big-endian.
export function encodeFrames(items: FramePatch[]) {
  const parts: Buffer[] = [];
  for (const item of items) {
    const head = Buffer.alloc(13);
    head.writeUInt32BE(item.sequence, 0);
    head.writeUInt8(item.key ? 0 : 1, 4);
    head.writeUInt16BE(item.x, 5);
    head.writeUInt16BE(item.y, 7);
    head.writeUInt32BE(item.data.length, 9);
    parts.push(head, item.data);
  }
  return Buffer.concat(parts);
}

const isJpeg = (b: Buffer) => b.length >= 4 && b.readUInt16BE(0) === 0xffd8 && b.readUInt16BE(b.length - 2) === 0xffd9;

// Decodes what a host uploads: for each update, the kind (u8, 0 for a
// keyframe, 1 for a patch), x and y (u16), the JPEG length (u32) and the
// JPEG. Returns undefined when the body is malformed.
export function decodeUpdates(body: Buffer): FrameUpdate[] | undefined {
  const out: FrameUpdate[] = [];
  let at = 0;
  while (at < body.length) {
    if (body.length - at < 9 || out.length >= 64) return;
    const kind = body.readUInt8(at);
    const x = body.readUInt16BE(at + 1);
    const y = body.readUInt16BE(at + 3);
    const length = body.readUInt32BE(at + 5);
    at += 9;
    if (kind > 1 || length > body.length - at) return;
    const data = body.subarray(at, at + length);
    at += length;
    if (!isJpeg(data) || (kind === 0 && (x !== 0 || y !== 0))) return;
    out.push({key: kind === 0, x, y, data: Buffer.from(data)});
  }
  return out.length ? out : undefined;
}

export type RequestStatus = "waiting" | "accepted" | "missed";

// A host's Initiate request, kept after it closes so the company and the
// admin console can see what happened.
export type RequestRecord = {
  id: string;
  code: string;
  ra?: string;
  name: string;
  at: number;
  until: number;
  status: RequestStatus;
  closedAt?: number;
  acceptedBy?: string;
};

// A remote access link created from the client app ("Create remote access
// URL"). Opening it and entering its access code connects to the PC that
// created it, without a prompt, until the link expires or is cleared.
export type Link = {
  id: string;
  key: string;
  code: string;
  pin: string;
  name: string;
  createdAt: number;
  expiresAt: number;
  ttlHours: number;
  sessions: number;
  failures: number;
  lockedUntil: number;
  // The RA ID of the PC when it last registered, so its company can see the
  // link (and its Access PIN) while the PC is offline.
  ra?: string;
  // Wrong Access PINs since the last lock, and in all.
  pinFailures: number;
  pinFailuresTotal: number;
};

const linkInfo = (link: Link): LinkInfo => ({
  code: link.code, name: link.name, ra: link.ra, createdAt: link.createdAt, expiresAt: link.expiresAt, ttlHours: link.ttlHours,
});

// PC names are display text only: keep letters, digits, space, dot, dash, underscore.
function cleanName(name: string) {
  return name.replace(/[^\w .-]/g, "").trim().slice(0, 40);
}

function samePin(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// What the client app gets back about a link: everything except the PC's key.
// What the PC gets back: never its key, its lock state or anything about
// the company PIN that authored it.
function publicLink(link: Link) {
  const {key: _key, failures: _f, lockedUntil: _l, ra: _ra, pinFailures: _pf, pinFailuresTotal: _pt, ...rest} = link;
  return rest;
}

export function createMsfwrStore(clock = Date.now, hooks: StoreHooks = {}) {
  // Each company's current, unused PIN.
  const companyPins = new Map<string, {pin: string; issuedAt: number; expiresAt: number; company: CompanyRef}>();
  // Which company authored each link (by link code). Kept apart from links so
  // the portal can restore claims after a relay restart, before the PC
  // re-sends its link.
  const claims = new Map<string, LinkClaim>();
  const activePins = () => {
    const now = clock();
    for (const [id, p] of companyPins) if (p.expiresAt <= now) companyPins.delete(id);
    return companyPins;
  };
  const codes = new Map<string, Session>();
  const peers = new Map<string, { session: Session; role: "host" | "viewer" }>();
  // Unattended sessions by access code, including live ones (which are no
  // longer joinable, so they are not in codes).
  const standings = new Map<string, Session>();
  const links = new Map<string, Link>(); // by code
  const records: RequestRecord[] = [];

  // Drops viewers that stopped polling. A joined session whose viewers are
  // all gone is over.
  const expired = (s: Session) => {
    const now = clock();
    for (const [token, seen] of s.viewers) {
      if (now - seen > peerTTL) { s.viewers.delete(token); peers.delete(token); }
    }
    return s.expires <= now || now - s.hostSeen > peerTTL ||
      (s.state !== "waiting" && s.viewers.size === 0);
  };
  // Reports an ended live session to the billing layer, exactly once.
  const report = (s: Session) => {
    if (s.recorded || !s.liveAt || !hooks.onEnd) return;
    s.recorded = true;
    const now = clock();
    try {
      hooks.onEnd({
        sessionId: s.id,
        raId: s.ra ?? "",
        pcName: s.name || s.call?.name || "",
        link: s.linkCode,
        mode: s.via === "link" ? "link" : s.preapproved ? "unattended" : "attended",
        operator: s.operator?.name ?? "",
        operatorId: s.operator?.id,
        startedAt: s.liveAt,
        endedAt: now,
        durationMs: Math.max(0, now - s.liveAt),
        viewers: Math.max(s.peakViewers ?? 0, s.viewers.size),
      });
    } catch { /* hooks must never break the session store */ }
  };
  const end = (s: Session) => {
    report(s);
    if (codes.get(s.code) === s) codes.delete(s.code);
    if (standings.get(s.code) === s) standings.delete(s.code);
    peers.delete(s.host);
    for (const token of s.viewers.keys()) peers.delete(token);
    s.viewers.clear();
    s.frame = undefined;
    s.patches = undefined;
    s.patchBytes = 0;
    s.input = [];
    s.closed = true;
    notify(s);
  };
  // Wakes the long-polling requests of a session so they check again.
  const notify = (s: Session) => {
    if (!s.watchers?.size) return;
    for (const fn of [...s.watchers]) {
      try { fn(); } catch { /* a watcher must not break the others */ }
    }
  };
  const addViewer = (s: Session) => {
    const token = randomBytes(32).toString("base64url");
    s.viewers.set(token, clock());
    peers.set(token, {session: s, role: "viewer"});
    s.peakViewers = Math.max(s.peakViewers ?? 0, s.viewers.size);
    return token;
  };
  // Marks a session live and counts it once, for quota.
  const goLive = (s: Session) => {
    const now = clock();
    s.liveAt = now;
    s.expires = now + sessionTTL;
    s.state = "live";
    s.peakViewers = Math.max(s.peakViewers ?? 0, s.viewers.size);
    try { hooks.onLive?.(s); } catch { /* best-effort */ }
  };
  // Closes requests whose time ran out or whose PC went away.
  const settle = () => {
    const now = clock();
    for (const r of records) {
      if (r.status !== "waiting") continue;
      const s = codes.get(r.code);
      if (r.until <= now || !s || expired(s) || s.state !== "waiting") {
        r.status = "missed";
        r.closedAt = Math.min(now, r.until);
      }
    }
  };
  const sweep = () => {
    for (const {session, role} of [...peers.values()]) {
      if (role === "host" && expired(session)) end(session);
    }
    const now = clock();
    for (const [code, link] of links) if (link.expiresAt <= now) links.delete(code);
    settle();
  };
  const newSession = (code: string, preapproved: boolean, name?: string): Session => {
    const now = clock();
    return {
      id: randomBytes(9).toString("base64url"),
      code, host: randomBytes(32).toString("base64url"), viewers: new Map(), state: "waiting", preapproved, name,
      createdAt: now, expires: now + inviteTTL, hostSeen: now, sequence: 0, lastFrame: 0, input: [],
    };
  };
  const accepted = (s: Session, by?: string) => {
    const now = clock();
    for (const r of records) {
      if (r.code === s.code && r.status === "waiting") {
        r.status = "accepted";
        r.closedAt = now;
        r.acceptedBy = by;
      }
    }
  };
  const publicRecord = ({code: _c, ...r}: RequestRecord) => r;
  const view = (s: Session) => ({
    id: s.id,
    name: s.name || s.call?.name || "",
    mode: s.via === "link" ? "link" as const : s.preapproved ? "unattended" as const : "attended" as const,
    state: s.state,
    ra: s.ra,
    operator: s.operator?.name,
    viewers: s.viewers.size,
    createdAt: s.createdAt,
    liveAt: s.liveAt,
  });
  const findLink = (code: string) => {
    const link = links.get(code.toUpperCase());
    if (!link) return;
    if (link.expiresAt <= clock()) { links.delete(link.code); return; }
    return link;
  };
  const linkFor = (id: string, key: string) => {
    if (!/^[\w-]{43}$/.test(key) || !id) return;
    const link = findLink(linkCode(key, id));
    return link && link.key === key && link.id === id ? link : undefined;
  };
  // The PC behind a link is the unattended host registered with the same key.
  const linkHost = (link: Link) => {
    const s = standings.get(standingCode(link.key));
    return s && !expired(s) ? s : undefined;
  };
  const blocked = (link: Link) => link.pinFailuresTotal >= accessPinLimit;
  // The company whose current PIN this is, if any. Current PINs are unique.
  const pinOwner = (pin: string) => {
    for (const p of activePins().values()) if (samePin(pin, p.pin)) return p.company;
    return undefined;
  };
  const linkStatusOf = (link: Link) => {
    const s = linkHost(link);
    const shared = !!s && s.state === "live" && s.via === "link";
    return {
      online: !!s, viewers: shared ? s.viewers.size : 0, locked: link.lockedUntil > clock(),
      blocked: blocked(link), sessions: link.sessions, active: true,
    };
  };

  const store = {
    sweep,
    end,
    // The company's current PIN, issued on first ask and replaced once it is
    // used or companyPinTTL passes.
    companyPin(company: CompanyRef) {
      const pins = activePins();
      const current = pins.get(company.id);
      if (current) { current.company = company; return {pin: current.pin, issuedAt: current.issuedAt, expiresAt: current.expiresAt}; }
      const taken = new Set([...pins.values()].map((p) => p.pin));
      let pin: string;
      do { pin = String(randomInt(0, 10_000)).padStart(4, "0"); } while (taken.has(pin));
      const now = clock();
      const issued = {pin, issuedAt: now, expiresAt: now + companyPinTTL, company};
      pins.set(company.id, issued);
      return {pin, issuedAt: now, expiresAt: issued.expiresAt};
    },
    // Drops a company's current PIN (account disabled or removed).
    dropCompanyPin(accountId: string) { companyPins.delete(accountId); },
    // Claims recorded before a restart.
    restoreClaims(list: {code: string; claim: LinkClaim}[]) {
      for (const {code, claim} of list) if (!claims.has(code)) claims.set(code, claim);
    },
    claimOf(code: string) { return claims.get(code.toUpperCase()); },
    // Live state of the given link codes, for the URL register views.
    linkStates(codes: string[]) {
      const out = new Map<string, ReturnType<typeof linkStatusOf>>();
      for (const code of codes) {
        const link = findLink(code);
        if (link) out.set(code, linkStatusOf(link));
      }
      return out;
    },
    invite() {
      sweep();
      if (peers.size >= 96) return;
      let code: string;
      do { code = randomBytes(6).toString("hex").toUpperCase(); } while (codes.has(code));
      const session = newSession(code, false);
      codes.set(code, session);
      peers.set(session.host, {session, role: "host"});
      return {code, token: session.host};
    },
    // Registers (or refreshes) the waiting session of an unattended host.
    // A viewer that joins it goes live at once, without host approval. ra is
    // the RA ID the PC's remote access points to (already validated).
    standing(key: string, name = "", ra?: string) {
      sweep();
      if (!/^[\w-]{43}$/.test(key)) return;
      const code = standingCode(key);
      const previous = codes.get(code);
      if (previous) {
        if (!previous.preapproved) return;
        end(previous);
      }
      const live = standings.get(code);
      if (live) end(live);
      if (peers.size >= 96) return;
      const session = newSession(code, true, cleanName(name));
      session.ra = ra;
      codes.set(code, session);
      standings.set(code, session);
      for (const link of links.values()) if (link.key === key) link.ra = ra;
      peers.set(session.host, {session, role: "host"});
      return {code, token: session.host};
    },
    // The host asks to be connected: viewers that know its code see it, and
    // so does the company whose RA ID it names. An attended host can only
    // ask a company (which still needs the verification number).
    call(s: Session, name: string, until = clock() + callTTL, ra = s.ra) {
      if (s.state !== "waiting" || !codes.has(s.code) || (!s.preapproved && !ra)) return false;
      const now = clock();
      const label = cleanName(name) || s.name || "";
      const end = Math.min(until, now + callTTL);
      settle();
      // A host refreshes its registration every two minutes and repeats an
      // open request; keep that as the same request.
      let record = records.find((r) => r.status === "waiting" && r.code === s.code && r.ra === ra);
      if (record) {
        record.until = end;
        record.name = label;
      } else {
        for (const r of records) {
          if (r.status === "waiting" && r.code === s.code) { r.status = "missed"; r.closedAt = now; }
        }
        record = {id: randomBytes(9).toString("base64url"), code: s.code, ra, name: label, at: now, until: end, status: "waiting"};
        records.unshift(record);
        if (records.length > maxRecords) records.length = maxRecords;
      }
      s.call = {name: label, until: end, ra, record: record.id};
      return true;
    },
    // Reports which of the given codes have a pending Initiate request. A
    // viewer learns nothing about codes it does not already know.
    calls(list: string[]) {
      const now = clock();
      const found: {code: string; name: string}[] = [];
      for (const code of new Set(list)) {
        const s = codes.get(code);
        if (s?.preapproved && s.call && s.call.until > now && s.state === "waiting" && !expired(s)) found.push({code, name: s.call.name});
      }
      return found;
    },
    // Reports which of the given codes have an unattended host online
    // (waiting for a viewer) or busy (in a session). Others are offline.
    presence(list: string[]) {
      const found: {code: string; name: string; state: "online" | "busy"}[] = [];
      for (const code of new Set(list)) {
        const s = standings.get(code);
        if (s && !expired(s)) found.push({code, name: s.name ?? "", state: s.state === "waiting" ? "online" : "busy"});
      }
      return found;
    },
    // Requests sent to one RA ID (open ones first, then recent history) and
    // the PCs whose remote access points to it. Access codes are never
    // included; connecting goes through accept() or connectPc().
    inbox(raId: string, limit = 30) {
      sweep();
      const requests = records.filter((r) => r.ra === raId).slice(0, limit).map(publicRecord);
      const pcs = [...standings.values()]
        .filter((s) => s.ra === raId && !expired(s))
        .map((s) => ({id: pcId(s.code), name: s.name ?? "", state: s.state === "waiting" ? "online" as const : "busy" as const}))
        .sort((a, b) => a.name.localeCompare(b.name));
      return {requests, pcs};
    },
    // Joins the session behind an open request sent to this company.
    accept(id: string, operator: Operator) {
      settle();
      const r = records.find((x) => x.id === id);
      if (!r || r.ra !== operator.raId) return {error: "missing" as const};
      if (r.status !== "waiting") return {error: r.status};
      const viewer = store.join(r.code, operator);
      if (!viewer) return {error: "missed" as const};
      return {viewer};
    },
    // Connects a company to an online PC that points to its RA ID.
    connectPc(id: string, operator: Operator) {
      sweep();
      for (const s of standings.values()) {
        if (s.ra === operator.raId && pcId(s.code) === id) return store.join(s.code, operator);
      }
      return undefined;
    },
    join(code: string, operator?: Operator, via?: "link") {
      const s = codes.get(code);
      if (!s || expired(s) || s.state !== "waiting") return;
      codes.delete(code);
      accepted(s, operator?.name);
      s.call = undefined;
      s.operator = operator;
      s.via = via;
      const token = addViewer(s);
      if (s.preapproved) {
        goLive(s);
        return {token, verification: "", preapproved: true};
      }
      const verification = String(randomInt(100000, 1000000));
      s.verification = verification;
      s.state = "pending";
      return {token, verification, preapproved: false};
    },

    // --- Remote access links (created from the client app) ---
    // Only a PC with an unattended key can create a link; the key proves it
    // owns the PC. The link comes with a six-digit access code.
    linkCreate(key: string, name: string, ttlHours?: number) {
      sweep();
      if (!/^[\w-]{43}$/.test(key)) return;
      if (links.size >= 5000) return;
      const hours = ttlHours && linkTTLs.includes(ttlHours) ? ttlHours : 24;
      let id: string;
      do { id = randomBytes(9).toString("base64url"); } while (links.has(linkCode(key, id)));
      const now = clock();
      const link: Link = {
        id, key, code: linkCode(key, id), pin: String(randomInt(0, 1_000_000)).padStart(6, "0"), name: cleanName(name),
        createdAt: now, expiresAt: now + hours * 3_600_000, ttlHours: hours, sessions: 0, failures: 0, lockedUntil: 0,
        ra: standings.get(standingCode(key))?.ra, pinFailures: 0, pinFailuresTotal: 0,
      };
      links.set(link.code, link);
      try { hooks.onLinkCreated?.(linkInfo(link)); } catch { /* best-effort */ }
      return publicLink(link);
    },
    // The PC re-sends its saved link each time it registers, so a link
    // survives a relay restart. Only the PC that owns the key can restore
    // it, because the link's code is derived from that key.
    linkRestore(input: {id: string; key: string; pin?: string; name?: string; createdAt?: number; expiresAt?: number}) {
      const known = linkFor(input.id, input.key);
      if (known) return publicLink(known);
      const now = clock();
      if (!input.pin || !/^\d{6}$/.test(input.pin) || !/^[\w-]{43}$/.test(input.key) || !/^[\w-]{6,32}$/.test(input.id)) return;
      const expiresAt = Number(input.expiresAt);
      if (!Number.isFinite(expiresAt) || expiresAt <= now || expiresAt > now + 121 * 3_600_000) return;
      if (links.size >= 5000) return;
      const createdAt = Number.isFinite(Number(input.createdAt)) ? Number(input.createdAt) : now;
      const link: Link = {
        id: input.id, key: input.key, code: linkCode(input.key, input.id), pin: input.pin, name: cleanName(input.name ?? ""),
        createdAt, expiresAt, ttlHours: Math.max(1, Math.round((expiresAt - createdAt) / 3_600_000)), sessions: 0, failures: 0, lockedUntil: 0,
        ra: standings.get(standingCode(input.key))?.ra, pinFailures: 0, pinFailuresTotal: 0,
      };
      links.set(link.code, link);
      try { hooks.onLinkCreated?.(linkInfo(link)); } catch { /* best-effort */ }
      return publicLink(link);
    },
    linkStatus(id: string, key: string) {
      const link = linkFor(id, key);
      if (!link) return;
      const s = linkHost(link);
      const viewers = s && s.state === "live" && s.via === "link" ? s.viewers.size : 0;
      return {link: publicLink(link), online: !!s, busy: !!s && s.state !== "waiting", viewers};
    },
    linkRevoke(id: string, key: string) {
      const link = linkFor(id, key);
      if (!link) return false;
      links.delete(link.code);
      try { hooks.onLinkRevoked?.(link.code, clock()); } catch { /* best-effort */ }
      return true;
    },
    // What the link page shows before the access code is entered.
    linkInfo(code: string) {
      const link = findLink(code);
      if (!link) return;
      const s = linkHost(link);
      // A PC already shared through its URL can take more people.
      const shared = !!s && s.state === "live" && s.via === "link";
      return {
        code: link.code, name: link.name || s?.name || "", online: !!s,
        busy: !!s && s.state !== "waiting" && !(shared && s.viewers.size < linkViewers),
        viewers: shared ? s.viewers.size : 0, expiresAt: link.expiresAt,
        accessPinRequired: true, blocked: blocked(link), claimed: claims.has(link.code),
      };
    },
    // The company a PIN would author (or has authored) this link for, without
    // changing anything, so the route can check that company's subscription
    // before connecting.
    linkAuthor(code: string, pin: string | undefined) {
      const link = findLink(code);
      const given = String(pin ?? "").replace(/\D/g, "");
      if (!link || given.length !== 4) return undefined;
      const claim = claims.get(link.code);
      if (claim) return samePin(given, claim.pin) ? {accountId: claim.accountId, raId: claim.raId} : undefined;
      const owner = pinOwner(given);
      return owner ? {accountId: owner.id, raId: owner.raId} : undefined;
    },
    // The RA ID of the PC behind a link code, so the route can enforce that
    // company's subscription before opening a session. Undefined when the
    // link or its online PC is gone.
    linkHostRa(code: string) {
      const link = findLink(code);
      if (!link) return undefined;
      return linkHost(link)?.ra;
    },
    // Opens a session through a link once its access code and a company's
    // Access PIN both match. The first company PIN used authors the link for
    // that company; afterwards only the same PIN opens it.
    linkJoin(code: string, pin: string, accessPinValue?: string, client: {ip?: string; agent?: string} = {}) {
      const link = findLink(code);
      if (!link) return {error: "missing" as const};
      const now = clock();
      if (blocked(link)) return {error: "blocked" as const};
      if (link.lockedUntil > now) return {error: "locked" as const};
      if (!samePin(String(pin ?? "").replace(/\D/g, ""), link.pin)) {
        link.failures += 1;
        if (link.failures >= linkTries) { link.lockedUntil = now + lockMs; link.failures = 0; }
        return {error: "pin" as const};
      }
      link.failures = 0;
      const given = String(accessPinValue ?? "").replace(/\D/g, "");
      if (!given) return {error: "access-pin-required" as const};
      let claim = claims.get(link.code);
      const owner = claim ? undefined : given.length === 4 ? pinOwner(given) : undefined;
      if (claim ? !samePin(given, claim.pin) : !owner) {
        link.pinFailures += 1;
        link.pinFailuresTotal += 1;
        if (blocked(link)) return {error: "blocked" as const};
        if (link.pinFailures >= accessPinTries) { link.lockedUntil = now + lockMs; link.pinFailures = 0; }
        return {error: "access-pin" as const};
      }
      link.pinFailures = 0;
      const s = linkHost(link);
      if (!s) return {error: "offline" as const};
      const busy = s.state === "live" && s.via === "link" ? s.viewers.size >= linkViewers : s.state !== "waiting";
      if (busy) return {error: s.state === "live" && s.via === "link" ? "full" as const : "busy" as const};
      // A company PIN authors the link now, and is used up: the company is
      // shown a new PIN for its next URL.
      let claimed = false;
      if (!claim && owner) {
        claim = {
          accountId: owner.id, company: owner.name, raId: owner.raId, pin: given, at: now,
          clientIp: client.ip ? String(client.ip).slice(0, 64) : undefined,
          clientAgent: client.agent ? String(client.agent).replace(/[\u0000-\u001f]/g, " ").slice(0, 200) : undefined,
        };
        claims.set(link.code, claim);
        companyPins.delete(owner.id);
        claimed = true;
        try { hooks.onLinkClaimed?.(link.code, claim, linkInfo(link)); } catch { /* best-effort */ }
      }
      const operator = {id: claim!.accountId, name: claim!.company, raId: claim!.raId};
      // Others already connected through the URL: join them in the same session.
      if (s.state === "live" && s.via === "link") {
        link.sessions += 1;
        return {viewer: {token: addViewer(s), verification: "", preapproved: true}, name: s.name ?? link.name, claim: claim!, claimed};
      }
      const viewer = store.join(s.code, operator, "link");
      if (!viewer) return {error: "offline" as const};
      s.linkCode = link.code;
      link.sessions += 1;
      return {viewer, name: s.name ?? link.name, claim: claim!, claimed};
    },

    authenticate(header: string | undefined, role?: "host" | "viewer") {
      const token = /^Bearer ([\w-]{43})$/.exec(header ?? "")?.[1];
      const peer = token && peers.get(token);
      if (!peer) return;
      const {session: s} = peer;
      if (expired(s)) { end(s); return; }
      if (role && role !== peer.role) return;
      if (peer.role === "host") s.hostSeen = clock();
      else if (s.viewers.has(token)) s.viewers.set(token, clock());
      else return;
      return s;
    },
    // A viewer leaves. The session ends when the host or its last viewer leaves.
    leave(s: Session, header: string | undefined) {
      const token = /^Bearer ([\w-]{43})$/.exec(header ?? "")?.[1];
      if (token && s.viewers.has(token) && s.viewers.size > 1) {
        s.viewers.delete(token);
        peers.delete(token);
        return false;
      }
      end(s);
      return true;
    },
    approve(s: Session) {
      if (s.state !== "pending") return false;
      goLive(s);
      return true;
    },
    // A host heartbeat, with the screen updates it carries: a bare JPEG (a
    // keyframe, from older hosts) or a list of keyframes and patches. With
    // events set, the host reads input from /events, so the queue is left.
    tick(s: Session, frame?: Buffer | FrameUpdate[], events = false) {
      if (s.state !== "live") return {state: s.state, verification: s.verification, input: []};
      const now = clock();
      const updates = Buffer.isBuffer(frame) ? [{key: true, x: 0, y: 0, data: frame}] : frame ?? [];
      let changed = false;
      for (const u of updates) {
        if (u.key) {
          s.sequence += 1;
          s.frame = u.data;
          s.keySequence = s.sequence;
          s.patches = [];
          s.patchBytes = 0;
          s.wantKey = false;
        } else {
          // A patch applies on top of the current keyframe; without one, or
          // once the log is full, it cannot be shown, so the host is asked
          // for a keyframe instead.
          if (!s.frame || s.wantKey || (s.patchBytes ?? 0) + u.data.length > patchLogBytes ||
              (s.patches?.length ?? 0) >= patchLogCount) {
            s.wantKey = true;
            continue;
          }
          s.sequence += 1;
          (s.patches ??= []).push({...u, sequence: s.sequence});
          s.patchBytes = (s.patchBytes ?? 0) + u.data.length;
        }
        s.lastFrame = now;
        changed = true;
      }
      if (changed) notify(s);
      const input = events ? [] : store.takeInput(s);
      return {state: s.state, input, ...(s.wantKey ? {key: true} : {})};
    },
    // A tick numbered by the host (X-Msfwr-Seq), which may have several
    // uploads in flight: updates are applied in the host's order. A patch
    // that arrives after a later update was applied, or a skipped gap,
    // leaves the screen wrong, so the host is asked for a keyframe.
    tickInOrder(s: Session, seq: number, frame?: Buffer | FrameUpdate[], events = false) {
      if (s.state !== "live") return store.tick(s, frame, events);
      const order = (s.hostOrder ??= {pending: new Map()});
      const key = Buffer.isBuffer(frame) || !!frame?.[0]?.key;
      const {ready, late, skipped} = reorder(order, seq, frame, clock(), key);
      for (const f of ready) store.tick(s, f, true);
      if ((late && frame) || skipped) s.wantKey = true;
      return store.tick(s, undefined, events);
    },
    // Input numbered by the viewer (X-Msfwr-Seq), applied in its order. A
    // lost or late batch could leave a button held, so it releases.
    enqueueInOrder(s: Session, viewer: string, seq: number, items: MsfwrInput[]) {
      const orders = (s.inputOrder ??= new Map());
      let order = orders.get(viewer);
      if (!order) {
        if (orders.size >= 16) orders.clear();
        orders.set(viewer, order = {pending: new Map()});
      }
      const {ready, late, skipped} = reorder(order, seq, items, clock());
      if (late || skipped) {
        if (!store.enqueue(s, {kind: "release"})) return false;
      }
      for (const list of ready) {
        for (const item of list) if (!store.enqueue(s, item)) return false;
      }
      return true;
    },
    setQuality(s: Session, quality: ViewQuality) {
      if (s.quality === quality) return;
      s.quality = quality;
      notify(s);
    },
    // Removes and returns the input queued for the host.
    takeInput(s: Session): MsfwrInput[] {
      const now = clock();
      const queued = s.input.splice(0);
      // Drop old actions instead of replaying them after a stall. Ensure that
      // a dropped button-up cannot leave a mouse button held on the host.
      const stale = queued.some(({time}) => now - time > 1000);
      return stale ? [{kind:"release"}] : queued.map(({item}) => item);
    },
    // The screen updates a viewer that has seen sequence `after` still
    // needs: the keyframe and every patch after it when the viewer is behind
    // the keyframe, otherwise only the newer patches.
    updatesAfter(s: Session, after: number): FramePatch[] {
      if (!s.frame || s.keySequence === undefined || s.sequence <= after) return [];
      const patches = s.patches ?? [];
      if (after < s.keySequence) {
        return [{key: true, x: 0, y: 0, data: s.frame, sequence: s.keySequence}, ...patches];
      }
      return patches.filter((p) => p.sequence > after);
    },
    // Runs fn whenever the session gets a frame or input, or ends, until the
    // returned function is called.
    watch(s: Session, fn: () => void) {
      (s.watchers ??= new Set()).add(fn);
      return () => { s.watchers?.delete(fn); };
    },
    enqueue(s: Session, item: MsfwrInput) {
      const last = s.input.at(-1);
      if (item.kind === "release") s.input = [];
      if (item.kind === "move" && last?.item.kind === "move") s.input.pop();
      if (s.input.length >= 48) {
        s.input = [{item: {kind: "release"}, time: clock()}];
        notify(s);
        return false;
      }
      s.input.push({item, time: clock()});
      notify(s);
      return true;
    },

    // Admin console: live sessions, online PCs and requests on this relay.
    overview() {
      sweep();
      const sessions = new Map<string, Session>();
      for (const {session} of peers.values()) sessions.set(session.id, session);
      const list = [...sessions.values()];
      return {
        live: list.filter((s) => s.state !== "waiting").map(view),
        pcs: [...standings.values()].filter((s) => !expired(s)).map(view),
        requests: records.slice(0, 100).map(publicRecord),
        links: [...links.values()].map((l) => ({code: l.code, ...linkStatusOf(l)})),
      };
    },
    // Live sessions a company has open right now: the ones its operators
    // opened, or (with no operator) on PCs pointing to its RA ID.
    liveFor(raId: string) {
      const seen = new Set<Session>();
      for (const {session} of peers.values()) {
        if (session.state === "live" && !expired(session) && (session.operator?.raId ?? session.ra) === raId) seen.add(session);
      }
      return [...seen].map(view);
    },
    endById(id: string) {
      for (const {session} of peers.values()) {
        if (session.id === id) { end(session); return true; }
      }
      return false;
    },
    // Ends every session a portal user is connected to (account removed or disabled).
    endOperator(userId: string) {
      for (const {session} of [...peers.values()]) if (session.operator?.id === userId) end(session);
    },
  };
  return store;
}

export type MsfwrStore = ReturnType<typeof createMsfwrStore>;
