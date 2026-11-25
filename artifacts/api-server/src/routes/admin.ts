import { createHash, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Router, type Request, type Response } from "express";
import { CreateUserBody, UpdateUserBody } from "@workspace/api-zod";
import { formatRaId } from "../lib/msfwr";
import { DAY } from "../lib/billing";
import type { AssetKind } from "../lib/site";
import type { WatcherWatch, WatcherQuestion } from "../lib/watcher";
import { accountsReady, activity, billingReady, buddyReady, limiter, linkRegister, requireUser, sendError, siteReady, store, watcherImageDir, watcherReady } from "../lib/portal";

// The admin console: accounts, live sessions, requests and activity.
const router = Router();

router.use((_req, res, next) => {
  res.set({ "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" });
  next();
});
router.use(requireUser("admin"));

// Creating a Connect.AI admin account (or making an account an admin) needs the
// six-digit admin creation PIN. It is a secret kept in the relay's
// environment (ADMIN_CREATION_PIN), never in the code or the browser.
const adminPinTries = limiter(5, 15 * 60_000);
const digest = (v: string) => createHash("sha256").update(v).digest();

function adminPinOk(req: Request, res: Response) {
  const secret = (process.env["ADMIN_CREATION_PIN"] ?? "").trim();
  if (!/^\d{6}$/.test(secret)) {
    res.status(503).json({ error: "Admin account creation is turned off: set ADMIN_CREATION_PIN (six digits) in the relay's environment." });
    return false;
  }
  const key = req.account!.id;
  if (adminPinTries.blocked(key)) {
    res.status(429).json({ error: "Too many wrong admin PINs. Try again in 15 minutes." });
    return false;
  }
  const given = String((req.body as { adminPin?: unknown } | undefined)?.adminPin ?? "").replace(/\D/g, "");
  if (!given) { res.status(403).json({ error: "Enter the 6-digit admin creation PIN." }); return false; }
  if (!timingSafeEqual(digest(given), digest(secret))) {
    adminPinTries.fail(key);
    activity.add("admin-pin-failed", `${req.account!.displayName} entered a wrong admin creation PIN`, req.account!.username);
    res.status(403).json({ error: "That admin creation PIN is not correct." });
    return false;
  }
  adminPinTries.clear(key);
  return true;
}

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
    if (body.data.role === "admin" && !adminPinOk(req, res)) return;
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
    if (body.data.role === "admin" && before?.role !== "admin" && !adminPinOk(req, res)) return;
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
    const body = (req.body ?? {}) as { status?: unknown; actionPlan?: unknown; outcome?: unknown; note?: unknown };
    const entry = await (await siteReady()).updateRegistration(req.params.id, {
      status: body.status, actionPlan: body.actionPlan, outcome: body.outcome, note: body.note,
    });
    const who = req.account!.displayName;
    if (body.status !== undefined) activity.add("registration", `${who} ${entry.status === "pending" ? "reopened" : entry.status} the access request from ${entry.name}`, req.account!.username);
    if (body.outcome) activity.add("registration", `${who} marked the access request from ${entry.name} as ${entry.outcome === "converted" ? "converted to customer" : "query closed"}`, req.account!.username);
    res.json(entry);
  } catch (err) { sendError(res, err); }
});

router.post("/registrations/:id/comments", async (req, res) => {
  try {
    const entry = await (await siteReady()).addRegistrationComment(req.params.id, (req.body as { text?: unknown } | undefined)?.text, req.account!.displayName);
    res.status(201).json(entry);
  } catch (err) { sendError(res, err); }
});

router.delete("/registrations/:id/comments/:commentId", async (req, res) => {
  try {
    res.json(await (await siteReady()).removeRegistrationComment(req.params.id, req.params.commentId));
  } catch (err) { sendError(res, err); }
});

router.delete("/registrations/:id", async (req, res) => {
  try {
    await (await siteReady()).removeRegistration(req.params.id);
    res.sendStatus(204);
  } catch (err) { sendError(res, err); }
});

