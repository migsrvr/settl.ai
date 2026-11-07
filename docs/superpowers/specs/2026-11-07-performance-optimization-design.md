# Settl.ai System Performance Optimization Design

- **Date:** 2026-11-07
- **Status:** Implemented locally; hosted rollout pending
- **Scope revision, Nov 7:** User confirmed website loading and supporting background processing only. MCP tool contracts/handlers and the broker settlement/response path are unchanged.
- **Parent specs:** [`2026-11-04-settl-api-mcp-design.md`](2026-11-04-settl-api-mcp-design.md), [`2026-11-03-settl-ui-design.md`](2026-11-03-settl-ui-design.md)

## 1. Objectives & Constraints

Optimize the entire Settl.ai provider and buyer experience—page rendering, database access, API responses, and transaction interactions—so that warm navigation renders usable primary content within 2 seconds at p95, action feedback appears within 200ms, and the complete presentation (including a live CLI agent purchase via Settl MCP) fits comfortably within two minutes.

### Preserved Invariants
- Preserve all existing product features (provider/buyer dashboards, endpoints, claims, agent creation, policies, revocations, Velo top-ups, human approvals, durable automations, Settl on Result, and `/stage`).
- Retain the financial POST execution model: agent/owner/treasury locks, monotonic nonce allocation, policy checks, approval binding, durable pre-submission pending markers, and uncertain-submission protections.
- Never automatically retry a payment or financial operation when interrupted by navigation, refresh, or network timeout.
- Cached display balances must never authorize spending, claims, or bypass on-chain checks.
- Maintain the Ink & Saffron visual system (`docs/superpowers/specs/2026-11-03-settl-ui-design.md` §2).

---

## 2. Phase 1: Instrumentation, Focused Queries, Pagination & Database Aggregates

### 2.1 Sanitized Timing & Correlation Instrumentation (`apps/web/lib/server/timing.ts`)
- Generate or propagate a safe request correlation ID (`x-correlation-id` or random UUID).
- Record high-resolution phase durations (`auth`, `db`, `rpc_prep`, `settlement`, `provider_call`, `post_payment`) and emit structured JSON timing summaries containing only correlation ID, operation name, status/outcome code, and phase durations in milliseconds.
- Never log bearer tokens, API keys, custodial secrets, webhook signatures, or raw request/response payloads.

### 2.2 Request-Scoped Organization Resolution & Focused Loaders (`apps/web/lib/server/dashboard.ts`)
- Wrap request-time session and organization lookup in `React.cache` so `AppShell` (`WorkspaceShell`) and the page content share the organization lookup within a single render pass while retaining independent server-side role verification.
- Split dashboard data loading into focused route loaders:
  1. **`loadProviderHome(options)`**:
     - Queries provider metadata, pending balance snapshot (`cachedPendingBalance`, `pendingBalanceUpdatedAt`), today's confirmed/not-charged/verified aggregates, 7-day failed check counts, and the first 25 calls (`take: 26` for `nextCursor`).
     - Zero blocking Stellar RPC calls during page render.
  2. **`loadProviderEndpoints()`**:
     - Queries only provider endpoints and today's per-endpoint call counts via `quote.groupBy` / `payment` count.
     - Zero blockchain reads and zero payment history row fetches.
  3. **`loadProviderEarnings(options)`**:
     - Queries provider metadata, pending balance snapshot, auto-claim settings, complete-dataset confirmed earnings sum (`quote.aggregate`), today's confirmed customer breakdown, and the first 25 claims (`take: 26` for `nextCursor`).
     - Zero blocking Stellar RPC calls during page render.
  4. **`loadBuyerHome(options)`**:
     - Queries buyer agents (with `cachedBalance`, `balanceUpdatedAt`, `policy`, held reservation sums), complete-dataset today's spend & uncharged aggregates, today's per-agent spend aggregates, active pending approvals, and the first 25 activity calls (`take: 26` for `nextCursor`).
     - Zero blocking Stellar RPC calls during page render.
  5. **`loadBuyerAgentDetail(agentId, options)`**:
     - Loads **only** the selected agent (`where: { id: agentId, orgId }`), its policy, held reservations sum, today's confirmed spend sum, recent top-ups (bounded to 25), pending approvals for that agent, registered providers (for policy editing), and the first 25 activity calls for that agent (`take: 26` for `nextCursor`).
     - Zero blocking Stellar RPC calls during page render.
  6. **`loadNewAgentForm()`**:
     - Verifies buyer org and loads only registered providers (`id`, `displayName`) and exchange rate.
     - Zero blockchain reads, zero agent reads, zero payment reads.
- Retain `loadProviderDashboard` and `loadBuyerDashboard` as compatibility wrappers or update callers directly while preserving all existing test contracts.

