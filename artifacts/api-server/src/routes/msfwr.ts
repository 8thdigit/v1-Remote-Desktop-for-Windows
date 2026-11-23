import { Router, raw, type Request, type Response } from "express";
import {
  JoinMsfwrBody, JoinMsfwrResponse, CreateMsfwrInviteResponse,
  SendMsfwrInputBody, RegisterMsfwrStandingBody, RegisterMsfwrStandingResponse, CallMsfwrBody, ListMsfwrCallsBody, ListMsfwrCallsResponse, TickMsfwrResponse, GetMsfwrFrameQueryParams,
  CreateMsfwrLinkBody, CreateMsfwrLinkResponse, RegisterMsfwrLinkBody, RegisterMsfwrLinkResponse, GetMsfwrLinkStatusQueryParams, GetMsfwrLinkStatusResponse, RevokeMsfwrLinkBody,
  GetMsfwrLinkInfoQueryParams, GetMsfwrLinkInfoResponse, JoinMsfwrLinkBody, JoinMsfwrLinkResponse,
  GetMsfwrInboxResponse, AcceptMsfwrRequestBody, AcceptMsfwrRequestResponse, ConnectMsfwrPcBody, ConnectMsfwrPcResponse,
} from "@workspace/api-zod";
import { formatRaId, normalizeRaId } from "../lib/msfwr";
import { accountsReady, activity, connectGateForRa, gateForRa, operatorOf, requireUser, store } from "../lib/portal";
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
router.get("/inbox", requireUser(), (req, res) => {
  const user = req.account!;
  res.json(GetMsfwrInboxResponse.parse({raId: user.raId, company: user.displayName, ...store.inbox(user.raId), links: store.companyLinks(user.raId)}));
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
  // Access PINs come from the accounts' persistent secret; make sure it is loaded.
  try { await accountsReady(); } catch { res.status(503).json({error: "The relay is starting. Try again in a moment."}); return; }
  // Enforce the PC's company subscription before opening a session through the
  // link, so an inactive or over-quota company's shared URLs stop working too.
  const ra = store.linkHostRa(body.data.code);
  if (ra) {
    const gate = await connectGateForRa(ra);
    if (!gate.ok) { res.status(402).json({error: gate.message, subStatus: gate.status, reason: gate.reason}); return; }
  }
  const result = store.linkJoin(body.data.code, body.data.pin, body.data.accessPin);
  if (!result.viewer) {
    const answers = {
      missing: [404, "This remote access URL expired or was cleared on the PC."],
      locked: [429, "Too many wrong access codes. This link is locked for 15 minutes."],
      pin: [403, "That access code is not correct."],
      "access-pin-required": [403, "Enter the 4-digit Access PIN. Ask the company that manages this PC for it."],
      "access-pin": [403, "That Access PIN is not correct. Ask the company that manages this PC for the current PIN."],
      blocked: [423, "Too many wrong Access PINs. This URL no longer works. Ask the person at the PC to create a new one."],
      offline: [409, "The PC is offline or locked right now. Try again when it is on and signed in."],
      busy: [409, "Someone is already connected to this PC. Try again when that session ends."],
      full: [409, "Too many people are connected to this PC through its URL. Try again later."],
    } as const;
    const [status, error] = answers[result.error];
    res.status(status).json({error});
    return;
  }
  activity.add("link-join", `Someone connected to ${result.name || "a PC"} through its remote access URL`);
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
router.post("/tick", raw({type:"image/jpeg", limit:"768kb", inflate:false}), (req, res) => {
  const s = auth(req, res, "host");
  if (!s) return;
  const frame: unknown = req.body;
  if (frame !== undefined && (!Buffer.isBuffer(frame) || frame.length < 4 || frame.readUInt16BE(0) !== 0xffd8 || frame.readUInt16BE(frame.length - 2) !== 0xffd9)) {
    res.status(400).json({error: "Expected a binary JPEG frame."}); return;
  }
  if (frame && s.state !== "live") {
    res.status(409).json({error: "No screen can be uploaded before host approval."}); return;
  }
  res.json(TickMsfwrResponse.parse(store.tick(s, frame)));
});
router.get("/frame", (req, res) => {
  const s = auth(req, res, "viewer");
  if (!s) return;
  const query = GetMsfwrFrameQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({error: "Invalid frame sequence."}); return; }
  res.set("X-Msfwr-State", s.state);
  if (s.state !== "live" || !s.frame || s.sequence <= (query.data.after ?? 0)) { res.sendStatus(204); return; }
  res.set("X-Msfwr-Frame", String(s.sequence));
  res.type("image/jpeg").send(s.frame);
});
router.post("/input", (req, res) => {
  const s = auth(req, res, "viewer");
  if (!s) return;
  if (s.state !== "live") { res.status(409).json({error: "Wait for the host to approve the session."}); return; }
  const parsed = SendMsfwrInputBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({error: "Invalid remote input."}); return; }
  const a = parsed.data;
  if ((["move", "down", "up", "wheel"].includes(a.kind) && (a.x === undefined || a.y === undefined)) ||
      ((a.kind === "down" || a.kind === "up") && a.button === undefined) ||
      (a.kind === "wheel" && a.delta === undefined) ||
      (a.kind === "key" && !a.key)) {
    res.status(400).json({error: "Incomplete remote input."}); return;
  }
  if (!store.enqueue(s, a)) { res.status(429).json({error: "Remote input was too fast."}); return; }
  res.sendStatus(204);
});

export default router;
