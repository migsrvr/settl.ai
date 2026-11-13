# Plan: Settl sandbox and publishable SDK

Spec: `docs/superpowers/specs/2026-11-10-settl-sandbox-sdk-design.md`. Rules: tests first (Vitest; server tests start with `// @vitest-environment node`), npm workspaces from the repo root, no commits unless asked. Verification runs in the Linux copy (`~/settl-work` in WSL, Node 24.22.1) because the Windows install is broken (see `docs/REPOSITORY_REVIEW.md`).

Gate after every slice: `npm test && npm run typecheck && npm run lint && npm run build`.

## Slice 1: injection seams
1. `apps/web/lib/server/db.test.ts`: `setDb` overrides `getDb`; unset restores lazy default.
2. `apps/web/lib/server/chain.test.ts`: `getChain` returns the override; default requires Stellar env.
3. Implement `setDb` in `db.ts`, new `chain.ts`; route `mcp-tools.ts` `settl_get_budget` and broker production wiring through `getChain()`.
4. Existing `broker.test.ts`, `mcp-tools.test.ts`, `api-auth.test.ts` stay green.

## Slice 2: handler extraction
For each of `/api/quotes`, `/api/payments/verify`, `/api/verify`, `/api/agent/call`, `/api/provider/endpoints`, `/api/approvals/[id]/resolve`: move logic to `lib/server/handlers/<name>.ts` as `(Request, deps) => Promise<Response>`; route files re-export thin wrappers. Existing route tests must pass unchanged.

## Slice 3: package builds
tsup (ESM + CJS + d.ts) for `core`, `sdk`; metadata (`files`, `license`, `repository`, `engines`, `exports` with a `development` condition to `src`); `express` optional peer; declare `zod` in core. Test: `npm pack` and install in a scratch project outside the workspace.

## Slice 4: sandbox
1. `packages/dev`: `FakeChain` tests (nonce, balance, pending, fail-next), then implementation.
2. `schema.sql` generated from `schema.prisma` with a drift test.
3. PGlite bootstrap (`max: 1`), seed, activate agent.
4. HTTP server bridging Node requests to the shared handlers and `/mcp`.
5. CLI output, `--auto-approve`, `--balance`, `--port`.
6. End-to-end test: start sandbox, run `settl()` provider, buy via REST and MCP, assert paid receipt, `over_max_price` refusal, approval flow.

## Slice 5: SDK features
Shared core refactor; `withSettl` (+ `/next`, `/hono`); auto-register; quote cache. Each with tests against the sandbox.

## Slice 6: `@settl/client`
`settlFetch`, `settlTools` (AI SDK); tests against the sandbox.

## Slice 7: landing, docs, examples
Replace landing snippets, `docs/QUICKSTART.md`, README/SDK README, `examples/{express,next,agent}`; update `HANDOFF.md` and the revision note in `docs/superpowers/plans/2026-11-03-settl.md`.

## Status, 2026-11-10

Slices 1 to 7 are implemented and verified in the Linux copy (`npm test && npm run typecheck && npm run lint && npm run build`, all exit 0). Differences from the plan above:

- Slice 2 moved four route bodies and the approval-resolution core. Endpoint registration for the dashboard (`/api/provider/endpoints`, cookie session) was left alone; the new `POST /api/provider/register` handles in-code registration.
- Slice 5 has no quote cache (a quote is single-use and bound to one agent and nonce) and no separate Hono/Next modules (`withSettl` already takes a Request). It adds `.register()` to both adapters.
- Slice 6 has no `settlFetch(url)`: Settl is custodial, so agents pay by service id. `callAndWait` and `@settl/client/ai` cover the approval flow and AI SDK use.
- Slice 4 is complete as a runnable CLI (`npm run sandbox`), but has no publish bundle yet, so `npx settl-dev` does not work.
- Slice 7 added `examples/` that run in CI against the sandbox, plus a drift test tying the landing snippets to them.

Open: the `@settl/dev` publish bundle, a LICENSE, `@settl` npm scope ownership, and the actual `npm publish` (needs the user's go-ahead).
