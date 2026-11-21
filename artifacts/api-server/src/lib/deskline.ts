import { randomBytes, randomInt } from "node:crypto";
import type { DesklineInput } from "@workspace/api-zod";

const inviteTTL = 3 * 60_000;
const sessionTTL = 30 * 60_000;
const peerTTL = 20_000;

export type Session = {
  code: string;
  host: string;
  viewer?: string;
  viewerSession?: string;
  verification?: string;
  state: "waiting" | "pending" | "live";
  expires: number;
  hostSeen: number;
  viewerSeen: number;
  frame?: Buffer;
  sequence: number;
  lastFrame: number;
  input: { item: DesklineInput; time: number }[];
};

export function createDesklineStore(clock = Date.now) {
  const codes = new Map<string, Session>();
  const peers = new Map<string, { session: Session; role: "host" | "viewer" }>();
  const end = (s: Session) => {
    codes.delete(s.code);
    peers.delete(s.host);
    if (s.viewer) peers.delete(s.viewer);
    s.frame = undefined;
    s.input = [];
  };
  const expired = (s: Session) => {
    const now = clock();
    return s.expires <= now || now - s.hostSeen > peerTTL ||
      (!!s.viewer && now - s.viewerSeen > peerTTL);
  };
  const sweep = () => {
    for (const {session, role} of peers.values()) {
      if (role === "host" && expired(session)) end(session);
    }
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
        code, host, state: "waiting", expires: now + inviteTTL,
        hostSeen: now, viewerSeen: 0, sequence: 0, lastFrame: 0, input: [],
      };
      codes.set(code, session);
      peers.set(host, {session, role: "host"});
      return {code, token: host};
    },
    join(code: string, browserSession: string) {
      const s = codes.get(code);
      if (!s || expired(s) || s.state !== "waiting") return;
      codes.delete(code);
      const token = randomBytes(32).toString("base64url");
      const verification = String(randomInt(100000, 1000000));
      s.viewer = token;
      s.viewerSession = browserSession;
      s.verification = verification;
      s.state = "pending";
      s.viewerSeen = clock();
      peers.set(token, {session: s, role: "viewer"});
      return {token, verification};
    },
    authenticate(header: string | undefined, role?: "host" | "viewer", viewerSession?: string) {
      const token = /^Bearer ([\w-]{43})$/.exec(header ?? "")?.[1];
      const peer = token && peers.get(token);
      if (!peer) return;
      const {session: s} = peer;
      if (expired(s)) { end(s); return; }
      if (role && role !== peer.role) return;
      if (peer.role === "viewer" && (!viewerSession || viewerSession !== s.viewerSession)) return;
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
      const input: DesklineInput[] = stale ? [{kind:"release"}] : queued.map(({item}) => item);
      return {state: s.state, input};
    },
    enqueue(s: Session, item: DesklineInput) {
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
