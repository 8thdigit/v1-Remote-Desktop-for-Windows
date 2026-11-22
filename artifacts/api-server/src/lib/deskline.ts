import { createHash, randomBytes, randomInt } from "node:crypto";
import type { DesklineInput } from "@workspace/api-zod";

const inviteTTL = 3 * 60_000;
// A live session stays open while both peers keep polling, up to maxLive.
const sessionTTL = 30 * 60_000;
export const maxLive = 12 * 60 * 60_000;
const peerTTL = 20_000;
// How long an unattended host's "Initiate" request stays visible to viewers.
export const callTTL = 2 * 60_000;
// The shortest gap between two stored frames (about 30 frames a second).
const frameGap = 30;
const maxRecords = 400;

// Unattended (pre-approved) hosts keep a long random key on the PC. The
// public access code is derived from it, so only the holder of the key can
// register under that code, and the relay does not need to store anything.
export function standingCode(key: string) {
  return createHash("sha256").update("winss132r-standing:" + key).digest("hex").slice(0, 12).toUpperCase();
}

// The portal user connected as the viewer of a session.
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
  // The PC name an unattended host reports, shown to viewers that know its code.
  name?: string;
  // Set when the host pressed Initiate: the RA user it names, or the viewers
  // that already know this code, see the request and can accept it.
  call?: { name: string; until: number; ra?: string; record: string };
  createdAt: number;
  liveAt?: number;
  expires: number;
  hostSeen: number;
  viewerSeen: number;
  frame?: Buffer;
  sequence: number;
  lastFrame: number;
  bytes: number;
  input: { item: DesklineInput; time: number }[];
  // True once the host reads input with pull() instead of with each tick.
  pulls: boolean;
  frameWaiters: Set<() => void>;
  inputWaiters: Set<() => void>;
};

export type RequestStatus = "waiting" | "accepted" | "missed";

// A host's Initiate request, kept after it closes so the RA user and the
// admin console can see what happened.
export type RequestRecord = {
  id: string;
  code: string;
  ra?: string;
  name: string;
  mode: "unattended" | "attended";
  at: number;
  until: number;
  status: RequestStatus;
  closedAt?: number;
  acceptedBy?: Operator;
};

// PC names are display text only: keep letters, digits, space, dot, dash, underscore.
function cleanName(name: string) {
  return name.replace(/[^\w .-]/g, "").trim().slice(0, 40);
}

const wake = (set: Set<() => void>) => { for (const f of [...set]) f(); };

