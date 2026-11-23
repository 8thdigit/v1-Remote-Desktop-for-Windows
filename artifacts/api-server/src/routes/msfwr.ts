import { Router, raw, type Request, type Response } from "express";
import {
  GetMsfwrEventsQueryParams, JoinMsfwrBody, JoinMsfwrResponse, CreateMsfwrInviteResponse,
  SendMsfwrInputBody, RegisterMsfwrStandingBody, RegisterMsfwrStandingResponse, CallMsfwrBody, ListMsfwrCallsBody, ListMsfwrCallsResponse, TickMsfwrResponse, GetMsfwrFrameQueryParams,
  CreateMsfwrLinkBody, CreateMsfwrLinkResponse, RegisterMsfwrLinkBody, RegisterMsfwrLinkResponse, GetMsfwrLinkStatusQueryParams, GetMsfwrLinkStatusResponse, RevokeMsfwrLinkBody,
  GetMsfwrLinkInfoQueryParams, GetMsfwrLinkInfoResponse, JoinMsfwrLinkBody, JoinMsfwrLinkResponse,
  GetMsfwrInboxResponse, AcceptMsfwrRequestBody, AcceptMsfwrRequestResponse, ConnectMsfwrPcBody, ConnectMsfwrPcResponse,
} from "@workspace/api-zod";
import { decodeUpdates, encodeFrames, formatRaId, normalizeRaId, streamRecord, viewQualities, type Session, type ViewQuality } from "../lib/msfwr";
import { accountsReady, activity, connectGateForRa, gateForRa, linkLogReady, linkRegister, operatorOf, requireUser, sendError, store } from "../lib/portal";
import { keyedLimiter } from "../lib/security";

// Per-PC registration limiter, on top of the global throttle: bounds how fast
// one unattended key can re-register, so a single client cannot flood the
// relay or a company's gate checks.
const standingByKey = keyedLimiter(40, 60_000);

const router = Router();

function throttle(max: number) {
  let since = 0;
  let count = 0;
  return () => {
    const now = Date.now();
    if (now - since >= 60_000) { since = now; count = 0; }
    return ++count > max;
  };
}
const tooManyInvites = throttle(90);
const tooManyJoins = throttle(240);
const tooManyStanding = throttle(240);
const tooManyCallChecks = throttle(1200);
const tooManyLinkJoins = throttle(120);

// Checks an RA ID a PC names. "none" when it names none, "unknown" when no
// active company has it (the PC is told, so its user can fix the ID).
async function lookupRa(value: string | undefined) {
  if (!value?.trim()) return {status: "none" as const};
  const ra = normalizeRaId(value);
  const owner = ra ? (await accountsReady()).findRa(ra) : undefined;
  if (!ra || !owner) return {status: "unknown" as const};
  return {status: "ok" as const, ra, name: owner.displayName};
}

