import { Router, raw, type Request, type Response } from "express";
import {
  JoinDesklineBody, JoinDesklineResponse, CreateDesklineInviteResponse,
  SendDesklineInputBody, RegisterDesklineStandingBody, RegisterDesklineStandingResponse, TickDesklineResponse, GetDesklineFrameQueryParams,
} from "@workspace/api-zod";
import { createDesklineStore } from "../lib/deskline";

const router = Router();
const store = createDesklineStore();
setInterval(store.sweep, 5000).unref();

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
  const standing = store.standing(body.data.key);
  if (!standing) { res.status(409).json({error: "Relay busy, or the code is in use by another session."}); return; }
  res.status(201).json(RegisterDesklineStandingResponse.parse(standing));
});
router.post("/join", (req, res) => {
  if (tooManyJoins()) { res.status(429).json({error: "Too many attempts. Try again in a minute."}); return; }
  const body = JoinDesklineBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({error: "Enter a 12-character code from the host."}); return; }
  const viewer = store.join(body.data.code);
  if (!viewer) { res.status(404).json({error: "Code not found, already used, or expired."}); return; }
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
  store.end(s);
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
  res.json(TickDesklineResponse.parse(store.tick(s, frame)));
});
router.get("/frame", (req, res) => {
  const s = auth(req, res, "viewer");
  if (!s) return;
  const query = GetDesklineFrameQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({error: "Invalid frame sequence."}); return; }
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
