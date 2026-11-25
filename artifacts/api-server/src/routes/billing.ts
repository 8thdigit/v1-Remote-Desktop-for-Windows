import { Router, type Request } from "express";
import { formatRaId } from "../lib/msfwr";
import { INTERVALS, type BillingInterval, type PaymentStatus, type SubStatus } from "../lib/billing";
import { accountsReady, activity, billingReady, requireUser, sendError } from "../lib/portal";

// The subscription, license and payment console (admin only). Companies are
// accounts with the "company" role; everything here keys off a company's
// account id. All routes are JSON and no-store.
const router = Router();

router.use((_req, res, next) => {
  res.set({ "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" });
  next();
});
router.use(requireUser("admin"));

// --- small validation helpers (no external dependency) ---
const asInt = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? n : undefined;
};
const asNum = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const asBool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);
const asStr = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const asInterval = (v: unknown): BillingInterval | undefined =>
  INTERVALS.includes(v as BillingInterval) ? (v as BillingInterval) : undefined;
const asSubStatus = (v: unknown): SubStatus | undefined =>
  (["active", "suspended", "expired", "trial"] as const).includes(v as SubStatus) ? (v as SubStatus) : undefined;
const asPaymentStatus = (v: unknown): PaymentStatus | undefined =>
  (["paid", "due", "overdue"] as const).includes(v as PaymentStatus) ? (v as PaymentStatus) : undefined;

// The public origin a configured client should point its relay at. The admin
// UI passes its own window.location.origin; otherwise fall back to the
// configured viewer origin.
function publicOrigin(req: Request): string {
  const fromQuery = asStr(req.query["origin"]);
  const candidates = [fromQuery, process.env["MSFWR_PUBLIC_ORIGIN"], process.env["MSFWR_VIEWER_ORIGIN"]];
  for (const c of candidates) {
    if (!c) continue;
    try {
      const u = new URL(c);
      if (u.protocol === "https:" && u.hostname) return `https://${u.host}`;
    } catch { /* ignore */ }
  }
  return "https://msfwr.vercel.app";
}

// --- Summary ---
router.get("/summary", async (_req, res) => {
  try {
    const billing = await billingReady();
    const accounts = await accountsReady();
    const companies = accounts.list().filter((u) => u.role === "company");
    res.json({ ...billing.summary(), companies: companies.length });
  } catch (err) { sendError(res, err); }
});

// --- Plans ---
router.get("/plans", async (_req, res) => {
  try {
    const billing = await billingReady();
    res.json({ plans: billing.listPlans() });
  } catch (err) { sendError(res, err); }
});

router.post("/plans", async (req, res) => {
  try {
    const billing = await billingReady();
    const name = asStr(req.body?.name);
    const priceInr = asInt(req.body?.priceInr);
    const interval = asInterval(req.body?.interval);
    if (!name || priceInr === undefined || !interval) {
      res.status(400).json({ error: "A plan needs a name, a price in INR and a billing interval." });
      return;
    }
    const plan = await billing.createPlan({
      name, description: asStr(req.body?.description), priceInr, interval,
      sessionQuota: asInt(req.body?.sessionQuota), maxConcurrentViewers: asInt(req.body?.maxConcurrentViewers),
      maxSessionMinutes: asInt(req.body?.maxSessionMinutes),
    });
    activity.add("plan-created", `${req.account!.displayName} created plan "${plan.name}" (₹${plan.priceInr}/${plan.interval})`, req.account!.username);
    res.status(201).json(plan);
  } catch (err) { sendError(res, err); }
});

router.patch("/plans/:id", async (req, res) => {
  try {
    const billing = await billingReady();
    const plan = await billing.updatePlan(req.params.id, {
      name: asStr(req.body?.name), description: asStr(req.body?.description), priceInr: asInt(req.body?.priceInr),
      interval: asInterval(req.body?.interval), sessionQuota: asInt(req.body?.sessionQuota),
      maxConcurrentViewers: asInt(req.body?.maxConcurrentViewers), maxSessionMinutes: asInt(req.body?.maxSessionMinutes),
      archived: asBool(req.body?.archived),
    });
    res.json(plan);
  } catch (err) { sendError(res, err); }
});

router.delete("/plans/:id", async (req, res) => {
  try {
    const billing = await billingReady();
    const result = await billing.removePlan(req.params.id);
    activity.add("plan-removed", `${req.account!.displayName} ${result.archived ? "archived" : "deleted"} a plan`, req.account!.username);
    res.json(result);
  } catch (err) { sendError(res, err); }
});

