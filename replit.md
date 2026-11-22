# winss132r

An installable Windows host and browser viewer for attended remote support over HTTPS.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `bash windows-host/build.sh` — rebuild the x64 installer with Go and NSIS
- `node --test artifacts/api-server/tests/*.test.mjs` — run relay session and account tests
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Sessions stay in memory; keep one API instance for active sessions.
- Portal accounts are stored in PostgreSQL when `DATABASE_URL` is set (table `winss132r_state`, created automatically), otherwise in `.data/accounts.json` (or `WINSS132R_DATA_DIR`). On Autoscale the file resets on redeploy, so add a database to keep accounts.
- First admin: set `ADMIN_PASSWORD` (and optionally `ADMIN_USERNAME`, default `admin`) before the first start, or open the web app and enter the one-time setup code the API server logs at start.
- `SESSION_SECRET` (if set) signs login cookies; otherwise a secret is generated and stored with the accounts.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `windows-host/` — Windows application, installer recipe, and Windows verification instructions
- `artifacts/deskline/` — browser viewer and installer download
- `artifacts/api-server/src/routes/deskline.ts` — session and frame transport, RA-targeted requests
- `artifacts/api-server/src/routes/auth.ts`, `routes/admin.ts`, `lib/accounts.ts` — portal sign-in, accounts and admin console API
- `artifacts/deskline/src/pages/admin.tsx` — admin console; `LiveSession.tsx` — remote view (full screen, Ctrl+Esc exits)

## Architecture decisions

- Keep the host and viewer on the same HTTPS relay origin. Binary frame polling avoids a second protocol or a separate ingress port.
- Keep screen frames, input queues and session tokens in bounded process memory, not durable storage. Use a trusted TLS-terminating relay; this is not end-to-end encryption.

## Product

- Sign-in portal. Admins manage accounts in the admin console (create, rename, reset password, make admin, disable, delete), see live sessions (and end them), Initiate requests and recent activity.
- Every account has a unique RA ID. A PC set to that RA ID sends its Initiate request only to that person's portal, where they accept it.
- Remote view with full screen (Ctrl+Esc exits; in Chrome/Edge, Esc and other keys go to the PC while in full screen).

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Merging to GitHub does not update https://rdp-system.replit.app. Pull main into the Replit workspace and Republish, or the live relay lacks newer endpoints (for example `/api/deskline/call` and `/calls` for Initiate requests). The viewer shows a red "older build" banner when `/calls` returns 404.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