function auth(req: Request, res: Response, role?: "host" | "viewer") {
  const found = store.authenticate(req.get("authorization"), role);
  if (!found) res.status(410).json({error: "This session ended or expired. Ask for a new code."});
  return found;
}
router.use((_req, res, next) => {
  res.set({"Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff"});
  next();
});
router.post("/invite", (_req, res) => {
  const invite = !tooManyInvites() && store.invite();
  if (!invite) { res.status(429).json({error: "Relay busy. Try again in a minute."}); return; }
  res.status(201).json(CreateMsfwrInviteResponse.parse(invite));
});
router.post("/standing", async (req, res) => {
  if (tooManyStanding()) { res.status(429).json({error: "Relay busy. Try again in a minute."}); return; }
  const body = RegisterMsfwrStandingBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({error: "Invalid unattended access key."}); return; }
  if (standingByKey.hit(body.data.key)) { res.status(429).json({error: "This PC is registering too often. Try again in a minute."}); return; }
  const ra = await lookupRa(body.data.ra);
  // Enforce the company's subscription: a PC pointing to a company whose
  // subscription is expired, suspended or over quota is refused, so the
  // client cannot serve sessions. Companies with no subscription on record,
  // and PCs with no RA ID, are not gated.
  const license = typeof req.body?.license === "string" ? req.body.license : undefined;
  const gate = ra.status === "ok" ? await gateForRa(ra.ra, license) : { ok: true, status: "none" as const };
  if (!gate.ok) {
    res.status(402).json({ error: gate.message, subStatus: gate.status, reason: gate.reason });
    return;
  }
  const standing = store.standing(body.data.key, body.data.name, ra.status === "ok" ? ra.ra : undefined);
  if (!standing) { res.status(409).json({error: "Relay busy, or the code is in use by another session."}); return; }
  const base = RegisterMsfwrStandingResponse.parse({...standing, raStatus: ra.status, ...(ra.status === "ok" ? {raName: ra.name} : {})});
  // The subscription status travels back with the registration so the client
  // can show it. "none" means the company is not gated.
  res.status(201).json({ ...base, subStatus: gate.status });
});
router.post("/call", async (req, res) => {
  const s = auth(req, res, "host");
  if (!s) return;
  const body = CallMsfwrBody.safeParse(req.body ?? {});
  if (!body.success) { res.status(400).json({error: "Invalid request."}); return; }
  let ra = s.ra;
  if (body.data.ra?.trim()) {
    const found = await lookupRa(body.data.ra);
    // 422 tells the PC that the RA ID it was given does not belong to any company.
    if (found.status !== "ok") { res.status(422).json({error: "No active company has that RA ID."}); return; }
    ra = found.ra;
  }
  // Refuse Initiate for a company whose subscription is not active.
  if (ra) {
    const gate = await gateForRa(ra);
    if (!gate.ok) { res.status(402).json({ error: gate.message, subStatus: gate.status, reason: gate.reason }); return; }
  }
  const fresh = !s.call || s.call.until <= Date.now() || s.call.ra !== ra;
  if (!store.call(s, body.data.name ?? "", undefined, ra)) { res.status(409).json({error: "Only a waiting host can initiate."}); return; }
  if (fresh) activity.add("request", `${s.call?.name || "A PC"} asked IT to connect${ra ? ` (${formatRaId(ra)})` : ""}`);
  res.sendStatus(204);
});
// --- Signed-in companies: requests and PCs for their RA ID ---
router.get("/inbox", requireUser(), async (req, res) => {
  const user = req.account!;
  try {
    // The company's current Access PIN (a new one every few minutes until it
    // is used) and the remote access URLs it has authored.
    // A company that cannot start sessions (quota reached, expired or
    // suspended) gets no Access PIN, so no new URL can be authorized with it.
    const gate = await connectGateForRa(user.raId);
    let pin;
    if (gate.ok) pin = store.companyPin({id: user.id, name: user.displayName, raId: user.raId});
    else store.dropCompanyPin(user.id);
    const links = await linkRegister({accountId: user.id});
    const inbox = GetMsfwrInboxResponse.parse({raId: user.raId, company: user.displayName, ...store.inbox(user.raId), accessPin: pin, links});
    res.json(gate.ok ? inbox : {...inbox, pinBlocked: {reason: gate.reason ?? "inactive", message: gate.message ?? ""}});
  } catch (err) { sendError(res, err); }
});
router.post("/accept", requireUser(), async (req, res) => {
  if (tooManyJoins()) { res.status(429).json({error: "Too many attempts. Try again in a minute."}); return; }
  const body = AcceptMsfwrRequestBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({error: "Invalid request."}); return; }
  const user = req.account!;
  // Enforce this company's subscription at the moment a session starts, so a
  // company that is inactive, expired, suspended or over its quota cannot open
  // a new session even while a PC is still registered.
  const gate = await connectGateForRa(user.raId);
  if (!gate.ok) { res.status(402).json({error: gate.message, subStatus: gate.status, reason: gate.reason}); return; }
  const result = store.accept(body.data.id, operatorOf(user));
  if (!result.viewer) {
    res.status(result.error === "accepted" ? 409 : 404).json({error: result.error === "accepted"
      ? "This request was already accepted."
      : "This request is no longer open. The PC may have gone offline or the request timed out."});
    return;
  }
  activity.add("accept", `${user.displayName} (${formatRaId(user.raId)}) accepted a request and connected`, user.username);
  res.json(AcceptMsfwrRequestResponse.parse(result.viewer));
});
router.post("/connect", requireUser(), async (req, res) => {
  if (tooManyJoins()) { res.status(429).json({error: "Too many attempts. Try again in a minute."}); return; }
  const body = ConnectMsfwrPcBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({error: "Invalid request."}); return; }
  const user = req.account!;
  const gate = await connectGateForRa(user.raId);
  if (!gate.ok) { res.status(402).json({error: gate.message, subStatus: gate.status, reason: gate.reason}); return; }
  const viewer = store.connectPc(body.data.pc, operatorOf(user));
  if (!viewer) { res.status(404).json({error: "That PC is not available right now. It may be offline, locked, or already in a session."}); return; }
  activity.add("connect", `${user.displayName} (${formatRaId(user.raId)}) connected to a PC`, user.username);
  res.json(ConnectMsfwrPcResponse.parse(viewer));
});
router.post("/calls", requireUser(), (req, res) => {
  if (tooManyCallChecks()) { res.status(429).json({error: "Too many checks. Try again in a minute."}); return; }
  const body = ListMsfwrCallsBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({error: "Send up to 50 saved access codes."}); return; }
  res.json(ListMsfwrCallsResponse.parse({calls: store.calls(body.data.codes), presence: store.presence(body.data.codes)}));
});
// --- Remote access links (created from the client app) ---
router.post("/link/create", (req, res) => {
  if (tooManyStanding()) { res.status(429).json({error: "Relay busy. Try again in a minute."}); return; }
  const body = CreateMsfwrLinkBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({error: "Invalid unattended access key."}); return; }
  const link = store.linkCreate(body.data.key, body.data.name ?? "", body.data.ttlHours);
  if (!link) { res.status(409).json({error: "Relay busy. Try again in a minute."}); return; }
  activity.add("link", `${link.name || "A PC"} created a remote access URL (${link.ttlHours} h)`);
  res.status(201).json(CreateMsfwrLinkResponse.parse(link));
});
// The PC sends its saved link again whenever it registers, so the link is
// restored if the relay restarted.
router.post("/link/register", (req, res) => {
  if (tooManyStanding()) { res.status(429).json({error: "Relay busy. Try again in a minute."}); return; }
  const body = RegisterMsfwrLinkBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({error: "Invalid link registration."}); return; }
  const link = store.linkRestore(body.data);
  if (!link) { res.status(410).json({error: "This remote access URL expired or was cleared."}); return; }
  res.status(201).json(RegisterMsfwrLinkResponse.parse(link));
});
router.get("/link/status", (req, res) => {
  const query = GetMsfwrLinkStatusQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({error: "Invalid link lookup."}); return; }
  const status = store.linkStatus(query.data.id, query.data.key);
  if (!status) { res.status(404).json({error: "Link not found, expired, or cleared."}); return; }
  res.json(GetMsfwrLinkStatusResponse.parse(status));
});
router.post("/link/revoke", (req, res) => {
  const body = RevokeMsfwrLinkBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({error: "Invalid link revocation."}); return; }
  if (!store.linkRevoke(body.data.id, body.data.key)) { res.status(404).json({error: "Link not found, expired, or cleared."}); return; }
  res.sendStatus(204);
});
// Public: the page a shared link opens reads this, then asks for the access code.
router.get("/link/info", (req, res) => {
  const query = GetMsfwrLinkInfoQueryParams.safeParse({code: String(req.query["code"] ?? "").toUpperCase()});
  if (!query.success) { res.status(400).json({error: "That is not a remote access URL."}); return; }
  const info = store.linkInfo(query.data.code);
  if (!info) { res.status(404).json({error: "This remote access URL expired or was cleared on the PC."}); return; }
  res.json(GetMsfwrLinkInfoResponse.parse(info));
});
router.post("/link/join", async (req, res) => {
  if (tooManyLinkJoins()) { res.status(429).json({error: "Too many attempts. Try again in a minute."}); return; }
  const body = JoinMsfwrLinkBody.safeParse({...req.body, code: String(req.body?.code ?? "").toUpperCase()});
  if (!body.success) { res.status(400).json({error: "Enter the access code that came with the link."}); return; }
  // URL claims are restored from the register; make sure it is loaded.
  let accounts;
  try { accounts = await accountsReady(); await linkLogReady(); } catch { res.status(503).json({error: "The relay is starting. Try again in a moment."}); return; }
  // The company whose PIN this is authors the session, so its account must be
  // enabled and its subscription is what the session counts against.
  const author = store.linkAuthor(body.data.code, body.data.accessPin);
  if (author) {
    const account = accounts.get(author.accountId);
    if (!account || account.disabled) { res.status(403).json({error: "The company that issued this Access PIN can no longer authorize sessions."}); return; }
    const gate = await connectGateForRa(author.raId);
    if (!gate.ok) { res.status(402).json({error: gate.message, subStatus: gate.status, reason: gate.reason}); return; }
  }
  const result = store.linkJoin(body.data.code, body.data.pin, body.data.accessPin, {ip: req.ip, agent: req.get("user-agent")});
  if (!result.viewer) {
    const answers = {
      missing: [404, "This remote access URL expired or was cleared on the PC."],
      locked: [429, "Too many wrong access codes. This link is locked for 15 minutes."],
      pin: [403, "That access code is not correct."],
      "access-pin-required": [403, "Enter the 4-digit Access PIN from the company that is supporting you."],
      "access-pin": [403, "That Access PIN is not correct or has expired. Ask the company for its current PIN."],
      blocked: [423, "Too many wrong Access PINs. This URL no longer works. Ask the person at the PC to create a new one."],
      offline: [409, "The PC is offline or locked right now. Try again when it is on and signed in."],
      busy: [409, "Someone is already connected to this PC. Try again when that session ends."],
      full: [409, "Too many people are connected to this PC through its URL. Try again later."],
    } as const;
    const [status, error] = answers[result.error];
    res.status(status).json({error});
    return;
  }
  if (result.claimed) activity.add("link-claim", `${result.claim.company} (${formatRaId(result.claim.raId)}) authorized the remote access URL of ${result.name || "a PC"} with PIN ${result.claim.pin}`);
  activity.add("link-join", `Someone connected to ${result.name || "a PC"} through its remote access URL, authorized by ${result.claim.company}`);
  res.json(JoinMsfwrLinkResponse.parse(result.viewer));
});
router.post("/join", requireUser(), async (req, res) => {
  if (tooManyJoins()) { res.status(429).json({error: "Too many attempts. Try again in a minute."}); return; }
  const body = JoinMsfwrBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({error: "Enter a 12-character code from the host."}); return; }
  const user = req.account!;
  const gate = await connectGateForRa(user.raId);
  if (!gate.ok) { res.status(402).json({error: gate.message, subStatus: gate.status, reason: gate.reason}); return; }
  const viewer = store.join(body.data.code, operatorOf(user));
  if (!viewer) { res.status(404).json({error: "Code not found, already used, or expired."}); return; }
  activity.add("join", `${user.displayName} connected with ${viewer.preapproved ? "an unattended access code" : "a one-time code"}`, user.username);
  res.json(JoinMsfwrResponse.parse(viewer));
});
router.post("/approve", (req, res) => {
  const s = auth(req, res, "host");
  if (!s) return;
  if (!store.approve(s)) { res.status(409).json({error: "No viewer is waiting for approval."}); return; }
  res.sendStatus(204);
});
router.post("/end", (req, res) => {
  const s = auth(req, res);
  if (!s) return;
  const live = s.state === "live";
  if (store.leave(s, req.headers.authorization) && live) {
    activity.add("end", `Session ${s.name ? `with ${s.name} ` : ""}ended${s.operator ? ` (${s.operator.name})` : ""}`);
  }
  res.sendStatus(204);
});
// Holds a long-polling request until ready() is true, the session ends, the
// client goes away, or ms pass; then calls done() once (unless the client left).
function hold(res: Response, s: Session, ready: () => boolean, ms: number, done: () => void) {
  if (s.closed || ready() || ms <= 0) { done(); return; }
  let over = false;
  const stop = () => { over = true; clearTimeout(timer); unwatch(); };
  const finish = () => { if (!over) { stop(); done(); } };
  // Checked on the next turn, so a batch of input or updates goes out whole.
  const unwatch = store.watch(s, () => setImmediate(() => { if (s.closed || ready()) finish(); }));
  const timer = setTimeout(finish, ms);
  res.on("close", () => { if (!over) stop(); });
}
const gone = (res: Response) => res.status(410).json({error: "This session ended or expired. Ask for a new code."});

