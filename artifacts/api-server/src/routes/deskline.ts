import { Router, raw, type Request, type Response } from "express";
import {
  JoinDesklineBody, JoinDesklineResponse, CreateDesklineInviteResponse,
  SendDesklineInputBody, SendDesklineInputsBody, RegisterDesklineStandingBody, RegisterDesklineStandingResponse, CallDesklineBody,
  ListDesklineCallsBody, ListDesklineCallsResponse, TickDesklineResponse, GetDesklineFrameQueryParams, AcceptDesklineRequestBody,
  GetDesklineInboxResponse, type DesklineInput,
} from "@workspace/api-zod";
import { formatRaId, normalizeRaId } from "../lib/accounts";
import { accountsReady, activity, operatorOf, requireUser, store } from "../lib/portal";

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

// Resolves when the client goes away, so a long poll stops waiting.
function closed(req: Request) {
  return new Promise<void>((resolve) => req.once("close", () => resolve()));
}

function validInput(a: DesklineInput) {
  return !((["move", "down", "up", "wheel"].includes(a.kind) && (a.x === undefined || a.y === undefined)) ||
    ((a.kind === "down" || a.kind === "up") && a.button === undefined) ||
    (a.kind === "wheel" && a.delta === undefined) ||
    (a.kind === "key" && !a.key));
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
  res.status(201).json(CreateDesklineInviteResponse.parse(invite));
});
router.post("/standing", (req, res) => {
  if (tooManyStanding()) { res.status(429).json({error: "Relay busy. Try again in a minute."}); return; }
  const body = RegisterDesklineStandingBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({error: "Invalid unattended access key."}); return; }
  const standing = store.standing(body.data.key, body.data.name);
  if (!standing) { res.status(409).json({error: "Relay busy, or the code is in use by another session."}); return; }
  res.status(201).json(RegisterDesklineStandingResponse.parse(standing));
});
router.post("/call", async (req, res) => {
  const s = auth(req, res, "host");
  if (!s) return;
  const body = CallDesklineBody.safeParse(req.body ?? {});
  if (!body.success) { res.status(400).json({error: "Invalid request."}); return; }
  let ra: string | undefined;
  if (body.data.ra?.trim()) {
    ra = normalizeRaId(body.data.ra);
    const accounts = await accountsReady();
    // 422 tells the PC that the RA ID it was given does not exist.
    if (!ra || !accounts.findRa(ra)) { res.status(422).json({error: "No active portal user has that RA ID."}); return; }
  }
  const fresh = !s.call || s.call.until <= Date.now() || s.call.ra !== ra;
  if (!store.call(s, body.data.name ?? "", undefined, ra)) { res.status(409).json({error: "Only a waiting host can initiate."}); return; }
  if (fresh) activity.add("request", `${s.call?.name || "A PC"} sent a${s.preapproved ? "n unattended" : "n attended"} request${ra ? ` to ${formatRaId(ra)}` : ""}`);
  res.sendStatus(204);
});
router.get("/inbox", requireUser(), (req, res) => {
  const user = req.account!;
  res.json(GetDesklineInboxResponse.parse({raId: user.raId, requests: store.inbox(user.raId)}));
});
router.post("/accept", requireUser(), (req, res) => {
  if (tooManyJoins()) { res.status(429).json({error: "Too many attempts. Try again in a minute."}); return; }
  const body = AcceptDesklineRequestBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({error: "Invalid request."}); return; }
  const user = req.account!;
  const result = store.accept(body.data.id, operatorOf(user));
  if (!result.viewer) {
    res.status(result.error === "accepted" ? 409 : 404).json({error: result.error === "accepted"
      ? "This request was already accepted."
      : "This request is no longer open. The PC may have cancelled it, gone offline, or timed out."});
    return;
  }
  activity.add("accept", `${user.displayName} (${formatRaId(user.raId)}) accepted a request and connected`, user.username);
  res.json(JoinDesklineResponse.parse(result.viewer));
});
router.post("/calls", requireUser(), (req, res) => {
  if (tooManyCallChecks()) { res.status(429).json({error: "Too many checks. Try again in a minute."}); return; }
  const body = ListDesklineCallsBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({error: "Send up to 50 saved access codes."}); return; }
  res.json(ListDesklineCallsResponse.parse({calls: store.calls(body.data.codes), presence: store.presence(body.data.codes)}));
});
router.post("/join", requireUser(), (req, res) => {
  if (tooManyJoins()) { res.status(429).json({error: "Too many attempts. Try again in a minute."}); return; }
  const body = JoinDesklineBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({error: "Enter a 12-character code from the host."}); return; }
  const user = req.account!;
  const viewer = store.join(body.data.code, operatorOf(user));
  if (!viewer) { res.status(404).json({error: "Code not found, already used, or expired."}); return; }
  activity.add("join", `${user.displayName} (${formatRaId(user.raId)}) connected with ${viewer.preapproved ? "an unattended access code" : "a one-time code"}`, user.username);
  res.json(JoinDesklineResponse.parse(viewer));
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
  if (s.state === "live" && s.operator) activity.add("end", `Session ${s.name ? `with ${s.name} ` : ""}ended (${s.operator.name})`, undefined);
  store.end(s);
  res.sendStatus(204);
});
router.post("/tick", raw({type:"image/jpeg", limit:"1536kb", inflate:false}), (req, res) => {
  const s = auth(req, res, "host");
  if (!s) return;
  const frame: unknown = req.body;
  if (frame !== undefined && (!Buffer.isBuffer(frame) || frame.length < 4 || frame.readUInt16BE(0) !== 0xffd8 || frame.readUInt16BE(frame.length - 2) !== 0xffd9)) {
    res.status(400).json({error: "Expected a binary JPEG frame."}); return;
  }
  if (frame && s.state !== "live") {
    res.status(409).json({error: "No screen can be uploaded before host approval."}); return;
  }
  res.json(TickDesklineResponse.parse(store.tick(s, frame, req.get("x-deskline-pull") === "1")));
});
// The host waits here for viewer input, so a click reaches the PC without
// waiting for the next screen upload.
router.post("/pull", async (req, res) => {
  const s = auth(req, res, "host");
  if (!s) return;
  const result = await Promise.race([store.pull(s, 10_000), closed(req).then(() => undefined)]);
  if (!result || res.writableEnded) return;
  res.json(TickDesklineResponse.parse(result));
});
router.get("/frame", async (req, res) => {
  const s = auth(req, res, "viewer");
  if (!s) return;
  const query = GetDesklineFrameQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({error: "Invalid frame sequence."}); return; }
  // Long poll: hold the request until the host uploads a newer frame.
  const wait = query.data.wait ?? 0;
  if (wait > 0) {
    await Promise.race([store.waitFrame(s, query.data.after ?? 0, wait), closed(req)]);
    if (res.writableEnded || req.destroyed) return;
    if (!store.authenticate(req.get("authorization"), "viewer")) { res.status(410).json({error: "This session ended or expired."}); return; }
  }
  res.set("X-Deskline-State", s.state);
  if (s.state !== "live" || !s.frame || s.sequence <= (query.data.after ?? 0)) { res.sendStatus(204); return; }
  res.set("X-Deskline-Frame", String(s.sequence));
  res.type("image/jpeg").send(s.frame);
});
router.post("/input", (req, res) => {
  const s = auth(req, res, "viewer");
  if (!s) return;
  if (s.state !== "live") { res.status(409).json({error: "Wait for the host to approve the session."}); return; }
  const parsed = SendDesklineInputBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({error: "Invalid remote input."}); return; }
  const a = parsed.data;
  if (!validInput(a)) { res.status(400).json({error: "Incomplete remote input."}); return; }
  if (!store.enqueue(s, a)) { res.status(429).json({error: "Remote input was too fast."}); return; }
  res.sendStatus(204);
});
router.post("/inputs", (req, res) => {
  const s = auth(req, res, "viewer");
  if (!s) return;
  if (s.state !== "live") { res.status(409).json({error: "Wait for the host to approve the session."}); return; }
  const parsed = SendDesklineInputsBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.items.every(validInput)) { res.status(400).json({error: "Invalid remote input."}); return; }
  for (const a of parsed.data.items) {
    if (!store.enqueue(s, a)) { res.status(429).json({error: "Remote input was too fast."}); return; }
  }
  res.sendStatus(204);
});

export default router;
