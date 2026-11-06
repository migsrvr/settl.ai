# Settl.ai: Phases 4 through 8 Implementation Plan

- **Author:** Gemini Planner (in coordination with Codex Senior)
- **Target Deadline:** Sunday, Nov 8, 2026, 8:00 AM Manila
- **Scope:** Complete live build for Phases 4 through 8

---

## 1. Overview & Current State

- **Phase 1 (Live Chain Gate): VERIFIED ON-CHAIN**
  - Full testnet lifecycle (`registerDevice`, `registerAgent`, `fundEscrow`, `authorize`, `claim`, `revokeAgent`, `sweepOnRevoke`, `revokeDevice`) executed with real Soroban hashes.
  - Velo Gas Station and local relayer fee-bump fallback confirmed.
- **Phase 2 (Persistence & Custodial Wallets): VERIFIED IN DB**
  - Neon Postgres schema synced (`apps/web/prisma/schema.prisma`).
  - AES-256-GCM custodial wallet encryption verified (`wallets.ts`).
  - Seed script populated ResiboAI (Mara), Juan's Bookkeeper, and GeoPH.
- **Phase 3 (Broker Core & Provider SDK): VERIFIED**
  - `@settl/sdk` Express middleware issuing 402 quotes and verifying `X-PAYMENT` proofs.
  - Broker engine (`apps/web/lib/server/broker.ts`) with Postgres row locks (`SELECT ... FOR UPDATE`), monotonic nonces, and Soroban `authorize()` execution.
  - REST routes: `POST /api/quotes`, `POST /api/payments/verify`, `POST /api/agent/call`.
  - **Full test suite: 258/258 tests passing**, 0 typecheck errors, 0 lint errors, clean production build.

---

## 2. Multi-Agent Delegation & Standpoints

```
┌───────────────────────────────────────────────────────────────┐
│               Gemini Planner (Session 506c1836)               │
│  - Overall project architecture & requirement authority       │
│  - Contract & protocol schema definitions                     │
│  - Executes 100% of test, typecheck, lint, and build commands │
│  - Zero direct application coding                             │
└───────────────────────────────┬───────────────────────────────┘
                                │ Agent Manager (send_session)
┌───────────────────────────────▼───────────────────────────────┐
│               Codex Senior (Session 964c79e3)                 │
│  - Engineering Lead & implementation owner                    │
│  - Zero command execution (no tests, lint, builds, or DB ops) │
│  - Coordinates internal subagents for modular code writes:    │
│    • SDK & Provider Worker (apps/resibo)                      │
│    • MCP & Agent Worker (apps/web/app/mcp, apps/agent)        │
│    • Backend Worker (verify, automations, approvals)          │
└───────────────────────────────────────────────────────────────┘
```

---

## 3. Detailed Specifications by Phase

### Phase 4: Demo Provider (`apps/resibo`) - **COMPLETE & VERIFIED**

A standalone Express microservice representing ResiboAI (receipt OCR) and GeoPH, guarded by `@settl/sdk`. Verified with 28 passing tests in `@settl/resibo`.

- **Directory:** `apps/resibo`
- **Dependencies:** `@settl/sdk`, `express`, `zod`
- **Three Monetized Endpoints:**
  1. `POST /parse-receipt`:
     - Guarded by `settl({ endpointId: "resibo_parse" })`
     - Price: ₱2.00 (`mode: "outcome"`, criteria: `resibo.receipt.v1`)
     - Selects fixture based on request body `{ fixture?: "clean" | "blurry" | "wrong_total" }`
     - Returns OCR result conforming to `ReceiptV1` from `@settl/verifier`
  2. `POST /parse-receipt-pro`:
     - Guarded by `settl({ endpointId: "resibo_pro" })`
     - Price: ₱15.00 (`mode: "per_call"`)
     - Purpose: Demonstrates **policy cap block** (Bookkeeper agent policy has `maxPricePerCall = ₱10.00`, so the broker declines this before any money moves).
  3. `POST /lookup`:
     - Guarded by `settl({ endpointId: "geoph_lookup" })`
     - Price: ₱8.00 (`mode: "per_call"`)
     - Purpose: Demonstrates **human approval flow** (Price ₱8.00 exceeds `autoApproveUpTo = ₱5.00`, so broker requires buyer approval).
- **Fixtures (`apps/resibo/src/fixtures.ts`):**
  - `clean`: Confidence `0.98`, line items sum to total (`1250.50`), valid date. Passes all 5 checks.
  - `blurry`: Confidence `0.42`. Fails minConfidence threshold (`0.85`).
  - `wrong_total`: Line items sum to `200.00`, total says `500.00`. Fails sum tolerance check.

