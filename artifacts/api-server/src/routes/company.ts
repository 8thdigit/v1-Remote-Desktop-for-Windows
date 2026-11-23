import { Router } from "express";
import { DAY } from "../lib/billing";
import { billingReady, connectGateForRa, linkRegister, requireUser, sendError, store } from "../lib/portal";

// The signed-in company's own dashboard: its subscription, renewal date,
// usage against the quota, live sessions and recent history. Read-only, and
// limited to the company's own account and RA ID.
const router = Router();

router.use((_req, res, next) => {
  res.set({ "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" });
  next();
});
router.use(requireUser());

router.get("/dashboard", async (req, res) => {
  try {
    const user = req.account!;
    const billing = await billingReady();
    const now = Date.now();
    const ent = billing.entitlement(user.id, now);
    const sub = billing.getSubscription(user.id);
    const gate = await connectGateForRa(user.raId);

    // Live sessions and PCs for this company only.
    const live = store.liveFor(user.raId);
    const inbox = store.inbox(user.raId);

    // Session history: per day for 30 days, and totals.
    const history = billing.listSessions({ accountId: user.id }, 2000);
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const days = Array.from({ length: 30 }, (_, i) => ({ day: start.getTime() - (29 - i) * DAY, sessions: 0, minutes: 0 }));
    const byMode = { attended: 0, unattended: 0, link: 0 };
    const byPc = new Map<string, { sessions: number; minutes: number }>();
    const hours = Array.from({ length: 24 }, () => 0);
    let minutes30 = 0;
    let sessions30 = 0;
    let longestMs = 0;
    for (const h of history) {
      const i = Math.floor((h.startedAt - days[0].day) / DAY);
      if (i < 0 || i >= 30) continue;
      const m = Math.round(h.durationMs / 60_000);
      days[i].sessions += 1;
      days[i].minutes += m;
      sessions30 += 1;
      minutes30 += m;
      longestMs = Math.max(longestMs, h.durationMs);
      byMode[h.mode] = (byMode[h.mode] ?? 0) + 1;
      hours[new Date(h.startedAt).getHours()] += 1;
      const pc = h.pcName || "Windows PC";
      const row = byPc.get(pc) ?? { sessions: 0, minutes: 0 };
      row.sessions += 1;
      row.minutes += m;
      byPc.set(pc, row);
    }
    const topPcs = [...byPc.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.sessions - a.sessions).slice(0, 5);

    // Remote access URLs this company authorized.
    const links = await linkRegister({ accountId: user.id });
    const periodStart = sub?.currentPeriodStart ?? 0;

    // Payments: open dues and the last one paid.
    const payments = billing.listPayments(user.id, 100);
    const open = payments.filter((p) => p.status !== "paid").sort((a, b) => a.dueDate - b.dueDate);
    const lastPaid = payments.filter((p) => p.status === "paid").sort((a, b) => (b.paidAt ?? 0) - (a.paidAt ?? 0))[0];

    res.json({
      now,
      company: { name: user.displayName, raId: user.raId },
      subscription: ent.subscribed ? {
        status: ent.status,
        plan: ent.plan ? { name: ent.plan.name, description: ent.plan.description, interval: ent.plan.interval, priceInr: ent.plan.priceInr, maxConcurrentViewers: ent.plan.maxConcurrentViewers, maxSessionMinutes: ent.plan.maxSessionMinutes } : null,
        startedAt: sub?.startedAt ?? null,
        currentPeriodStart: sub?.currentPeriodStart ?? null,
        currentPeriodEnd: ent.currentPeriodEnd,
        autoRenew: sub?.autoRenew ?? false,
      } : null,
      usage: {
        used: ent.sessionsUsed,
        quota: ent.sessionQuota,
        planQuota: ent.planQuota,
        grace: ent.graceSessions,
        remaining: ent.remaining,
        urls: ent.urlsUsed,
        extraSessions: ent.extraSessionsUsed,
        blocked: !gate.ok,
        reason: gate.ok ? null : gate.reason ?? "inactive",
        message: gate.ok ? null : gate.message ?? null,
        // Grace extensions in the current period (amount and date only).
        graceLog: (sub?.graceLog ?? []).filter((g) => g.at >= periodStart).map((g) => ({ amount: g.amount, at: g.at })),
      },
      live: live.map((s) => ({ id: s.id, name: s.name, mode: s.mode, viewers: s.viewers, liveAt: s.liveAt })),
      pcs: { online: inbox.pcs.filter((p) => p.state === "online").length, busy: inbox.pcs.filter((p) => p.state === "busy").length, list: inbox.pcs },
      requests: {
        waiting: inbox.requests.filter((r) => r.status === "waiting").length,
        accepted: inbox.requests.filter((r) => r.status === "accepted").length,
        missed: inbox.requests.filter((r) => r.status === "missed").length,
      },
      links: {
        active: links.filter((l) => l.status === "active").length,
        thisPeriod: links.filter((l) => (l.claim?.at ?? 0) >= periodStart).length,
        total: links.length,
        recent: links.slice(0, 6).map((l) => ({ code: l.code, pcName: l.pcName, status: l.status, online: l.online, claimedAt: l.claim?.at ?? null, expiresAt: l.expiresAt, sessions: l.sessions.length })),
      },
      history: {
        days,
        sessions30,
        minutes30,
        avgMinutes: sessions30 ? Math.round(minutes30 / sessions30) : 0,
        longestMinutes: Math.round(longestMs / 60_000),
        byMode,
        hours,
        topPcs,
      },
      payments: {
        open: open.slice(0, 5).map((p) => ({ id: p.id, amountInr: p.amountInr, dueDate: p.dueDate, status: p.status, note: p.note })),
        openAmountInr: open.reduce((t, p) => t + p.amountInr, 0),
        lastPaid: lastPaid ? { amountInr: lastPaid.amountInr, paidAt: lastPaid.paidAt, note: lastPaid.note } : null,
      },
    });
  } catch (err) { sendError(res, err); }
});

export default router;
