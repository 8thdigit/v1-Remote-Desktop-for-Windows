import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { ChangePasswordBody, LoginBody, SetupAdminBody } from "@workspace/api-zod";
import {
  accountsReady, activity, clearLogin, clearSetupCode, currentUser, limiter, requireUser, sendError, setLogin, setupCode,
} from "../lib/portal";
import { formatRaId } from "../lib/accounts";

const router = Router();
// Ten wrong passwords for one username, or thirty from one address, lock
// sign-in for fifteen minutes.
const byName = limiter(10, 15 * 60_000);
const byAddress = limiter(30, 15 * 60_000);

router.use((_req, res, next) => {
  res.set({ "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" });
  next();
});

router.get("/status", async (req, res) => {
  try {
    const accounts = await accountsReady();
    const user = await currentUser(req);
    res.json({ setupRequired: accounts.empty, ...(user ? { user } : {}) });
  } catch (err) { sendError(res, err); }
});

router.post("/setup", async (req, res) => {
  try {
    const accounts = await accountsReady();
    if (!accounts.empty || !setupCode) { res.status(409).json({ error: "The admin account already exists. Sign in instead." }); return; }
    const address = req.ip ?? "";
    if (byAddress.blocked(address)) { res.status(429).json({ error: "Too many attempts. Wait 15 minutes." }); return; }
    const body = SetupAdminBody.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: "Fill in the setup code, a username and a password." }); return; }
    const given = Buffer.from(body.data.setupCode.trim().toUpperCase());
    const expected = Buffer.from(setupCode);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      byAddress.fail(address);
      res.status(403).json({ error: "That setup code is not correct. Find it in the relay's log." });
      return;
    }
    const user = await accounts.create({ ...body.data, role: "admin" });
    clearSetupCode();
    setLogin(req, res, accounts.issue(user.id));
    activity.add("setup", `${user.displayName} created the first admin account`, user.username);
    res.status(201).json(user);
  } catch (err) { sendError(res, err); }
});

router.post("/login", async (req, res) => {
  try {
    if (!req.is("application/json")) { res.status(415).json({ error: "Send the request as JSON." }); return; }
    const accounts = await accountsReady();
    const body = LoginBody.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: "Enter your username and password." }); return; }
    const name = body.data.username.trim().toLowerCase();
    const address = req.ip ?? "";
    if (byName.blocked(name) || byAddress.blocked(address)) {
      res.status(429).json({ error: "Too many failed sign-ins. Wait 15 minutes, or ask an admin to reset your password." });
      return;
    }
    const user = await accounts.verify(name, body.data.password);
    if (!user) {
      byName.fail(name);
      byAddress.fail(address);
      activity.add("login-failed", `Failed sign-in for "${name.slice(0, 32)}"`);
      res.status(401).json({ error: "Wrong username or password." });
      return;
    }
    byName.clear(name);
    setLogin(req, res, accounts.issue(user.id));
    activity.add("login", `${user.displayName} (${formatRaId(user.raId)}) signed in`, user.username);
    res.json(user);
  } catch (err) { sendError(res, err); }
});

router.post("/logout", (req, res) => {
  clearLogin(req, res);
  res.sendStatus(204);
});

router.post("/password", requireUser(), async (req, res) => {
  try {
    const accounts = await accountsReady();
    const body = ChangePasswordBody.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: "Enter your current and new password." }); return; }
    const user = await accounts.changePassword(req.account!.id, body.data.current, body.data.next);
    setLogin(req, res, accounts.issue(user.id));
    activity.add("password", `${user.displayName} changed their password`, user.username);
    res.sendStatus(204);
  } catch (err) { sendError(res, err); }
});

export default router;