---

### Phase 5: Hosted MCP Server (`apps/web/app/mcp/route.ts`) - **COMPLETE & VERIFIED**

Implements a standard Model Context Protocol (MCP) server over Streamable HTTP / Server-Sent Events (SSE) directly in the Next.js App Router. Verified with unit tests in `apps/web/app/mcp/route.test.ts` and active `/mcp` route compiled in Turbopack.

- **Route:** `POST /mcp` (and `GET /mcp` for SSE stream)
- **Authentication:** `Authorization: Bearer stl_agent_...`
  - Tokens are hashed with SHA-256 and matched against `AgentApiKey` records in Postgres.
  - Invalid or revoked keys return 401 Unauthorized.
- **The 6 Tools:**
  1. `settl_list_services`:
     - Arguments: `{}`
     - Returns: All active endpoints from database with descriptions, pricing in PHP & XLM stroops, and mode.
  2. `settl_get_budget`:
     - Arguments: `{}`
     - Returns: Escrow balance on testnet, daily budget, today's spend, held reservations, remaining budget, policy expiry, and pending approvals.
  3. `settl_quote`:
     - Arguments: `{ serviceId: string }`
     - Returns: `Quote` conforming to `QuoteSchema`.
  4. `settl_call`:
     - Arguments: `{ serviceId: string, input?: unknown, maxPricePhp?: string, approvalId?: string }`
     - Runs `broker.executeCall(...)`. Returns call status, receipt, and provider data.
  5. `settl_check_approval`:
     - Arguments: `{ approvalId: string }`
     - Queries `Approval` record; returns status (`pending`, `approved`, `declined`, `expired`).
  6. `settl_receipts`:
     - Arguments: `{ limit?: number }`
     - Returns: Recent receipts for this agent.

---

### Phase 7: Settl on Result (Outcome Mode End-to-End) - **COMPLETE & VERIFIED**

Implements the outcome-based payment guarantee: money moves on Stellar testnet ONLY when the provider's result passes deterministic checks. Verified with `apps/web/app/api/verify/route.test.ts` and `apps/web/lib/server/outcome.test.ts`.

- **Flow & Routes:**
  1. `POST /api/verify`:
     - Provider SDK submits `{ quoteId, result, endpointId }`.
     - Validates that quote is in `outcome` mode and has an active `Reservation` (`held`).
     - Evaluates deterministic checks using `runChecks(quote.criteria, result)` from `@settl/verifier`.
     - **If PASS:**
       - Decrypts agent custodial wallet and executes Soroban `authorize()` on testnet.
       - Transitions Reservation: `held -> settled`.
       - Marks Quote and Payment `paid`.
       - Returns `{ verification: "pass", receipt: { status: "paid", txHash } }`.
     - **If FAIL:**
       - Transitions Reservation: `held -> released` (`reason: "checks_failed"`).
       - No on-chain transaction is submitted. Escrow budget remains uncharged.
       - Returns `{ verification: "fail", receipt: { status: "not_charged", checks } }`.

---

### Phase 8: Automations (Webhooks, Auto-Claim, Budget Alerts, Approvals)

1. **Outbound Signed Webhooks (`apps/web/lib/server/dispatcher.ts`):**
   - Events: `payment.paid`, `payment.not_charged`, `payment.blocked`, `approval.requested`, `approval.resolved`, `budget.low`, `topup.completed`, `claim.completed`.
   - Signed with HMAC-SHA256 (`x-settl-signature: t=<unix>,v1=<hmac>`) and `x-settl-delivery`.
   - 3 retries with exponential backoff.
2. **Auto-Claim Engine (`apps/web/lib/server/claims.ts`):**
   - Automatically signs `payment_escrow.claim()` when provider's pending balance reaches `autoClaimThreshold`.
   - Also provides cron trigger `POST /api/cron/auto-claim`.
3. **Low-Budget Alerts:**
   - Emits `budget.low` when agent balance falls below `lowBudgetAlert`.
4. **Mobile Buyer Approval Resolution (`/buyer/approvals/[id]`):**
   - `POST /api/approvals/[id]/resolve` with `{ decision: "approved" | "declined" }`.
   - Wires live approval button to [`apps/web/components/buyer/approval-card.tsx`](apps/web/components/buyer/approval-card.tsx).

---

## 4. Verification Gate per Phase

Every phase must pass:
1. `npm install` (links workspaces and updates lockfile)
2. `npm test` (Vitest across all workspaces)
3. `npm run typecheck` (`tsc --noEmit` across all workspaces)
4. `npm run lint` (`eslint`)
5. `npm run build` (Next.js Turbopack build)