// --- Session summaries and AI Buddy ---
// Every session, live and ended, with AI Buddy's summary where it has one.
router.get("/session-summaries", async (_req, res) => {
  try {
    const [accounts, billing, buddy] = await Promise.all([accountsReady(), billingReady(), buddyReady()]);
    const users = accounts.list();
    const nameOf = new Map(users.map((u) => [u.id, u.displayName]));
    const byRa = new Map(users.map((u) => [u.raId, u.displayName]));
    const notes = buddy.sessionsIndex();
    const { live } = store.overview();
    const rows = [
      ...live.filter((s) => s.state === "live").map((s) => ({
        id: s.id, live: true, pcName: s.name, mode: s.mode, operator: s.operator ?? "",
        company: (s.ra && byRa.get(s.ra)) || "", raId: s.ra ?? "",
        startedAt: s.liveAt ?? s.createdAt, endedAt: null as number | null, durationMs: Date.now() - (s.liveAt ?? s.createdAt), viewers: s.viewers,
      })),
      ...billing.listSessions({}, 1000).map((h) => ({
        id: h.sessionId ?? h.id, live: false, pcName: h.pcName, mode: h.mode, operator: h.operator,
        company: (h.accountId && nameOf.get(h.accountId)) || (h.raId && byRa.get(h.raId)) || "", raId: h.raId,
        startedAt: h.startedAt, endedAt: h.endedAt as number | null, durationMs: h.durationMs, viewers: h.viewers,
      })),
    ];
    res.json({
      sessions: rows.map((r) => {
        const b = notes.get(r.id);
        return {
          ...r,
          summary: b?.summary ?? "", summaryBy: b?.summaryBy ?? "", issues: b?.issues ?? [],
          captureCount: b?.captureCount ?? 0, resolution: b?.resolution ?? "", hasRecord: !!b,
        };
      }),
    });
  } catch (err) { sendError(res, err); }
});

router.get("/buddy/sessions/:id", async (req, res) => {
  try {
    const s = (await buddyReady()).session(req.params.id);
    if (!s) { res.status(404).json({ error: "AI Buddy has no screen record for that session." }); return; }
    res.json(s);
  } catch (err) { sendError(res, err); }
});

router.post("/buddy/sessions/:id/summarize", async (req, res) => {
  try { res.json(await (await buddyReady()).summarize(req.params.id)); } catch (err) { sendError(res, err); }
});

router.patch("/buddy/sessions/:id", async (req, res) => {
  try { res.json(await (await buddyReady()).updateSession(req.params.id, req.body)); } catch (err) { sendError(res, err); }
});

router.delete("/buddy/sessions/:id", async (req, res) => {
  try {
    await (await buddyReady()).removeSession(req.params.id);
    activity.add("buddy", `${req.account!.displayName} deleted an AI Buddy screen record`, req.account!.username);
    res.sendStatus(204);
  } catch (err) { sendError(res, err); }
});

router.post("/buddy/sessions/:id/kb", async (req, res) => {
  try { res.status(201).json(await (await buddyReady()).kbFromSession(req.params.id, req.account!.displayName, req.body)); } catch (err) { sendError(res, err); }
});

router.get("/buddy/settings", async (_req, res) => {
  try { res.json((await buddyReady()).settings()); } catch (err) { sendError(res, err); }
});

router.patch("/buddy/settings", async (req, res) => {
  try {
    const settings = await (await buddyReady()).updateSettings(req.body);
    activity.add("buddy", `${req.account!.displayName} changed the AI Buddy settings`, req.account!.username);
    res.json(settings);
  } catch (err) { sendError(res, err); }
});

router.get("/buddy/kb", async (_req, res) => {
  try { res.json({ entries: (await buddyReady()).listKb() }); } catch (err) { sendError(res, err); }
});

router.post("/buddy/kb", async (req, res) => {
  try { res.status(201).json(await (await buddyReady()).addKb(req.body, req.account!.displayName)); } catch (err) { sendError(res, err); }
});

router.patch("/buddy/kb/:id", async (req, res) => {
  try { res.json(await (await buddyReady()).updateKb(req.params.id, req.body)); } catch (err) { sendError(res, err); }
});

router.delete("/buddy/kb/:id", async (req, res) => {
  try { await (await buddyReady()).removeKb(req.params.id); res.sendStatus(204); } catch (err) { sendError(res, err); }
});

// --- Inspect Buddy: the question-watcher control room ---
// Ongoing remote sessions with per-session watcher state, the captured
// questions for one session, enabling/disabling a watcher, accepting or
// correcting a recommended answer, and the categorized document repository.

