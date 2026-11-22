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
const lockMs = 15 * 60_000;
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

export type Session = {
  // Internal id, used by the admin console; never the access code.
  id: string;
  code: string;
  host: string;
  viewer?: string;
  operator?: Operator;
  verification?: string;
  state: "waiting" | "pending" | "live";
  preapproved: boolean;
  // The RA ID this unattended PC's remote access points to.
  ra?: string;
  // Set when the viewer came in through a shared remote access link.
  via?: "link";
  // The PC name an unattended host reports.
  name?: string;
  // Set while the host's Initiate request is open.
  call?: { name: string; until: number; ra?: string; record: string };
  createdAt: number;
  liveAt?: number;
  expires: number;
  hostSeen: number;
  viewerSeen: number;
  frame?: Buffer;
  sequence: number;
  lastFrame: number;
  input: { item: MsfwrInput; time: number }[];
};

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
};

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
function publicLink(link: Link) {
  const {key: _key, failures: _f, lockedUntil: _l, ...rest} = link;
  return rest;
}

export function createMsfwrStore(clock = Date.now) {
  const codes = new Map<string, Session>();
  const peers = new Map<string, { session: Session; role: "host" | "viewer" }>();
  // Unattended sessions by access code, including live ones (which are no
  // longer joinable, so they are not in codes).
  const standings = new Map<string, Session>();
  const links = new Map<string, Link>(); // by code
  const records: RequestRecord[] = [];

  const expired = (s: Session) => {
    const now = clock();
    return s.expires <= now || now - s.hostSeen > peerTTL ||
      (!!s.viewer && now - s.viewerSeen > peerTTL);
  };
  const end = (s: Session) => {
    if (codes.get(s.code) === s) codes.delete(s.code);
    if (standings.get(s.code) === s) standings.delete(s.code);
    peers.delete(s.host);
    if (s.viewer) peers.delete(s.viewer);
    s.frame = undefined;
    s.input = [];
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
      code, host: randomBytes(32).toString("base64url"), state: "waiting", preapproved, name,
      createdAt: now, expires: now + inviteTTL, hostSeen: now, viewerSeen: 0, sequence: 0, lastFrame: 0, input: [],
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

  const store = {
    sweep,
    end,
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
      const token = randomBytes(32).toString("base64url");
      const now = clock();
      s.viewer = token;
      s.viewerSeen = now;
      peers.set(token, {session: s, role: "viewer"});
      if (s.preapproved) {
        s.state = "live";
        s.liveAt = now;
        s.expires = now + sessionTTL;
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
      };
      links.set(link.code, link);
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
      };
      links.set(link.code, link);
      return publicLink(link);
    },
    linkStatus(id: string, key: string) {
      const link = linkFor(id, key);
      if (!link) return;
      const s = linkHost(link);
      return {link: publicLink(link), online: !!s, busy: !!s && s.state !== "waiting"};
    },
    linkRevoke(id: string, key: string) {
      const link = linkFor(id, key);
      if (!link) return false;
      links.delete(link.code);
      return true;
    },
    // What the link page shows before the access code is entered.
    linkInfo(code: string) {
      const link = findLink(code);
      if (!link) return;
      const s = linkHost(link);
      return {code: link.code, name: link.name || s?.name || "", online: !!s, busy: !!s && s.state !== "waiting", expiresAt: link.expiresAt};
    },
    // Opens a session through a link once the access code matches.
    linkJoin(code: string, pin: string) {
      const link = findLink(code);
      if (!link) return {error: "missing" as const};
      const now = clock();
      if (link.lockedUntil > now) return {error: "locked" as const};
      if (!samePin(String(pin ?? "").replace(/\D/g, ""), link.pin)) {
        link.failures += 1;
        if (link.failures >= linkTries) { link.lockedUntil = now + lockMs; link.failures = 0; }
        return {error: "pin" as const};
      }
      link.failures = 0;
      const s = linkHost(link);
      if (!s) return {error: "offline" as const};
      if (s.state !== "waiting") return {error: "busy" as const};
      const viewer = store.join(s.code, undefined, "link");
      if (!viewer) return {error: "offline" as const};
      link.sessions += 1;
      return {viewer, name: s.name ?? link.name};
    },

    authenticate(header: string | undefined, role?: "host" | "viewer") {
      const token = /^Bearer ([\w-]{43})$/.exec(header ?? "")?.[1];
      const peer = token && peers.get(token);
      if (!peer) return;
      const {session: s} = peer;
      if (expired(s)) { end(s); return; }
      if (role && role !== peer.role) return;
      if (peer.role === "host") s.hostSeen = clock();
      else s.viewerSeen = clock();
      return s;
    },
    approve(s: Session) {
      if (s.state !== "pending") return false;
      const now = clock();
      s.liveAt = now;
      s.expires = now + sessionTTL;
      s.state = "live";
      return true;
    },
    tick(s: Session, frame?: Buffer) {
      if (s.state !== "live") return {state: s.state, verification: s.verification, input: []};
      const now = clock();
      if (frame && now - s.lastFrame >= 100) {
        s.lastFrame = now;
        s.frame = frame;
        s.sequence += 1;
      }
      const queued = s.input.splice(0);
      // Drop old actions instead of replaying them after a stall. Ensure that
      // a dropped button-up cannot leave a mouse button held on the host.
      const stale = queued.some(({time}) => now - time > 1000);
      const input: MsfwrInput[] = stale ? [{kind:"release"}] : queued.map(({item}) => item);
      return {state: s.state, input};
    },
    enqueue(s: Session, item: MsfwrInput) {
      const last = s.input.at(-1);
      if (item.kind === "release") s.input = [];
      if (item.kind === "move" && last?.item.kind === "move") s.input.pop();
      if (s.input.length >= 48) {
        s.input = [{item: {kind: "release"}, time: clock()}];
        return false;
      }
      s.input.push({item, time: clock()});
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
      };
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
