import { Router } from "express";
import { CreateUserBody, UpdateUserBody } from "@workspace/api-zod";
import { formatRaId } from "../lib/msfwr";
import { accountsReady, activity, linkRegister, requireUser, sendError, store } from "../lib/portal";

// The admin console: accounts, live sessions, requests and activity.
const router = Router();

router.use((_req, res, next) => {
  res.set({ "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" });
  next();
});
router.use(requireUser("admin"));

router.get("/users", async (_req, res) => {
  try {
    const accounts = await accountsReady();
    res.json({ users: accounts.list() });
  } catch (err) { sendError(res, err); }
});

router.post("/users", async (req, res) => {
  try {
    const accounts = await accountsReady();
    const body = CreateUserBody.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: "Fill in a login ID, a password and a role." }); return; }
    const user = await accounts.create({ ...body.data, mustChangePassword: true });
    activity.add("user-created", `${req.account!.displayName} created ${user.role === "admin" ? "admin" : "company"} ${user.displayName} (${formatRaId(user.raId)})`, req.account!.username);
    res.status(201).json(user);
  } catch (err) { sendError(res, err); }
});

router.patch("/users/:id", async (req, res) => {
  try {
    const accounts = await accountsReady();
    const body = UpdateUserBody.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: "Invalid change." }); return; }
    const before = accounts.get(req.params.id);
    const user = await accounts.update(req.params.id, body.data, req.account!.id);
    if (user.disabled) { store.endOperator(user.id); store.dropCompanyPin(user.id); }
    const changes = [
      body.data.password !== undefined && "reset the password",
      before && body.data.role !== undefined && before.role !== user.role && `made them ${user.role === "admin" ? "an admin" : "a company"}`,
      before && body.data.disabled !== undefined && before.disabled !== user.disabled && (user.disabled ? "disabled the account" : "enabled the account"),
      before && body.data.displayName !== undefined && before.displayName !== user.displayName && "renamed the account",
      before && before.raId !== user.raId && `changed the RA ID to ${formatRaId(user.raId)}`,
    ].filter(Boolean);
    if (changes.length) activity.add("user-updated", `${req.account!.displayName} ${changes.join(", ")} for ${user.displayName}`, req.account!.username);
    res.json(user);
  } catch (err) { sendError(res, err); }
});

router.delete("/users/:id", async (req, res) => {
  try {
    const accounts = await accountsReady();
    const user = await accounts.remove(req.params.id, req.account!.id);
    store.endOperator(user.id);
    store.dropCompanyPin(user.id);
    activity.add("user-deleted", `${req.account!.displayName} deleted ${user.displayName} (${formatRaId(user.raId)})`, req.account!.username);
    res.sendStatus(204);
  } catch (err) { sendError(res, err); }
});

router.get("/overview", async (_req, res) => {
  try {
    const accounts = await accountsReady();
    const { links: _live, ...overview } = store.overview();
    res.json({ ...overview, links: await linkRegister(), activity: activity.list(150), storage: accounts.backend });
  } catch (err) { sendError(res, err); }
});

router.post("/sessions/:id/end", (req, res) => {
  if (!store.endById(req.params.id)) { res.status(404).json({ error: "That session already ended." }); return; }
  activity.add("session-ended", `${req.account!.displayName} ended a session from the admin console`, req.account!.username);
  res.sendStatus(204);
});

export default router;