// The live sessions as the control room lists them: PC, company, helper,
// viewers, uptime, plus what AI Buddy last read off the screen.
router.get("/buddy/sessions", async (_req, res) => {
  try {
    const [accounts, buddy] = await Promise.all([accountsReady(), buddyReady()]);
    const byRa = new Map(accounts.list().map((u) => [u.raId, u.displayName]));
    const notes = buddy.sessionsIndex();
    const rows = store.overview().live.filter((s) => s.state === "live").map((s) => {
      const b = notes.get(s.id);
      const lastText = b && Array.isArray(b.captures) && b.captures.length ? String((b.captures as { text?: string }[])[b.captures.length - 1]?.text ?? "") : "";
      return {
        sessionId: s.id,
        pcName: s.name || "",
        mode: s.mode,
        company: (s.ra && byRa.get(s.ra)) || "",
        operator: s.operator ?? "",
        startedAt: s.liveAt ?? s.createdAt,
        viewers: s.viewers,
        captureCount: b?.captureCount ?? 0,
        lastSeenText: lastText.slice(0, 300),
      };
    });
    res.json({ sessions: rows });
  } catch (err) { sendError(res, err); }
});

// Engine watch record -> the shape the control-room page renders.
function watcherView(w: WatcherWatch | undefined, imageUrl: ((name: string) => string) | undefined) {
  if (!w) return null;
  const status = !w.enabled || w.phase === "idle"
    ? "off"
    : w.phase === "watching" ? "watching" : w.phase === "in-exam" ? "exam-detected" : "completed";
  const questions = w.questions.map((q: WatcherQuestion) => ({
    index: q.n,
    at: q.at,
    text: q.text,
    screenshotUrl: q.image && imageUrl ? imageUrl(q.image) : null,
    // A pending question inside a live exam is still being researched.
    state: q.status === "pending" ? (status === "exam-detected" ? "researching" : "pending")
      : q.status === "answered" ? "recommended" : q.status,
    answer: q.answer,
    explanation: q.explanation,
    confidence: q.confidence,
    source: q.source || "ai",
    sources: q.refs,
    correctedAnswer: q.status === "corrected" ? q.answer : "",
  }));
  return {
    sessionId: w.sessionId,
    enabled: w.enabled,
    status,
    startedAt: w.startedAt ?? null,
    completedAt: w.endedAt ?? null,
    questions,
    documentsStored: w.phase === "completed" ? w.storedDocs ?? [] : [],
    error: null,
    lastSeenText: w.lastSeen.slice(0, 300),
    examTitle: w.examTitle,
    notes: w.notes,
  };
}

const imageUrlFor = (n: string) => `/api/admin/buddy/img/${encodeURIComponent(n)}`;

// Engine question record -> the shape the review buttons render.
function reviewView(q: WatcherQuestion, imageUrl: (name: string) => string) {
  return {
    ...q,
    index: q.n,
    screenshotUrl: q.image ? imageUrl(q.image) : null,
    state: q.status === "answered" ? "recommended" : q.status,
    sources: q.refs,
    correctedAnswer: q.status === "corrected" ? q.answer : "",
  };
}

router.get("/buddy/watchers/:id", async (req, res) => {
  try {
    const engine = await watcherReady();
    const view = watcherView(engine.watch(req.params.id), (n) => `/api/admin/buddy/img/${encodeURIComponent(n)}`);
    if (!view) { res.status(404).json({ error: "No question watcher has run on that session yet." }); return; }
    res.json(view);
  } catch (err) { sendError(res, err); }
});

router.post("/buddy/watchers/:id", async (req, res) => {
  try {
    const engine = await watcherReady();
    const live = store.overview().live.find((s) => s.id === req.params.id && s.state === "live");
    const accounts = await accountsReady();
    const ra = live?.ra ?? "";
    const meta = {
      pcName: live?.name || engine.watch(req.params.id)?.pcName || "Windows PC",
      raId: ra,
      operator: live?.operator || accounts.findRa(ra)?.displayName || "",
    };
    const w = await engine.enable(req.params.id, meta);
    activity.add("inspect-buddy", `${req.account!.displayName} enabled the Question Watcher on ${meta.pcName}`, req.account!.username);
    res.json(watcherView(engine.watch(req.params.id) ?? ({ ...w, questions: [] } as unknown as WatcherWatch), (n) => `/api/admin/buddy/img/${encodeURIComponent(n)}`));
  } catch (err) { sendError(res, err); }
});

router.delete("/buddy/watchers/:id", async (req, res) => {
  try {
    const engine = await watcherReady();
    await engine.disable(req.params.id);
    activity.add("inspect-buddy", `${req.account!.displayName} disabled the Question Watcher`, req.account!.username);
    res.json(watcherView(engine.watch(req.params.id), (n) => `/api/admin/buddy/img/${encodeURIComponent(n)}`));
  } catch (err) { sendError(res, err); }
});

