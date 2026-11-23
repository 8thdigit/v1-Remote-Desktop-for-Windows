import { Router } from "express";
import { CreateUserBody, UpdateUserBody } from "@workspace/api-zod";
import { formatRaId } from "../lib/msfwr";
import { DAY } from "../lib/billing";
import type { AssetKind } from "../lib/site";
import { accountsReady, activity, billingReady, linkRegister, requireUser, sendError, siteReady, store } from "../lib/portal";

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

// --- The dashboard: everything an admin checks first, in one request. ---
router.get("/dashboard", async (_req, res) => {
  try {
    const [accounts, billing, site] = await Promise.all([accountsReady(), billingReady(), siteReady()]);
    const now = Date.now();
    const users = accounts.list();
    const companies = users.filter((u) => u.role === "company");
    const nameOf = new Map(users.map((u) => [u.id, u.displayName]));
    const { live, pcs, requests } = store.overview();

    const subs = billing.listSubscriptions(now);
    const subCount = { active: 0, trial: 0, expired: 0, suspended: 0, none: 0 };
    const subscribed = new Set<string>();
    const expiringSoon: { accountId: string; company: string; status: string; currentPeriodEnd: number }[] = [];
    for (const sub of subs) {
      if (!nameOf.has(sub.accountId)) continue;
      subscribed.add(sub.accountId);
      subCount[sub.status] += 1;
      if ((sub.status === "active" || sub.status === "trial") && sub.currentPeriodEnd - now <= 7 * DAY) {
        expiringSoon.push({ accountId: sub.accountId, company: nameOf.get(sub.accountId)!, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd });
      }
    }
    subCount.none = companies.filter((c) => !subscribed.has(c.id)).length;
    expiringSoon.sort((a, b) => a.currentPeriodEnd - b.currentPeriodEnd);

    const dues = billing.dues(now);
    const withName = <T extends { accountId: string }>(p: T) => ({ ...p, company: nameOf.get(p.accountId) ?? "Deleted company" });
    const upcoming30 = dues.upcoming.filter((p) => p.dueDate <= now + 30 * DAY);
    const summary = billing.summary(now);

    // Sessions per day for the last 14 days, oldest first (local to the relay's clock).
    const history = billing.listSessions({}, 2000);
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const days = Array.from({ length: 14 }, (_, i) => ({ day: start.getTime() - (13 - i) * DAY, sessions: 0, minutes: 0 }));
    for (const h of history) {
      const i = Math.floor((h.startedAt - days[0].day) / DAY);
      if (i >= 0 && i < 14) { days[i].sessions += 1; days[i].minutes += Math.round(h.durationMs / 60_000); }
    }

    const registrations = site.listRegistrations();
    res.json({
      now,
      companies: {
        total: companies.length,
        active: companies.filter((c) => !c.disabled).length,
        disabled: companies.filter((c) => c.disabled).length,
        admins: users.filter((u) => u.role === "admin").length,
      },
      sessions: {
        live: live.filter((s) => s.state === "live"),
        pending: live.filter((s) => s.state === "pending").length,
        pcsOnline: pcs.length,
        waitingRequests: requests.filter((r) => r.status === "waiting").length,
        last30Days: summary.sessionsThisMonth,
        days,
      },
      subscriptions: { ...subCount, mrrInr: summary.mrrInr, expiringSoon: expiringSoon.slice(0, 8) },
      payments: {
        overdueCount: dues.overdue.length,
        overdueAmountInr: dues.overdue.reduce((t, p) => t + p.amountInr, 0),
        upcomingCount: upcoming30.length,
        upcomingAmountInr: upcoming30.reduce((t, p) => t + p.amountInr, 0),
        overdue: dues.overdue.slice(0, 8).map(withName),
        upcoming: upcoming30.slice(0, 8).map(withName),
      },
      registrations: {
        ...site.registrationCounts(),
        latest: registrations.filter((r) => r.status === "pending").slice(0, 5),
      },
      activity: activity.list(8),
    });
  } catch (err) { sendError(res, err); }
});

// --- Site settings ---
const KINDS: AssetKind[] = ["logo", "favicon", "og"];
const ASSET_NAME: Record<AssetKind, string> = { logo: "the logo", favicon: "the favicon", og: "the share image" };

router.get("/site", async (_req, res) => {
  try { res.json((await siteReady()).publicSettings()); } catch (err) { sendError(res, err); }
});

router.patch("/site", async (req, res) => {
  try {
    const settings = await (await siteReady()).updateSettings(req.body);
    activity.add("site", `${req.account!.displayName} changed the site settings`, req.account!.username);
    res.json(settings);
  } catch (err) { sendError(res, err); }
});

router.put("/site/asset/:kind", async (req, res) => {
  try {
    const kind = req.params.kind as AssetKind;
    if (!KINDS.includes(kind)) { res.sendStatus(404); return; }
    const settings = await (await siteReady()).setAsset(kind, (req.body as { dataUrl?: unknown } | undefined)?.dataUrl);
    activity.add("site", `${req.account!.displayName} uploaded ${ASSET_NAME[kind]}`, req.account!.username);
    res.json(settings);
  } catch (err) { sendError(res, err); }
});

router.delete("/site/asset/:kind", async (req, res) => {
  try {
    const kind = req.params.kind as AssetKind;
    if (!KINDS.includes(kind)) { res.sendStatus(404); return; }
    const settings = await (await siteReady()).removeAsset(kind);
    activity.add("site", `${req.account!.displayName} removed ${ASSET_NAME[kind]}`, req.account!.username);
    res.json(settings);
  } catch (err) { sendError(res, err); }
});

// --- Access requests sent from the sign-in page ---
router.get("/registrations", async (_req, res) => {
  try { res.json({ registrations: (await siteReady()).listRegistrations() }); } catch (err) { sendError(res, err); }
});

router.patch("/registrations/:id", async (req, res) => {
  try {
    const body = (req.body ?? {}) as { status?: unknown; note?: unknown };
    const entry = await (await siteReady()).updateRegistration(req.params.id, { status: body.status, note: body.note });
    if (body.status !== undefined) activity.add("registration", `${req.account!.displayName} marked the access request from ${entry.name} ${entry.status}`, req.account!.username);
    res.json(entry);
  } catch (err) { sendError(res, err); }
});

router.delete("/registrations/:id", async (req, res) => {
  try {
    await (await siteReady()).removeRegistration(req.params.id);
    res.sendStatus(204);
  } catch (err) { sendError(res, err); }
});

export default router;
