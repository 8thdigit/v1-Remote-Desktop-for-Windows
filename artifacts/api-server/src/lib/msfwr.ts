import { createHash, randomBytes, randomInt } from "node:crypto";
import type { MsfwrInput } from "@workspace/api-zod";

const inviteTTL = 3 * 60_000;
const sessionTTL = 30 * 60_000;
const peerTTL = 20_000;
// How long an unattended host's "Initiate" request stays visible to viewers.
export const callTTL = 2 * 60_000;
// Remote access links created from the client app are valid for 24 hours by
// default. They allow multiple sessions until they expire or are revoked.
export const linkTTL = 24 * 60 * 60_000;
export const linkTTLs = [1, 2, 4, 5, 8, 12, 24, 48, 72, 120];

// Unattended (pre-approved) hosts keep a long random key on the PC. The
// public access code is derived from it, so only the holder of the key can
// register under that code, and the relay does not need to store anything.
export function standingCode(key: string) {
  return createHash("sha256").update("msfwr-standing:" + key).digest("hex").slice(0, 12).toUpperCase();
}

// Link codes start with "L" so they never collide with an attended invite or
// a standing access code (those use hex characters only).
export function linkCode(id: string) {
  return ("L" + createHash("sha256").update("msfwr-link:" + id).digest("hex").slice(0, 11)).toUpperCase();
}

export type Session = {
  code: string;
  host: string;
  viewer?: string;
  verification?: string;
  state: "waiting" | "pending" | "live";
  preapproved: boolean;
  // Set when this session was started through a shared remote access link.
  link?: Link;
  // The PC name an unattended host reports, shown to viewers that know its code.
  name?: string;
  // Set when an unattended host pressed Initiate: viewers that already know
  // this code see the request and can accept it by joining.
  call?: { name: string; until: number };
  expires: number;
  hostSeen: number;
  viewerSeen: number;
  frame?: Buffer;
  sequence: number;
  lastFrame: number;
  input: { item: MsfwrInput; time: number }[];
};

// PC names are display text only: keep letters, digits, space, dot, dash, underscore.
function cleanName(name: string) {
  return name.replace(/[^\w .-]/g, "").trim().slice(0, 40);
}

// A remote access link created from the client app ("Create Remote Access
// URL"). The host registers a waiting session under the link's code; every
// viewer that opens the shared link starts a new session until the link
// expires (24 hours by default) or the host revokes it.
export type Link = {
  id: string;
  key: string;
  code: string;
  name: string;
  createdAt: number;
  expiresAt: number;
  ttlHours: number;
  sessions: number;
};

// What the client app gets back about a link: everything except the secret
// key, which only the host PC holds.
function publicLink(link: Link) {
  const {key: _key, ...rest} = link;
  return rest;
}