// Accept or correct one recommended answer. Body for "correct": { answer }.
router.post("/buddy/watchers/:id/questions/:n/accept", async (req, res) => {
  try {
    const n = Number.parseInt(req.params.n, 10);
    if (!Number.isFinite(n)) { res.status(400).json({ error: "Which question number?" }); return; }
    const engine = await watcherReady();
    const q = await engine.review(req.params.id, n, {
      action: "accept",
      by: req.account!.displayName,
    });
    res.json(reviewView(q, imageUrlFor));
  } catch (err) { sendError(res, err); }
});

router.post("/buddy/watchers/:id/questions/:n/correct", async (req, res) => {
  try {
    const n = Number.parseInt(req.params.n, 10);
    if (!Number.isFinite(n)) { res.status(400).json({ error: "Which question number?" }); return; }
    const engine = await watcherReady();
    const q = await engine.review(req.params.id, n, {
      action: "correct",
      answer: typeof (req.body as { answer?: unknown } | undefined)?.answer === "string"
        ? (req.body as { answer: string }).answer
        : undefined,
      by: req.account!.displayName,
    });
    res.json(reviewView(q, imageUrlFor));
  } catch (err) { sendError(res, err); }
});

// Re-run the research for one question (repository + online).
router.post("/buddy/watchers/:id/questions/:n/research", async (req, res) => {
  try {
    const n = Number.parseInt(req.params.n, 10);
    if (!Number.isFinite(n)) { res.status(400).json({ error: "Which question number?" }); return; }
    const engine = await watcherReady();
    const q = await engine.reResearch(req.params.id, n);
    res.json({ ...q, index: q.n, state: q.status === "answered" ? "recommended" : q.status, sources: q.refs });
  } catch (err) { sendError(res, err); }
});

// --- Document repository (categories + auto-stored exam materials) ---
router.get("/buddy/repo/documents", async (req, res) => {
  try {
    const engine = await watcherReady();
    const category = typeof req.query.category === "string" && req.query.category ? req.query.category.toLowerCase() : undefined;
    const docs = engine.listDocs(category).map((d) => ({
      id: d.id, title: d.title, category: d.category, filename: d.fileName ?? `${d.title}.txt`,
      bytes: d.bytes, uploadedBy: d.uploadedBy, uploadedAt: d.uploadedAt,
      origin: d.uploadedBy === "inspect-buddy" ? "auto" : "upload", preview: d.preview,
    }));
    res.json({ documents: docs, categories: engine.categories().map((c) => c.name) });
  } catch (err) { sendError(res, err); }
});

router.post("/buddy/repo/documents", async (req, res) => {
  try {
    const doc = await (await watcherReady()).uploadDoc(req.body, req.account!.displayName);
    activity.add("inspect-buddy", `${req.account!.displayName} uploaded “${doc.title}” to the document repository`, req.account!.username);
    res.status(201).json(doc);
  } catch (err) { sendError(res, err); }
});

router.delete("/buddy/repo/documents/:id", async (req, res) => {
  try {
    await (await watcherReady()).removeDoc(req.params.id);
    res.sendStatus(204);
  } catch (err) { sendError(res, err); }
});

// Screenshots saved by the question watcher (admin-authenticated).
router.get("/buddy/img/:name", (req, res) => {
  try {
    const name = path.basename(req.params.name);
    if (!/^[\w.-]+\.(jpe?g|png|webp)$/i.test(name)) { res.sendStatus(400); return; }
    const file = path.join(watcherImageDir(), name);
    if (!fs.existsSync(file)) { res.status(404).json({ error: "That screenshot no longer exists." }); return; }
    res.type(path.extname(name).toLowerCase() === ".png" ? "image/png" : path.extname(name).toLowerCase() === ".webp" ? "image/webp" : "image/jpeg");
    res.set("Cache-Control", "private, max-age=3600");
    fs.createReadStream(file).pipe(res);
  } catch (err) { sendError(res, err); }
});

// Inspect Buddy settings: master switch, Claude use, web search fallback.
router.get("/buddy/inspect/settings", async (_req, res) => {
  try { res.json((await watcherReady()).settings()); } catch (err) { sendError(res, err); }
});

router.patch("/buddy/inspect/settings", async (req, res) => {
  try {
    const settings = await (await watcherReady()).updateSettings(req.body);
    activity.add("inspect-buddy", `${req.account!.displayName} changed the Inspect Buddy settings`, req.account!.username);
    res.json(settings);
  } catch (err) { sendError(res, err); }
});

export default router;