// A request number from a client that keeps several requests in flight.
function sequenceOf(req: Request) {
  const value = req.get("x-msfwr-seq");
  return value && /^\d{1,9}$/.test(value) ? Number(value) : undefined;
}

// How long one streaming response lasts before the client opens the next,
// and how often it carries a heartbeat (which also keeps the peer counted
// as connected).
export const streamMs = 25_000;
const beatMs = 2_000;

// Streams to one client until the session ends, the client leaves, or
// streamMs pass. push() writes whatever is new; it runs at the start, when
// the session changes, and when a slow client has taken what was written.
// beat() writes a heartbeat. close() writes the final record.
function stream(req: Request, res: Response, s: Session, role: "host" | "viewer", type: string,
  handlers: { push: (write: (b: Buffer | string) => void) => void; beat: () => Buffer | string; close: (ended: boolean) => Buffer | string }) {
  res.status(200).set({
    "Content-Type": type, "Cache-Control": "no-store, no-transform, private",
    "X-Accel-Buffering": "no", "X-Msfwr-State": s.state, "X-Msfwr-Stream": "1",
  });
  res.flushHeaders();
  req.socket.setNoDelay(true);
  const header = req.get("authorization");
  let over = false;
  let busy = false;
  const write = (b: Buffer | string) => {
    if (over) return;
    if (!res.write(b)) {
      busy = true;
      res.once("drain", () => { busy = false; push(); });
    }
  };
  const stop = () => { over = true; clearInterval(beat); clearTimeout(timer); unwatch(); };
  const finish = (ended: boolean) => {
    if (over) return;
    write(handlers.close(ended));
    stop();
    res.end();
  };
  const push = () => {
    if (over || busy) return;
    if (s.closed) { finish(true); return; }
    handlers.push(write);
  };
  const beat = setInterval(() => {
    if (!store.authenticate(header, role)) { finish(true); return; }
    if (!busy) write(handlers.beat());
  }, beatMs);
  const timer = setTimeout(() => finish(false), streamMs);
  const unwatch = store.watch(s, () => setImmediate(push));
  res.on("close", () => { if (!over) stop(); });
  push();
}