export function createMsfwrStore(clock = Date.now) {
  const codes = new Map<string, Session>();
  const peers = new Map<string, { session: Session; role: "host" | "viewer" }>();
  // Unattended sessions by access code, including live ones (which are no
  // longer joinable, so they are not in codes). Used for presence only.
  const standings = new Map<string, Session>();
  // Live link registrations and link history by link id. Links survive the
  // end of their session so the host can see how many were opened.
  const links = new Map<string, Link>();
  const linkSessions = new Map<string, Session>();
  const expired = (s: Session) => {
    const now = clock();
    return s.expires <= now || now - s.hostSeen > peerTTL ||
      (!!s.viewer && now - s.viewerSeen > peerTTL);
  };
  const end = (s: Session) => {
    if (codes.get(s.code) === s) codes.delete(s.code);
    if (standings.get(s.code) === s) standings.delete(s.code);
    if (s.link && linkSessions.get(s.link.id) === s) linkSessions.delete(s.link.id);
    peers.delete(s.host);
    if (s.viewer) peers.delete(s.viewer);
    s.frame = undefined;
    s.input = [];
  };
  const sweepLinks = () => {
    const now = clock();
    for (const [id, link] of links) {
      if (link.expiresAt > now) continue;
      const s = linkSessions.get(id);
      if (s && !expired(s)) continue; // let a live session finish naturally
      links.delete(id);
      if (s) end(s);
    }
  };
  const sweep = () => {
    for (const {session, role} of peers.values()) {
      if (role === "host" && expired(session)) end(session);
    }
    sweepLinks();
  };
  return {
    sweep,
    end,
    invite() {
      sweep();
      if (peers.size >= 96) return;
      let code: string;
      do { code = randomBytes(6).toString("hex").toUpperCase(); } while (codes.has(code));
      const host = randomBytes(32).toString("base64url");
      const now = clock();
      const session: Session = {
        code, host, state: "waiting", preapproved: false, expires: now + inviteTTL,
        hostSeen: now, viewerSeen: 0, sequence: 0, lastFrame: 0, input: [],
      };
      codes.set(code, session);
      peers.set(host, {session, role: "host"});
      return {code, token: host};
    },
    // Registers (or refreshes) the waiting session of an unattended host.
    // A viewer that joins it goes live at once, without host approval.
    standing(key: string, name = "") {
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
      const host = randomBytes(32).toString("base64url");
      const now = clock();
      const session: Session = {
        code, host, state: "waiting", preapproved: true, name: cleanName(name), expires: now + inviteTTL,
        hostSeen: now, viewerSeen: 0, sequence: 0, lastFrame: 0, input: [],
      };
      codes.set(code, session);
      standings.set(code, session);
      peers.set(host, {session, role: "host"});
      return {code, token: host};
    },
    // An unattended host asks the viewers that know its code to connect.
    call(s: Session, name: string, until = clock() + callTTL) {
      if (!s.preapproved || s.state !== "waiting" || !codes.has(s.code)) return false;
      s.call = {name: cleanName(name) || s.name || "", until: Math.min(until, clock() + callTTL)};
      return true;
    },
    // Reports which of the given codes have a pending Initiate request. A
    // viewer learns nothing about codes it does not already know.
    calls(list: string[]) {
      const now = clock();
      const found: {code: string; name: string}[] = [];
      for (const code of new Set(list)) {
        const s = codes.get(code);
        if (s?.call && s.call.until > now && s.state === "waiting" && !expired(s)) found.push({code, name: s.call.name});
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
    // --- Remote access links (created from the client app) ---
    // Creates a shareable link that opens sessions on this host's PC without
    // approval. ttlHours defaults to 24. Only hosts with an unattended key
    // can create links; the key proves ownership of the PC. The link also
    // carries its validity in hours so clients can display it.
    linkCreate(key: string, name: string, ttlHours?: number) {
      sweep();
      if (!/^[\w-]{43}$/.test(key)) return;
      const hours = ttlHours && linkTTLs.includes(ttlHours) ? ttlHours : 24;
      let id: string;
      do { id = randomBytes(9).toString("base64url"); } while (links.has(id));
      const now = clock();
      const link: Link = {id, key, code: linkCode(id), name: cleanName(name), createdAt: now, expiresAt: now + hours * 3_600_000, ttlHours: hours, sessions: 0};
      links.set(id, link);
      return publicLink(link);
    },
    // The host re-registers its waiting link session under the same link id
    // after each session ends, so the shared URL keeps working until the
    // link expires or is revoked. A live session under the link is ended
    // first when the host explicitly re-registers.
    linkRegister(idOrCode: string, key: string) {
      sweep();
      const link = links.get(idOrCode) ?? [...links.values()].find((l) => l.code === idOrCode.toUpperCase());
      if (!link || link.key !== key) return;
      if (link.expiresAt <= clock()) { links.delete(link.id); return; }
      const previous = linkSessions.get(link.id);
      if (previous) end(previous);
      if (codes.get(link.code) || standings.get(link.code)) return;
      if (peers.size >= 96) return;
      const host = randomBytes(32).toString("base64url");
      const now = clock();
      const session: Session = {
        code: link.code, host, state: "waiting", preapproved: true, link,
        name: link.name, expires: now + inviteTTL,
        hostSeen: now, viewerSeen: 0, sequence: 0, lastFrame: 0, input: [],
      };
      codes.set(link.code, session);
      standings.set(link.code, session);
      linkSessions.set(link.id, session);
      peers.set(host, {session, role: "host"});
      return {code: link.code, token: host};
    },
    linkStatus(id: string, key: string) {
      sweep();
      const link = links.get(id);
      if (!link || link.key !== key) return;
      const s = linkSessions.get(link.id);
      return {
        link: publicLink(link),
        online: !!s && !expired(s),
        busy: !!s && !expired(s) && s.state !== "waiting",
      };
    },
    linkRevoke(id: string, key: string) {
      const link = links.get(id);
      if (!link || link.key !== key) return false;
      const s = linkSessions.get(id);
      if (s) end(s);
      links.delete(id);
      return true;
    },
    join(code: string) {
      const s = codes.get(code);
      if (!s || expired(s) || s.state !== "waiting") return;
      codes.delete(code);
      s.call = undefined;
      const token = randomBytes(32).toString("base64url");
      const now = clock();
      s.viewer = token;
      s.viewerSeen = now;
      peers.set(token, {session: s, role: "viewer"});
      if (s.link) s.link.sessions += 1;
      if (s.preapproved) {
        s.state = "live";
        s.expires = now + sessionTTL;
        return {token, verification: "", preapproved: true};
      }
      const verification = String(randomInt(100000, 1000000));
      s.verification = verification;
      s.state = "pending";
      return {token, verification, preapproved: false};
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
      s.expires = clock() + sessionTTL;
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
  };
}
