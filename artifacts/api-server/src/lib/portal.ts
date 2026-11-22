import { randomBytes } from "node:crypto";
import path from "node:path";
import type { NextFunction, Request, Response } from "express";
import {
  AccountError, createAccounts, createActivityLog, fileBackend, loginTTL, postgresBackend,
  type Accounts, type PublicAccount,
} from "./accounts";
import { createDesklineStore } from "./deskline";
import { logger } from "./logger";

// Shared relay state: the session store, the portal accounts and the
// admin activity log.

export const store = createDesklineStore();
setInterval(store.sweep, 5000).unref();

export const activity = createActivityLog();

export const COOKIE = "winss132r_session";

// While no account exists, the first admin can be created with this code,
// which only the person who can read the relay's log sees.
export let setupCode = "";

async function open(): Promise<Accounts> {
  const url = process.env["DATABASE_URL"];
  let backend;
  if (url) {
    backend = await postgresBackend(url);
  } else {
    const dir = process.env["WINSS132R_DATA_DIR"] || path.resolve(process.cwd(), ".data");
    backend = fileBackend(dir);
  }
  const accounts = await createAccounts(backend, { secret: process.env["SESSION_SECRET"] });
  logger.info({ storage: accounts.backend, users: accounts.list().length }, "Portal accounts loaded");
  if (accounts.empty) {
    const username = (process.env["ADMIN_USERNAME"] || "admin").toLowerCase();
    const password = process.env["ADMIN_PASSWORD"];
    if (password) {
      await accounts.create({ username, displayName: "Administrator", password, role: "admin" });
      logger.warn({ username }, "Created the first admin account from ADMIN_PASSWORD");
    } else {
      setupCode = randomBytes(5).toString("hex").toUpperCase();
      logger.warn(`No portal accounts yet. Open the web app and create the admin account with setup code ${setupCode}`);
    }
  }
  return accounts;
}

let opening: Promise<Accounts> | undefined;
export function accountsReady() {
  opening ??= open().catch((err) => {
    opening = undefined;
    throw err;
  });
  return opening;
}

export function clearSetupCode() { setupCode = ""; }

function readCookie(req: Request, name: string) {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

export function setLogin(req: Request, res: Response, token: string) {
  res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: "strict", secure: req.secure, path: "/", maxAge: loginTTL,
  });
}

export function clearLogin(req: Request, res: Response) {
  res.clearCookie(COOKIE, { httpOnly: true, sameSite: "strict", secure: req.secure, path: "/" });
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { account?: PublicAccount }
  }
}

export async function currentUser(req: Request) {
  const accounts = await accountsReady();
  return accounts.session(readCookie(req, COOKIE));
}

// Cross-site requests cannot send JSON without a CORS preflight, and the
// login cookie is SameSite=Strict, so a JSON body is required for changes.
function jsonOnly(req: Request, res: Response) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "DELETE") return true;
  if (req.is("application/json")) return true;
  res.status(415).json({ error: "Send the request as JSON." });
  return false;
}

export function requireUser(role?: "admin") {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!jsonOnly(req, res)) return;
      const user = await currentUser(req);
      if (!user) { res.status(401).json({ error: "Sign in to continue." }); return; }
      if (role && user.role !== role) { res.status(403).json({ error: "Only admins can do that." }); return; }
      req.account = user;
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function sendError(res: Response, err: unknown) {
  if (err instanceof AccountError) { res.status(err.status).json({ error: err.message }); return; }
  logger.error({ err }, "Portal request failed");
  res.status(500).json({ error: "Something went wrong on the relay. Try again." });
}

export const operatorOf = (u: PublicAccount) => ({ id: u.id, name: u.displayName, raId: u.raId });

// Simple fixed-window limiter keyed by a string, for sign-in attempts.
export function limiter(max: number, windowMs: number) {
  const hits = new Map<string, { since: number; count: number }>();
  return {
    blocked(key: string) {
      const now = Date.now();
      const h = hits.get(key);
      return !!h && now - h.since < windowMs && h.count >= max;
    },
    fail(key: string) {
      const now = Date.now();
      const h = hits.get(key);
      if (!h || now - h.since >= windowMs) hits.set(key, { since: now, count: 1 });
      else h.count += 1;
      if (hits.size > 5000) for (const [k, v] of hits) if (now - v.since >= windowMs) hits.delete(k);
    },
    clear(key: string) { hits.delete(key); },
  };
}
