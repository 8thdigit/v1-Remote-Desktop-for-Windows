import type { NextFunction, Request, Response } from "express";

// Relay hardening used across the app: baseline security headers and a
// reusable fixed-window rate limiter keyed by any string (RA ID, PC key or
// client address). The license issuing and validation live in billing.ts;
// this module is the request-level defence that sits in front of it.

// A conservative set of headers for an API that is proxied behind Vercel and
// Render. We do not set HSTS here (the proxies own TLS and their own HSTS),
// but we stop sniffing, framing and referrer leakage, and keep API responses
// uncacheable by shared caches.
export function securityHeaders() {
  return (_req: Request, res: Response, next: NextFunction) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Cross-Origin-Resource-Policy": "same-origin",
      "X-Permitted-Cross-Domain-Policies": "none",
    });
    next();
  };
}

// A fixed-window limiter keyed by an arbitrary string. Separate from the
// sign-in limiter in portal.ts so host-registration abuse (one company's
// quota, one PC key) can be bounded independently. Memory-only and bounded.
export function keyedLimiter(max: number, windowMs: number, cap = 20_000) {
  const hits = new Map<string, { since: number; count: number }>();
  const sweep = (now: number) => {
    if (hits.size <= cap) return;
    for (const [k, v] of hits) if (now - v.since >= windowMs) hits.delete(k);
  };
  return {
    // Records a hit and reports whether the key is now over the limit.
    hit(key: string, now = Date.now()): boolean {
      const h = hits.get(key);
      if (!h || now - h.since >= windowMs) {
        hits.set(key, { since: now, count: 1 });
        sweep(now);
        return false;
      }
      h.count += 1;
      return h.count > max;
    },
    blocked(key: string, now = Date.now()): boolean {
      const h = hits.get(key);
      return !!h && now - h.since < windowMs && h.count > max;
    },
    reset(key: string) { hits.delete(key); },
    get size() { return hits.size; },
  };
}

export type KeyedLimiter = ReturnType<typeof keyedLimiter>;
