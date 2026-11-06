# Settl.ai System Performance Optimization Plan

> **Date:** 2026-11-07
> **Spec:** [`docs/superpowers/specs/2026-11-07-performance-optimization-design.md`](../specs/2026-11-07-performance-optimization-design.md)
> **Goal:** Achieve <2s warm navigation for primary content, zero blockchain reads on configuration screens, immediate labeled balance snapshots with background refresh (15s reuse / 30s active polling), no duplicate post-payment chain reads in the broker, and <200ms truthful action feedback.

---

## Task Matrix & File Ownership

| Slice | Files Owned | Responsibility |
|---|---|---|
| **Slice 1: Schema & Timing Instrumentation** | `apps/web/prisma/schema.prisma`, `apps/web/lib/server/timing.ts`, `apps/web/lib/server/timing.test.ts` | Additive `Provider` balance snapshot fields (`cachedPendingBalance`, `pendingBalanceUpdatedAt`), justified indexes, sanitized timing & correlation logger. |
| **Slice 2: Focused Loaders & Pagination** | `apps/web/lib/server/dashboard.ts`, `apps/web/lib/server/dashboard.test.ts`, `apps/web/lib/server/workspace-accounts.ts`, `apps/web/app/provider/page.tsx`, `apps/web/app/provider/endpoints/page.tsx`, `apps/web/app/provider/earnings/page.tsx`, `apps/web/app/buyer/page.tsx`, `apps/web/app/buyer/agents/new/page.tsx`, `apps/web/app/buyer/agents/[id]/page.tsx` | Request-scoped org resolution (`React.cache`), focused queries per screen, zero RPC reads during page render, 25-row cursor pagination, complete-dataset database aggregates. |
| **Slice 3: Balance Service & Refresh Endpoints** | `apps/web/lib/server/balances.ts`, `apps/web/lib/server/balances.test.ts`, `apps/web/app/api/agents/[id]/balance/route.ts`, `apps/web/app/api/agents/[id]/balance/route.test.ts`, `apps/web/app/api/provider/balance/route.ts`, `apps/web/app/api/provider/balance/route.test.ts` | 15s freshness reuse, in-flight deduplication, bounded RPC wait, DB snapshot persistence, fallback retention on error, tenant-scoped `private, no-store` endpoints. |
| **Slice 4: Broker Post-Payment Optimization** | `apps/web/lib/server/broker.ts`, `apps/web/lib/server/broker.test.ts`, `apps/web/lib/server/outcome.test.ts` | Remove duplicate post-payment `balanceOf` and `pendingBalance` RPC reads from `effectsFor` while preserving outbox enqueue, planned effects, receipt persistence, and all financial locks. |
| **Slice 5: Client Balance Poller, Pagination & Truthful Progress UI** | `apps/web/components/buyer/agent-budget.tsx`, `apps/web/components/buyer/live-agent-controls.tsx`, `apps/web/components/buyer/new-agent-form.tsx`, `apps/web/components/provider/claim-panel.tsx`, `apps/web/components/provider/calls-panel.tsx`, `apps/web/components/provider/endpoint-tools.tsx`, `apps/web/components/buyer/live-actions.test.tsx`, `apps/web/components/provider/calls-panel.test.tsx` | Background balance refresh on entry + every 30s while visible, "Checking balance…" when no snapshot exists, observation timestamp display, cursor pagination UI, and immediate truthful submission states. |

---

## Step-by-Step Execution Plan

### Step 1: Additive Schema & Timing Helper (TDD)
1. Write `apps/web/lib/server/timing.test.ts` verifying correlation ID generation, phase timing capture (`auth`, `db`, `rpc_prep`, `settlement`, `provider_call`, `post_payment`), and redaction of sensitive keys (`authorization`, `secret`, `token`, `signature`, `apiKey`).
2. Implement `apps/web/lib/server/timing.ts`.
3. Update `apps/web/prisma/schema.prisma` with nullable `cachedPendingBalance` and `pendingBalanceUpdatedAt` on `Provider`, plus composite indexes on `Payment([status, confirmedAt])`, `Quote([endpointId, createdAt])`, and `Claim([providerId, createdAt])`.
4. Run `npm run db:generate -w web`.

### Step 2: Balance Refresh Service & API Routes (TDD)
1. Write `apps/web/lib/server/balances.test.ts`, `apps/web/app/api/agents/[id]/balance/route.test.ts`, and `apps/web/app/api/provider/balance/route.test.ts` covering:
   - 15-second cache reuse without RPC call.
   - Concurrent request deduplication (single RPC call for parallel callers).
   - Bounded RPC timeout and retention of previous snapshot/timestamp on failure.
   - Missing snapshot returning `{ amountStroops: null, source: 'unavailable', asOf: null }`.
   - Strict tenant isolation (buyer A cannot read/refresh buyer B's agent; provider cannot read buyer agent).
   - `Cache-Control: private, no-store` header.
2. Implement `apps/web/lib/server/balances.ts` and the two route handlers.

### Step 3: Focused Dashboard Loaders & Cursor Pagination (TDD)
1. Expand `apps/web/lib/server/dashboard.test.ts` to test:
   - `loadProviderEndpoints` and `loadNewAgentForm` make **zero** chain RPC calls and **zero** payment row queries.
   - `loadBuyerAgentDetail` queries only the requested `agentId` scoped to `orgId`.
   - `loadProviderHome`, `loadProviderEarnings`, `loadBuyerHome`, and `loadBuyerAgentDetail` return immediate snapshot balances (`source: 'cache'` or `'unavailable'`) without blocking on Stellar RPC, fetch at most 25 history rows initially with `nextCursor`, and compute summary totals from full-dataset database aggregates.
2. Implement focused loaders in `apps/web/lib/server/dashboard.ts` and wire the 6 page files (`app/provider/page.tsx`, `app/provider/endpoints/page.tsx`, `app/provider/earnings/page.tsx`, `app/buyer/page.tsx`, `app/buyer/agents/new/page.tsx`, `app/buyer/agents/[id]/page.tsx`).

### Step 4: Broker Post-Payment Optimization & Timing (TDD)
1. Update `apps/web/lib/server/broker.test.ts` and `apps/web/lib/server/outcome.test.ts` to assert that `executeCall` and `verifyOutcome` do **not** call `chain.balanceOf` or `chain.pendingBalance` after settlement, while still returning planned effects and committing the `WebhookEvent` outbox intent.
2. Update `apps/web/lib/server/broker.ts` to remove post-payment RPC reads from `effectsFor` and instrument phases with `timing.ts`.

### Step 5: UI Balance Refresh, Truthful Progress & Verification (TDD)
1. Update component tests (`apps/web/components/buyer/live-actions.test.tsx`, `apps/web/components/provider/calls-panel.test.tsx`, `apps/web/components/buyer/new-agent-form.test.tsx`) to verify:
   - `"Checking balance…"` when `amountStroops === null` during refresh, and timestamp display when snapshot exists.
   - Automatic background refresh on mount and 30s interval when tab is visible.
   - Immediate truthful button/status states (`Submitting…`, `Awaiting confirmation…`) and non-retry on failure/timeout.
2. Update UI components (`AgentBudget`, `ClaimPanel`, `CallsPanel`, `NewAgentForm`, `AddRouteForm`, `AgentControls`, ` BuyerAgentsPage`, `ProviderHome`).
3. Run full verification in the Node 24.22.1 Linux environment (`npm test && npm run typecheck && npm run lint && npm run build`), apply additive schema changes to Neon, deploy to Vercel, and measure before/after timings and presentation flow.

