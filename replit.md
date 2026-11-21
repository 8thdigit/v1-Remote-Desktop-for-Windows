# winss132r

An installable Windows host and browser viewer for attended remote support over HTTPS.
The user uses winss132r as an internal lab application.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `bash windows-host/build.sh` — rebuild the x64 installer with Go and NSIS
- `node --test artifacts/api-server/tests/deskline.test.mjs` — run relay session tests
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- The winss132r preview does not use PostgreSQL; keep one API instance for active sessions.
- Set `LAB_OPERATOR_EMAIL` to the verified primary email of the approved Clerk account. Unconfigured or unmatched accounts cannot join a host. Public information and the installer remain accessible.

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
- `artifacts/api-server/src/routes/deskline.ts` — session and frame transport

## Architecture decisions

- Keep the host and viewer on the same HTTPS relay origin. Binary frame polling avoids a second protocol or a separate ingress port.
- Keep screen frames, input queues and session tokens in bounded process memory, not durable storage. Use a trusted TLS-terminating relay; this is not end-to-end encryption.

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