// Host heartbeat. The body is a bare JPEG (a keyframe; older hosts) or, as
// application/x-msfwr-frames, a list of keyframes and changed regions. A host
// that reads input from /events sends X-Msfwr-Events: 1. The reply's
// "patches" says this relay accepts changed regions; "key" asks for a keyframe.
router.post("/tick",
  raw({type: "image/jpeg", limit: "768kb", inflate: false}),
  raw({type: "application/x-msfwr-frames", limit: "1536kb", inflate: false}),
  (req, res) => {
    const s = auth(req, res, "host");
    if (!s) return;
    const body: unknown = req.body;
    let frame: Buffer | ReturnType<typeof decodeUpdates>;
    if (Buffer.isBuffer(body) && req.is("application/x-msfwr-frames")) {
      frame = decodeUpdates(body);
      if (!frame) { res.status(400).json({error: "Expected screen updates."}); return; }
    } else if (body !== undefined) {
      if (!Buffer.isBuffer(body) || body.length < 4 || body.readUInt16BE(0) !== 0xffd8 || body.readUInt16BE(body.length - 2) !== 0xffd9) {
        res.status(400).json({error: "Expected a binary JPEG frame."}); return;
      }
      frame = body;
    }
    if (frame && s.state !== "live") {
      res.status(409).json({error: "No screen can be uploaded before host approval."}); return;
    }
    const events = req.get("x-msfwr-events") === "1";
    const seq = sequenceOf(req);
    const reply = seq === undefined ? store.tick(s, frame, events) : store.tickInOrder(s, seq, frame, events);
    // "pipeline": the host may number its ticks and keep several in flight.
    // "quality": the picture quality the viewer asked for.
    res.json({...TickMsfwrResponse.parse(reply), patches: true, pipeline: true, stream: true,
      ...("key" in reply ? {key: true} : {}), ...(s.quality ? {quality: s.quality} : {})});
  });
