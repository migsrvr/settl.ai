# Settl sandbox and publishable SDK: design

Status: approved by the user on 2026-11-10 (plan mode). Supersedes the placeholder SDK snippets on the landing page.

## Problem
A developer cannot try Settl without Neon, Velo credentials and funded Stellar wallets. `@settl/sdk` is `private` and exports raw TypeScript, the landing page shows APIs that do not exist, and the SDK supports Express only. The goal is `npm i` to a working paid call in about five minutes, locally, with no accounts.

## Decisions
- **Sandbox = the real broker on PGlite plus a fake chain.** No second implementation of the quote, policy, reservation or MCP logic. Fake money, fake transaction hashes, real policy and receipts.
- **Packages under the `@settl` npm scope:** `@settl/core`, `@settl/sdk`, `@settl/client`, `@settl/dev`. Publishing happens only on the user's explicit go-ahead; the build and `npm pack` are in scope.
- **This slice also delivers:** a Fetch-API `withSettl` adapter (plus Next.js and Hono wrappers), endpoint auto-registration, a `settlFetch` agent client, and corrected landing/docs snippets.

## Spike result (2026-11-10, Linux, Node 24.22.1, Prisma 7.10.1, PGlite 0.4.3, pglite-socket 0.1.3)
- DDL from `prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script` (469 lines, 18 tables) applies cleanly to PGlite in about 2 s total boot.
- `PrismaClient` + `PrismaPg` over `PGLiteSocketServer` works for `$queryRaw`, interactive `$transaction`, `SELECT ... FOR UPDATE`, and two concurrent transactions.
- **The pool must be `max: 1`.** With `max: 5` the socket multiplexer dropped the connection ("Connection terminated unexpectedly"). Consequence: code must not use the global client while inside a transaction (self-deadlock); the broker already uses `tx` consistently, verified by tests below.

## Architecture
```
packages/core      schemas, headers, amounts           (published, built with tsup)
packages/sdk       settl() Express + withSettl() Fetch  (published)
packages/client    settlFetch(), settlTools()           (published)
packages/dev       settl-dev CLI: PGlite + FakeChain + HTTP gateway + /mcp (published)
apps/web           production gateway; lib/server gets db/chain injection seams and shared handlers
```
`apps/web/lib/server/handlers/*` holds the pure request handlers (quotes, payments verify, verify, agent call, endpoint register, approval resolve). Next route files and the sandbox HTTP server both call them.

## Seams (apps/web/lib/server)
- `db.ts`: `setDb(client)` overrides the lazily built Neon client.
- `chain.ts`: `getChain()` / `setChain()` return the broker's chain subset (`authorize`, `readAuthorizeTx`, `pendingBalance`, `balanceOf`). The default builds the real Stellar client from env. `mcp-tools.ts` and the production broker use it.

## Sandbox behavior
- `npx @settl/dev` starts a gateway on localhost, seeds the demo providers/agent (existing `seedDemo`), marks the agent active with a long-dated policy, and prints: gateway URL, provider key, agent key, MCP URL, paste-ready MCP config.
- `FakeChain`: balances per device hash, pending earnings per merchant, strictly increasing nonce per (device, agent), deterministic 64-hex tx hashes, optional `--balance` and `--fail-next`.
- Approvals resolve with `--auto-approve` or `POST /api/approvals/:id/resolve` without a cookie (sandbox only).
- Everything is labeled sandbox; `network` stays `stellar:testnet` because `QuoteSchema` fixes it.

## SDK changes
- One shared core for quote / verify / outcome flow; Express `settl()` and Fetch `withSettl()` are thin adapters. Existing `settl({ endpointId })` keeps working.
- Auto-register: `settl({ name, description, price, mode, route })` upserts the endpoint through `POST /api/provider/endpoints` and caches the id. Production keeps the `SETTL_PROVIDER_ALLOWED_ORIGINS` check; per-provider keys and URL ownership proof are a later slice.
- Short-TTL quote cache per endpoint; each quote stays single-use at the gateway.

## Out of scope
Per-provider API keys, URL ownership verification, x402 interop, MCP service schemas and typed per-service tools (the separate MCP slice), Velo/Noir changes, `npm publish`.

## Risks
- Handler extraction touches production routes; keep it mechanical, covered by existing route tests.
- `@settl` npm org ownership is unverified.
- PGlite adds roughly 2 s boot and a few tens of MB to `@settl/dev`; acceptable for a dev tool.