// --- Companies with their subscription state ---
router.get("/companies", async (req, res) => {
  try {
    const accounts = await accountsReady();
    const billing = await billingReady();
    const now = Date.now();
    const companies = accounts.list()
      .filter((u) => u.role === "company")
      .map((u) => {
        const sub = billing.getSubscription(u.id);
        const ent = billing.entitlement(u.id, now);
        const payments = billing.listPayments(u.id, 50);
        const openDue = payments.filter((p) => p.status !== "paid").sort((a, b) => a.dueDate - b.dueDate)[0];
        return {
          id: u.id,
          displayName: u.displayName,
          username: u.username,
          raId: u.raId,
          disabled: u.disabled,
          subscription: sub ?? null,
          entitlement: ent,
          nextDue: openDue ? { id: openDue.id, amountInr: openDue.amountInr, dueDate: openDue.dueDate, status: openDue.status } : null,
        };
      });
    res.json({ companies });
  } catch (err) { sendError(res, err); }
});

// --- Subscriptions ---
async function companyOr404(req: Request): Promise<{ id: string; displayName: string; raId: string } | undefined> {
  const accounts = await accountsReady();
  const account = accounts.get(String(req.params.accountId));
  if (!account || account.role !== "company") return undefined;
  return { id: account.id, displayName: account.displayName, raId: account.raId };
}

router.get("/subscriptions/:accountId", async (req, res) => {
  try {
    const account = await companyOr404(req);
    if (!account) { res.status(404).json({ error: "That company no longer exists." }); return; }
    const billing = await billingReady();
    res.json({
      subscription: billing.getSubscription(account.id) ?? null,
      entitlement: billing.entitlement(account.id),
      payments: billing.listPayments(account.id, 100),
    });
  } catch (err) { sendError(res, err); }
});

router.put("/subscriptions/:accountId", async (req, res) => {
  try {
    const account = await companyOr404(req);
    if (!account) { res.status(404).json({ error: "That company no longer exists." }); return; }
    const billing = await billingReady();
    const sub = await billing.setSubscription(account.id, {
      planId: req.body?.planId === null ? null : asStr(req.body?.planId),
      status: asSubStatus(req.body?.status),
      autoRenew: asBool(req.body?.autoRenew),
      requireLicense: asBool(req.body?.requireLicense),
      notes: asStr(req.body?.notes),
      currentPeriodStart: asNum(req.body?.currentPeriodStart),
      currentPeriodEnd: asNum(req.body?.currentPeriodEnd),
      resetUsage: asBool(req.body?.resetUsage),
    });
    activity.add("subscription", `${req.account!.displayName} updated the subscription for ${account.displayName} (${formatRaId(account.raId)})`, req.account!.username);
    res.json({ subscription: sub, entitlement: billing.entitlement(account.id) });
  } catch (err) { sendError(res, err); }
});

router.post("/subscriptions/:accountId/renew", async (req, res) => {
  try {
    const account = await companyOr404(req);
    if (!account) { res.status(404).json({ error: "That company no longer exists." }); return; }
    const billing = await billingReady();
    const result = await billing.renew(account.id, {
      markPaid: asBool(req.body?.markPaid), amountInr: asInt(req.body?.amountInr),
      method: asStr(req.body?.method), reference: asStr(req.body?.reference),
    });
    activity.add("renew", `${req.account!.displayName} renewed ${account.displayName}'s subscription`, req.account!.username);
    res.json({ ...result, entitlement: billing.entitlement(account.id) });
  } catch (err) { sendError(res, err); }
});

// A grace extension: extra usage on top of the plan quota for this period.
router.post("/subscriptions/:accountId/grace", async (req, res) => {
  try {
    const account = await companyOr404(req);
    if (!account) { res.status(404).json({ error: "That company no longer exists." }); return; }
    const billing = await billingReady();
    const sub = await billing.addGrace(account.id, { amount: req.body?.amount, remarks: req.body?.remarks, by: req.account!.displayName });
    const latest = sub.graceLog[0];
    activity.add("grace", `${req.account!.displayName} gave ${account.displayName} a grace extension of ${latest.amount} (${latest.remarks})`, req.account!.username);
    res.json({ subscription: sub, entitlement: billing.entitlement(account.id) });
  } catch (err) { sendError(res, err); }
});

router.post("/subscriptions/:accountId/revoke-license", async (req, res) => {
  try {
    const account = await companyOr404(req);
    if (!account) { res.status(404).json({ error: "That company no longer exists." }); return; }
    const billing = await billingReady();
    const sub = await billing.revokeLicenses(account.id);
    activity.add("license-revoke", `${req.account!.displayName} revoked existing licenses for ${account.displayName}; the client must be reconfigured`, req.account!.username);
    res.json({ subscription: sub });
  } catch (err) { sendError(res, err); }
});

