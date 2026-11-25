import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { securityHeaders } from "./lib/security";

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

export default app;