// The host's input channel: waits up to `wait` ms for viewer input, so input
// reaches the PC one round trip after it is sent instead of on the next tick.
router.get("/events", (req, res) => {
  const s = auth(req, res, "host");
  if (!s) return;
  if (req.query.stream === "1") {
    // Streaming input: one JSON line per batch, the moment it arrives, so
    // input never waits for the host to ask again. A heartbeat line every
    // two seconds; {"end": true} when the stream closes (with state
    // "ended" when the session is over).
    const line = (v: unknown) => JSON.stringify(v) + "\n";
    stream(req, res, s, "host", "application/x-ndjson", {
      push: (write) => {
        if (s.state !== "live") { write(line({state: s.state, input: []})); return; }
        if (s.input.length) write(line(TickMsfwrResponse.parse({state: s.state, input: store.takeInput(s)})));
      },
      beat: () => line({state: s.state, input: []}),
      close: (ended) => line({state: ended ? "ended" : s.state, input: [], end: true}),
    });
    return;
  }
  const query = GetMsfwrEventsQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({error: "Invalid wait."}); return; }
  const ready = () => s.state !== "live" || s.input.length > 0;
  hold(res, s, ready, query.data.wait ?? 0, () => {
    if (s.closed) { gone(res); return; }
    res.json(TickMsfwrResponse.parse({state: s.state, input: s.state === "live" ? store.takeInput(s) : []}));
  });
});
// Viewers read the screen here. With v=2 the reply holds up to `wait` ms for
// something newer than `after`, and carries every update the viewer is
// missing (see encodeFrames). Without it, the latest keyframe as a JPEG.
router.get("/frame", (req, res) => {
  const s = auth(req, res, "viewer");
  if (!s) return;
  if (req.query.v === "3") {
    // Streaming screen: records as in encodeFrames, written the moment the
    // host uploads them, plus state records (kind 2) as heartbeats and a
    // closing record (kind 3). A viewer that reads slowly gets what it
    // missed in one go once it catches up.
    const after = Number(req.query.after ?? 0);
    if (!Number.isSafeInteger(after) || after < 0) { res.status(400).json({error: "Invalid frame sequence."}); return; }
    let sent = after;
    let shown = "";
    stream(req, res, s, "viewer", "application/x-msfwr-stream", {
      push: (write) => {
        if (s.state !== shown) { shown = s.state; write(streamRecord(2, s.state)); }
        if (s.state !== "live") return;
        const items = store.updatesAfter(s, sent);
        if (!items.length) return;
        sent = items.at(-1)!.sequence;
        write(encodeFrames(items));
      },
      beat: () => streamRecord(2, s.state),
      close: (ended) => ended ? streamRecord(2, "ended") : streamRecord(3),
    });
    return;
  }
  const query = GetMsfwrFrameQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({error: "Invalid frame sequence."}); return; }
  const after = query.data.after ?? 0;
  if (query.data.v !== 2) {
    res.set("X-Msfwr-State", s.state);
    const key = s.keySequence ?? s.sequence;
    if (s.state !== "live" || !s.frame || key <= after) { res.sendStatus(204); return; }
    res.set("X-Msfwr-Frame", String(key));
    res.type("image/jpeg").send(s.frame);
    return;
  }
  const state = s.state;
  const ready = () => s.state !== state || (s.state === "live" && s.sequence > after && !!s.frame);
  hold(res, s, ready, query.data.wait ?? 0, () => {
    if (s.closed) { gone(res); return; }
    res.set({"X-Msfwr-State": s.state, "X-Msfwr-Batch": "1"});
    const items = s.state === "live" ? store.updatesAfter(s, after) : [];
    if (!items.length) { res.sendStatus(204); return; }
    res.set("X-Msfwr-Frame", String(items.at(-1)!.sequence));
    res.type("application/x-msfwr-frames").send(encodeFrames(items));
  });
});
// Remote input from a viewer: one action, or (with X-Msfwr-Batch) an array
// of up to 32 sent together.
router.post("/input", (req, res) => {
  const s = auth(req, res, "viewer");
  if (!s) return;
  if (s.state !== "live") { res.status(409).json({error: "Wait for the host to approve the session."}); return; }
  const list: unknown[] = Array.isArray(req.body) ? req.body : [req.body];
  if (!list.length || list.length > 32) { res.status(400).json({error: "Invalid remote input."}); return; }
  const actions = [];
  for (const item of list) {
    const parsed = SendMsfwrInputBody.safeParse(item);
    if (!parsed.success) { res.status(400).json({error: "Invalid remote input."}); return; }
    const a = parsed.data;
    if ((["move", "down", "up", "wheel"].includes(a.kind) && (a.x === undefined || a.y === undefined)) ||
        ((a.kind === "down" || a.kind === "up") && a.button === undefined) ||
        (a.kind === "wheel" && a.delta === undefined) ||
        (a.kind === "key" && !a.key)) {
      res.status(400).json({error: "Incomplete remote input."}); return;
    }
    actions.push(a);
  }
  const seq = sequenceOf(req);
  if (seq !== undefined) {
    if (!store.enqueueInOrder(s, req.get("authorization") ?? "", seq, actions)) { res.status(429).json({error: "Remote input was too fast."}); return; }
    res.sendStatus(204);
    return;
  }
  for (const a of actions) {
    if (!store.enqueue(s, a)) { res.status(429).json({error: "Remote input was too fast."}); return; }
  }
  res.sendStatus(204);
});
// A viewer picks the picture quality; the host applies it on its next tick.
router.post("/view", (req, res) => {
  const s = auth(req, res, "viewer");
  if (!s) return;
  const quality: unknown = req.body?.quality;
  if (typeof quality !== "string" || !viewQualities.includes(quality as ViewQuality)) {
    res.status(400).json({error: "Invalid picture quality."}); return;
  }
  store.setQuality(s, quality as ViewQuality);
  res.sendStatus(204);
});

export default router;