### 2.3 Cursor Pagination & Complete-Dataset Totals
- Initial history queries fetch 25 rows (`DEFAULT_PAGE_SIZE = 25`), ordered by `[{ submittedAt: 'desc' }, { id: 'desc' }]` (for calls) or `[{ createdAt: 'desc' }, { id: 'desc' }]` (for claims), returning `nextCursor: string | null`.
- Add authenticated pagination endpoints (`GET /api/provider/calls`, `GET /api/provider/claims`, `GET /api/buyer/calls`) or cursor query support so `CallsPanel` and `ClaimPanel` can load additional pages without full-page reloads.
- Summary totals (`Earned today`, `Earned in total`, `Spent today`, `Not charged`, `Paid calls`) are computed via database aggregates over the complete dataset rather than summing only the 25 visible rows.
- Add composite indexes in `apps/web/prisma/schema.prisma` justified by these access patterns:
  - `Payment`: `@@index([status, confirmedAt])`
  - `Quote`: `@@index([endpointId, createdAt])`
  - `Claim`: `@@index([providerId, createdAt])`

---

## 3. Phase 2: Decoupled Rendering & Background Balance Refresh

### 3.1 Additive Schema Migration
- Add nullable snapshot columns to `Provider` in `apps/web/prisma/schema.prisma`:
  - `cachedPendingBalance BigInt? @map("cached_pending_balance")`
  - `pendingBalanceUpdatedAt DateTime? @map("pending_balance_updated_at")`
- Reuse `Agent.cachedBalance` and `Agent.balanceUpdatedAt`.

### 3.2 Snapshot Semantics & Display
- Preserve `Balance = { amountStroops: string | null; source: 'chain' | 'cache' | 'unavailable'; asOf: string | null }`.
- Initial page render uses the stored snapshot (`source: 'cache'`, `asOf: updatedAt.toISOString()`) if present, or `{ amountStroops: null, source: 'unavailable', asOf: null }` when no snapshot exists.
- When `amountStroops === null` and a background check is in progress, display `"Checking balance…"` (never an invented zero). When `asOf` is present, display the observation timestamp (`Observed as of …` / `Last verified …`).

### 3.3 Authenticated Balance Refresh Endpoints (`apps/web/lib/server/balances.ts`)
- **`GET /api/agents/[id]/balance`**:
  - Requires buyer session (`requireBuyerOrg`), verifies agent belongs to `orgId`.
  - If `balanceUpdatedAt` is within **15 seconds** (`15_000ms`) of `now()` and `cachedBalance !== null`, immediately returns `{ amountStroops: cachedBalance.toString(), source: 'cache', asOf: balanceUpdatedAt.toISOString() }` without hitting Stellar RPC.
  - Otherwise, deduplicates concurrent in-flight `balanceOf(deviceHash)` reads in-memory, bounds the RPC wait to 8 seconds, updates `cachedBalance` and `balanceUpdatedAt` in Postgres on success using the read-start timestamp and a guard against overwriting newer observations, and returns `{ amountStroops, source: 'chain', asOf }`.
  - On RPC failure/timeout, retains the previous `cachedBalance` and `balanceUpdatedAt` and returns `{ amountStroops: cachedBalance?.toString() ?? null, source: cachedBalance != null ? 'cache' : 'unavailable', asOf: balanceUpdatedAt?.toISOString() ?? null }`.
- **`GET /api/provider/balance`**:
  - Requires provider session (`requireProviderOrg`), resolves the provider for `orgId`.
  - Applies the same 15-second freshness window, concurrent in-flight deduplication per `merchantWallet`, bounded RPC wait, database snapshot persistence (`cachedPendingBalance`, `pendingBalanceUpdatedAt`), and fallback retention on failure.
- Responses always set `Cache-Control: private, no-store`.
- Client components refresh visible balances on entry and every **30 seconds** while `document.visibilityState === 'visible'`.

---

## 4. Phase 3: Existing Background Processing & Interaction Feedback

### 4.1 Remove Duplicate Post-Payment Chain Observations (`apps/web/lib/server/broker.ts`)
- In `broker.ts`, `enqueueEvent` already commits the durable `WebhookEvent` outbox record (`source: "settl"`, `event: "payment.paid"`) inside the payment confirmation transaction.
- Remove the synchronous `chain.balanceOf` and `chain.pendingBalance` RPC calls from `effectsFor()` in `broker.ts` after settlement. Instead, `effectsFor()` uses the already-loaded `agent.settings` (or `cachedBalance`) and `endpoint.provider.settings` (or `cachedPendingBalance`) without blocking on network RPC calls, while `dispatcher.ts` (`flushAutomationEvents` -> `lowBudget` and `claimProvider`) continues to perform authoritative live chain balance checks when draining the outbox.
- Keep `verifyPayment` fast when `quote.payment?.status === "paid"` is already recorded in the database (zero chain RPC calls on the pre-confirmed broker path).

### 4.2 Immediate, Truthful UI States
- Ensure all action controls (`ClaimPanel`, `AgentBudget`, `AgentControls`, `NewAgentForm`, `AddRouteForm`, `ApprovalCard`) transition synchronously (`<200ms`) on click/submit to truthful states (`Submitting…`, `Awaiting confirmation…`, `Pending`, `Confirmed`, `Failed`).
- Disable only conflicting submissions on the active form/control while keeping navigation and unrelated controls usable.
- After mutations, refresh affected balance/section state cleanly without triggering redundant chain reads on every component.

