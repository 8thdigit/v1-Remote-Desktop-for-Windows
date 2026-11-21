import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import { CLERK_PROXY_PATH, clerkProxyMiddleware, getClerkProxyHost } from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    autoLogging: { ignore: (req) => /^\/api\/deskline\/(?:tick|frame|input)(?:\?|$)/.test(req.url ?? "") },
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
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const browserAuth = clerkMiddleware((req) => ({
  publishableKey: publishableKeyFromHost(
    getClerkProxyHost(req) ?? "",
    process.env.CLERK_PUBLISHABLE_KEY,
  ),
}));

app.use("/api/deskline", (req, res, next) => {
  if (/^\/(?:join|frame|input)\/?$/i.test(req.path) ||
      (/^\/end\/?$/i.test(req.path) && req.get("X-Viewer-Session") !== undefined)) {
    return browserAuth(req, res, next);
  }
  return next();
});
app.use("/api", router);

export default app;
