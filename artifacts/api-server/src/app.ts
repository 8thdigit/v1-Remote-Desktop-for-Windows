import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { securityHeaders } from "./lib/security";

// The built frontend (artifacts/msfwr/dist/public) is shipped alongside the
// relay so links like https://<relay>/r/<code>#<id> work when opened directly.
const appDir = path.dirname(fileURLToPath(import.meta.url));
const frontendCandidates = [
  process.env.FRONTEND_DIST_DIR,
  path.resolve(appDir, "../../msfwr/dist/public"), // deployed layout
  path.resolve(appDir, "../../../artifacts/msfwr/dist/public"), // bundled dist/index.mjs layout
].filter((p): p is string => Boolean(p));
const frontendDist = frontendCandidates.find((p) => fs.existsSync(path.join(p, "index.html")));

const app: Express = express();
// Render (and Vercel in front of it) terminate TLS in proxies, so trust the
// forwarded protocol and address for secure cookies and sign-in limits.
app.set("trust proxy", 2);

app.use(
  pinoHttp({
    logger,
    autoLogging: { ignore: (req) => /^\/api\/msfwr\/(?:tick|frame|input|events|view)(?:\?|$)/.test(req.url ?? "") },
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
// Site settings carry uploaded images (logo, favicon, share image) as data
// URLs, so that one admin route takes larger bodies than the rest.
app.use("/api/admin/site", express.json({ limit: "3mb" }));
// Inspect Buddy: document uploads (data URLs) and watcher screen captures
// (JPEG frames) travel as JSON bodies, so these routes need more headroom.
app.use("/api/admin/buddy/repo/documents", express.json({ limit: "12mb" }));
app.use("/api/buddy/capture", express.json({ limit: "6mb" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Baseline security headers on every API response.
app.use(securityHeaders());

app.use("/api", router);

// Serve the built frontend so relay links (e.g. /r/<code>#<id>) open the app
// directly on this host instead of returning "Cannot GET". Static assets are
// served from disk; any other non-API GET falls back to index.html, which lets
// the client-side router handle paths like /admin and /r/:code.
if (frontendDist) {
  const indexHtml = path.join(frontendDist, "index.html");
  app.use(express.static(frontendDist, { index: false, maxAge: "1h" }));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(indexHtml);
  });
}

export default app;
