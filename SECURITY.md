# WINRSS.net security and licensing model

This document describes how the subscription/license system is enforced and
how the client is hardened. The guiding principle is **server-authoritative
enforcement**: the relay, not the client, decides whether a company may run
sessions. A tampered or copied client cannot grant itself access, because the
decision is never made on the PC.

## Who can do what

- **Admins** manage accounts, plans, subscriptions and payments at `/admin`.
  All `/api/admin/*` and `/api/billing/*` routes require an admin session
  cookie (`requireUser("admin")`); non-admins get `401`/`403`.
- **Companies** sign in to connect to their PCs. A company only ever sees its
  own RA ID's PCs and requests.
- **Hosts (PCs)** register unattended access and serve sessions. They
  authenticate per session with a bearer token the relay issues; viewer and
  host capabilities cannot be swapped.

## Subscription enforcement (the core control)

Every company (one RA ID) can hold a subscription. The relay enforces it at
the point a PC tries to become available:

- `POST /api/msfwr/standing` (a PC registering unattended access) and
  `POST /api/msfwr/call` (Initiate) call `gateForRa(raId, license)`.
- If the company's subscription is **expired, suspended, or over its session
  quota**, the relay returns **HTTP 402** and the PC does not register, so it
  cannot serve anyone. The client shows the reason and backs off.
- A company with **no subscription on record is not gated** (backwards
  compatible). Enforcement begins the moment an operator assigns a plan.
- Each session that goes **live** is counted against the company's quota
  (`countSession`), and each ended session is written to history with its
  duration, viewers and operator. Counting and history are driven by store
  lifecycle hooks, so they cannot be skipped by the client.

Because this runs on the relay, patching the Windows client cannot bypass it:
the client has no way to mint an "active" answer the relay will accept.

## Licenses

A license is an HMAC-SHA256 token the relay signs with `BILLING_SECRET` (or
`SESSION_SECRET`). It binds a **company account id**, an **RA ID**, and a
**license version**:

```
L1.<accountId>.<raId>.<version>.<issuedAt>.<signature>
```

- The client carries the license and sends it on every registration. It is
  **opaque to the client** — the signing key never leaves the relay, so a
  client cannot forge or alter a license.
- The relay verifies the signature and that the license matches the claimed
  company. A **mismatched or forged license is always refused** (`402`,
  reason `license`), even if that company's subscription is active. This stops
  one company's client from being repointed at another company's RA ID.
- **Revocation** is immediate: bumping the subscription's `licenseVersion`
  (admin "Revoke licenses") invalidates every previously issued license. The
  PC must be reconfigured.
- A subscription may set **Require a licensed client**. Then a registration
  without a valid, current license is refused — this blocks copied clients and
  makes revocation hard-fail. It is off by default so existing PCs keep working
  until licensed clients are rolled out.

## Per-company client provisioning

The admin console's **Configure client** issues a license and emits:

- a `winrss-client.json` config file (relay URL, RA ID, license), and
- a build command that bakes the same values into a per-company installer via
  `-ldflags "-X main.embeddedRelay=… -X main.embeddedRA=… -X main.embeddedLicense=…"`.

On first run the client auto-configures unattended access from either source
(the file takes precedence), so the PC needs no manual setup. The unattended
key is preserved across re-provisioning, so the access code is stable.

## Request-level hardening

- **Security headers** on every API response (`securityHeaders`):
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy: same-origin`.
  TLS/HSTS is owned by the Vercel/Render proxies.
- **Rate limiting**: sign-in attempts are limited per username and per address
  (`portal.ts`). Host registration is limited globally and **per PC key**
  (`keyedLimiter`), so one client cannot flood the relay or a company's gate
  checks. Join/Initiate/link endpoints keep their existing throttles.
- **Constant-time comparisons** for tokens, PINs and license signatures
  (`timingSafeEqual`), and timing-equalised password verification for unknown
  usernames.
- **Fail-safe, not fail-open-wide**: if the billing store cannot be read, the
  gate logs and allows the session rather than taking the whole relay down.
  Operate the relay with a persistent `MSFWR_DATA_DIR` or `DATABASE_URL` so
  subscriptions and licenses survive restarts.

## Client tamper resistance

The honest position: no client-side check makes a binary "uncrackable." The
design therefore keeps the authority on the server (above) and hardens the
client as defence-in-depth:

- Release builds use `-trimpath -ldflags "-s -w"`, stripping symbols, the
  symbol table and local build paths.
- The license is validated **server-side on every registration**, so removing
  or faking the client's own checks changes nothing the relay trusts.
- Secrets never ship in the client. The unattended key is per-PC and random;
  the license is signed elsewhere.
- Optional, for operators who want more: build with an obfuscator such as
  [garble](https://github.com/burrowers/garble) (`garble build` in place of
  `go build`) and code-sign the installer (`build.sh --sign-with <signer>`).

## Operational checklist

- Set `ADMIN_PASSWORD`, `SESSION_SECRET`, and (optionally) `BILLING_SECRET` in
  the relay environment; keep them stable.
- Use a persistent disk (`MSFWR_DATA_DIR`) or `DATABASE_URL` so accounts,
  subscriptions, licenses and payments are durable.
- For strict deployments, enable **Require a licensed client** per company and
  roll out configured clients.