// --- Payments ---
router.get("/payments", async (req, res) => {
  try {
    const billing = await billingReady();
    res.json({ payments: billing.listPayments(asStr(req.query["accountId"]), 300) });
  } catch (err) { sendError(res, err); }
});

router.get("/dues", async (_req, res) => {
  try {
    const billing = await billingReady();
    res.json(billing.dues());
  } catch (err) { sendError(res, err); }
});

router.post("/payments", async (req, res) => {
  try {
    const accountId = asStr(req.body?.accountId);
    const amountInr = asInt(req.body?.amountInr);
    if (!accountId || amountInr === undefined) { res.status(400).json({ error: "A payment needs a company and an amount in INR." }); return; }
    const accounts = await accountsReady();
    const account = accounts.get(accountId);
    if (!account || account.role !== "company") { res.status(404).json({ error: "That company no longer exists." }); return; }
    const billing = await billingReady();
    const payment = await billing.addPayment(accountId, {
      amountInr, interval: asInterval(req.body?.interval) ?? null,
      periodStart: asNum(req.body?.periodStart) ?? null, periodEnd: asNum(req.body?.periodEnd) ?? null,
      dueDate: asNum(req.body?.dueDate), status: asPaymentStatus(req.body?.status),
      method: asStr(req.body?.method), reference: asStr(req.body?.reference), note: asStr(req.body?.note),
    });
    activity.add("payment", `${req.account!.displayName} recorded a ₹${payment.amountInr} payment (${payment.status}) for ${account.displayName}`, req.account!.username);
    res.status(201).json(payment);
  } catch (err) { sendError(res, err); }
});

router.patch("/payments/:id", async (req, res) => {
  try {
    const billing = await billingReady();
    const payment = await billing.updatePayment(req.params.id, {
      amountInr: asInt(req.body?.amountInr), status: asPaymentStatus(req.body?.status),
      paidAt: req.body?.paidAt === null ? null : asNum(req.body?.paidAt), dueDate: asNum(req.body?.dueDate),
      method: asStr(req.body?.method), reference: asStr(req.body?.reference), note: asStr(req.body?.note),
    });
    res.json(payment);
  } catch (err) { sendError(res, err); }
});

router.delete("/payments/:id", async (req, res) => {
  try {
    const billing = await billingReady();
    await billing.removePayment(req.params.id);
    res.sendStatus(204);
  } catch (err) { sendError(res, err); }
});

// --- Session history ---
router.get("/sessions", async (req, res) => {
  try {
    const billing = await billingReady();
    res.json({ sessions: billing.listSessions({ accountId: asStr(req.query["accountId"]), raId: asStr(req.query["raId"]) }, 300) });
  } catch (err) { sendError(res, err); }
});

// --- Configured client bundle for a company ---
// Returns everything the per-company client needs: the relay origin, the RA
// ID, a signed license, and the current subscription summary, plus a ready
// build command. The license binds this company and RA ID and is validated
// by the relay on every registration.
router.get("/companies/:accountId/client", async (req, res) => {
  try {
    const account = await companyOr404(req);
    if (!account) { res.status(404).json({ error: "That company no longer exists." }); return; }
    const billing = await billingReady();
    const ent = billing.entitlement(account.id);
    const license = billing.issueLicense(account.id, account.raId);
    const relay = publicOrigin(req);
    const config = {
      version: 1 as const,
      company: account.displayName,
      relay,
      raId: account.raId,
      license,
      issuedAt: Date.now(),
    };
    activity.add("client-config", `${req.account!.displayName} generated a client configuration for ${account.displayName} (${formatRaId(account.raId)})`, req.account!.username);
    res.json({
      config,
      // What the installer/build embeds. The config file is the simplest path;
      // the build command bakes the same values into a per-company installer.
      configFileName: "winrss-client.json",
      buildCommand: `MSFWR_EMBED_RELAY='${relay}' MSFWR_EMBED_RA='${account.raId}' MSFWR_EMBED_LICENSE='${license}' bash windows-host/build.sh`,
      subscription: {
        status: ent.status,
        plan: ent.plan ? { name: ent.plan.name, interval: ent.plan.interval, priceInr: ent.plan.priceInr } : null,
        sessionQuota: ent.sessionQuota,
        sessionsUsed: ent.sessionsUsed,
        remaining: ent.remaining,
        currentPeriodEnd: ent.currentPeriodEnd,
      },
    });
  } catch (err) { sendError(res, err); }
});

export default router;