export function createDesklineStore(clock = Date.now) {
  const codes = new Map<string, Session>();
  const peers = new Map<string, { session: Session; role: "host" | "viewer" }>();
  // Unattended sessions by access code, including live ones (which are no
  // longer joinable, so they are not in codes). Used for presence only.
  const standings = new Map<string, Session>();
  const records: RequestRecord[] = [];
  const end = (s: Session) => {
    if (codes.get(s.code) === s) codes.delete(s.code);
    if (standings.get(s.code) === s) standings.delete(s.code);
    peers.delete(s.host);
    if (s.viewer) peers.delete(s.viewer);
    s.frame = undefined;
    s.input = [];
    wake(s.frameWaiters);
    wake(s.inputWaiters);
  };
  const alive = (s: Session) => peers.get(s.host)?.session === s;
  const expired = (s: Session) => {
    const now = clock();
    return s.expires <= now || now - s.hostSeen > peerTTL ||
      (!!s.viewer && now - s.viewerSeen > peerTTL);
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
    for (const {session, role} of peers.values()) {
      if (role === "host" && expired(session)) end(session);
    }
    settle();
  };
  const newSession = (code: string, preapproved: boolean, name?: string): Session => {
    const now = clock();
    return {
      id: randomBytes(9).toString("base64url"),
      code, host: randomBytes(32).toString("base64url"), state: "waiting", preapproved, name,
      createdAt: now, expires: now + inviteTTL, hostSeen: now, viewerSeen: 0, sequence: 0, lastFrame: 0, bytes: 0,
      input: [], pulls: false, frameWaiters: new Set(), inputWaiters: new Set(),
    };
  };
  const accepted = (s: Session, operator?: Operator) => {
    const now = clock();
    for (const r of records) {
      if (r.code === s.code && r.status === "waiting") {
        r.status = "accepted";
        r.closedAt = now;
        r.acceptedBy = operator;
      }
    }
  };
  const view = (s: Session) => ({
    id: s.id,
    name: s.name || s.call?.name || "",
    mode: s.preapproved ? "unattended" as const : "attended" as const,
    state: s.state,
    operator: s.operator,
    createdAt: s.createdAt,
    liveAt: s.liveAt,
    frames: s.sequence,
    bytes: s.bytes,
  });

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
      const session = newSession(code, true, cleanName(name));
      codes.set(code, session);
      standings.set(code, session);
      peers.set(session.host, {session, role: "host"});
      return {code, token: session.host};
    },
    // The host asks to be connected: an unattended host asks the viewers
    // that know its code, or (with an RA ID) one portal user. An attended
    // host can only ask one RA user, who still needs the verification number.
    call(s: Session, name: string, until = clock() + callTTL, ra?: string) {
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
        record = {id: randomBytes(9).toString("base64url"), code: s.code, ra, name: label,
          mode: s.preapproved ? "unattended" : "attended", at: now, until: end, status: "waiting"};
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
    // Requests sent to one RA user: open ones first, then recent history.
    // The access code is never included; accepting goes through accept().
    inbox(raId: string, limit = 30) {
      settle();
      const mine = records.filter((r) => r.ra === raId);
      return mine.slice(0, limit).map(({code: _c, ra: _r, ...r}) => r);
    },
    // Joins the session behind an open request sent to this RA user.
    accept(id: string, operator: Operator) {
      settle();
      const r = records.find((x) => x.id === id);
      if (!r || r.ra !== operator.raId) return {error: "missing" as const};
      if (r.status !== "waiting") return {error: r.status};
      const viewer = store.join(r.code, operator);
      if (!viewer) return {error: "missed" as const};
      return {viewer};
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
    join(code: string, operator?: Operator) {
      const s = codes.get(code);
      if (!s || expired(s) || s.state !== "waiting") return;
      codes.delete(code);
      accepted(s, operator);
      s.call = undefined;
      s.operator = operator;
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
    authenticate(header: string | undefined, role?: "host" | "viewer") {
      const token = /^Bearer ([\w-]{43})$/.exec(header ?? "")?.[1];
      const peer = token && peers.get(token);
      if (!peer) return;
      const {session: s} = peer;
      if (expired(s)) { end(s); return; }
      if (role && role !== peer.role) return;
      const now = clock();
      if (peer.role === "host") s.hostSeen = now;
      else s.viewerSeen = now;
      if (s.state === "live" && s.liveAt) s.expires = Math.min(s.liveAt + maxLive, now + sessionTTL);
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
    // Host heartbeat with an optional new frame. A host that reads input
    // with pull() leaves the input queued for it.
    tick(s: Session, frame?: Buffer, pulls = false) {
      if (pulls) s.pulls = true;
      if (s.state !== "live") return {state: s.state, verification: s.verification, input: []};
      const now = clock();
      if (frame && now - s.lastFrame >= frameGap) {
        s.lastFrame = now;
        s.frame = frame;
        s.sequence += 1;
        s.bytes += frame.length;
        wake(s.frameWaiters);
      }
      return {state: s.state, input: s.pulls ? [] : drain(s)};
    },
    // Waits until a frame newer than after is stored, the session ends, or ms pass.
    waitFrame(s: Session, after: number, ms: number) {
      if (s.state !== "live" || s.sequence > after || !alive(s)) return Promise.resolve();
      return waitOn(s.frameWaiters, ms);
    },
    // Hands queued viewer input to the host as soon as there is any.
    async pull(s: Session, ms: number) {
      s.pulls = true;
      if (s.state === "live" && !s.input.length && alive(s)) await waitOn(s.inputWaiters, ms);
      return {state: s.state, input: s.state === "live" ? drain(s) : []};
    },
    enqueue(s: Session, item: DesklineInput) {
      const last = s.input.at(-1);
      if (item.kind === "release") s.input = [];
      if (item.kind === "move" && last?.item.kind === "move") s.input.pop();
      if (s.input.length >= 64) {
        s.input = [{item: {kind: "release"}, time: clock()}];
        wake(s.inputWaiters);
        return false;
      }
      s.input.push({item, time: clock()});
      wake(s.inputWaiters);
      return true;
    },
    // Admin console: every session and request on this relay.
    overview() {
      sweep();
      const sessions = new Map<string, Session>();
      for (const {session} of peers.values()) if (alive(session)) sessions.set(session.id, session);
      const list = [...sessions.values()];
      return {
        live: list.filter((s) => s.state !== "waiting").map(view),
        hosts: {
          unattended: list.filter((s) => s.preapproved).length,
          attended: list.filter((s) => !s.preapproved && s.state === "waiting").length,
        },
        requests: records.slice(0, 100).map(({code: _c, ...r}) => r),
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

  function drain(s: Session) {
    const now = clock();
    const queued = s.input.splice(0);
    // Drop old actions instead of replaying them after a stall. Ensure that
    // a dropped button-up cannot leave a mouse button held on the host.
    const stale = queued.some(({time}) => now - time > 1000);
    return stale ? [{kind: "release"} as DesklineInput] : queued.map(({item}) => item);
  }
}

function waitOn(set: Set<() => void>, ms: number) {
  return new Promise<void>((resolve) => {
    const done = () => { clearTimeout(timer); set.delete(done); resolve(); };
    const timer = setTimeout(done, ms);
    set.add(done);
  });
}

export type DesklineStore = ReturnType<typeof createDesklineStore>;
