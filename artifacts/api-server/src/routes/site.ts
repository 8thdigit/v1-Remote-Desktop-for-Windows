import { Router } from "express";
import type { AssetKind } from "../lib/site";
import { keyedLimiter } from "../lib/security";
import { activity, sendError, siteReady } from "../lib/portal";
import { logger } from "../lib/logger";

// Public site endpoints: the settings every page reads (logo, favicon, share
// tags, visible sections, page content), the uploaded images, and the
// "Request access" form on the sign-in page.
const router = Router();

const KINDS: AssetKind[] = ["logo", "favicon", "og"];
// Five access requests per address per hour, and 200 a day in total, so the
// public form cannot be used to flood the admin console.
const perAddress = keyedLimiter(5, 60 * 60_000);
const perDay = keyedLimiter(200, 24 * 60 * 60_000);

router.get("/settings", async (_req, res) => {
  try {
    const site = await siteReady();
    // Revalidated on every load (a 304 when nothing changed), so an admin's
    // change shows on the next page load.
    res.set("Cache-Control", "no-cache");
    res.json(site.publicSettings());
  } catch (err) { sendError(res, err); }
});

router.get("/asset/:kind", async (req, res) => {
  try {
    const kind = req.params.kind as AssetKind;
    if (!KINDS.includes(kind)) { res.sendStatus(404); return; }
    const asset = (await siteReady()).getAsset(kind);
    if (!asset) { res.sendStatus(404); return; }
    res.set({
      "Content-Type": asset.type,
      // The URL carries the version, so a new upload gets a new URL.
      "Cache-Control": req.query["v"] ? "public, max-age=31536000, immutable" : "public, max-age=300",
      // Social networks and browsers load these from other origins.
      "Cross-Origin-Resource-Policy": "cross-origin",
      // An uploaded SVG must never run script, even when opened directly.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    });
    res.send(Buffer.from(asset.data, "base64"));
  } catch (err) { sendError(res, err); }
});

router.post("/requests", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    if (!req.is("application/json")) { res.status(415).json({ error: "Send the request as JSON." }); return; }
    const site = await siteReady();
    if (!site.publicSettings().signIn.requestAccess) { res.status(403).json({ error: "Access requests are closed." }); return; }
    const body = (req.body ?? {}) as Record<string, unknown>;
    // A field people never see: bots that fill it in get a quiet success.
    if (typeof body["website"] === "string" && body["website"].trim()) { res.status(201).json({ ok: true }); return; }
    const address = req.ip ?? "";
    if (perAddress.hit(address) || perDay.hit("all")) {
      res.status(429).json({ error: "Too many requests. Try again in an hour." });
      return;
    }
    const entry = await site.addRegistration({
      name: body["name"], company: body["company"], email: body["email"], mobile: body["mobile"], message: body["message"],
    });
    activity.add("registration", `Access request from ${entry.name}${entry.company ? ` (${entry.company})` : ""}`);
    logger.info({ id: entry.id }, "Access request received");
    res.status(201).json({ ok: true });
  } catch (err) { sendError(res, err); }
});

export default router;
