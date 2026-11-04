# Settl.ai: API, hosted MCP and automations

- **Parent spec:** [`2026-11-03-settl-design.md`](2026-11-03-settl-design.md). This document replaces its §6.2 (pre-signed authorizations) and §7.2 (payment header kinds).
- **Status:** approved 2026-11-04
- **Decisions:**
  - Settl hosts the MCP server and holds agent keys (custodial, testnet only).
  - The demo agent is a scripted AI SDK agent that uses the MCP tools.
  - Payments settle in testnet XLM, shown in pesos at a fixed demo rate (`PHP_PER_XLM`).
  - All four automations are in scope: outbound webhooks, auto-claim, low-budget alerts and approvals.

## 1. Facts from the Noir source and Velo docs

| Topic | What the code does | Consequence for Settl |
|---|---|---|
| `payment_escrow.authorize` | Plain `agent.require_auth()`, then `agent_registry.check_payment(device, agent, asset, amount)` | Settl signs with the custodial agent key. For Settl on Result it signs only after the verifier passes. |
| Nonce | Must be strictly greater than the last, per (device, agent) pair. Gaps are allowed. | At most one payment in flight per agent, enforced with a row lock. Nonces are a monotonic counter. |
| `max_amount` | A cap on each payment. Nothing tracks a running total. | The daily budget and cumulative spend are tracked off-chain. |
| `fund_escrow` | `wallet.require_auth()`. Any wallet can fund any registered device. | A Settl treasury wallet funds escrows after a Velo top-up is confirmed. |
| Escrow token | Fixed per device on the first funding | Native XLM asset contract on testnet |
| `claim(token, merchant)` | Signed by the merchant. Pays all of that merchant's pending payments, across every device. | Auto-claim signs with the provider's custodial wallet |
| Events | `fund`, `authorize(device, merchant)`, `claim(merchant)`, `defund`, `sweep` | Optional indexer for the live feed |
| Velo Gas Station | One signed `invokeHostFunction` per envelope, wrapped in a fee bump. Needs `VELO_GAS_API_KEY`. Only `succeeded` counts. | All agent and provider transactions go through it. Fallback if Noir's contract isn't whitelisted: a Settl relayer pays the fee. |
| Velo webhooks | `payment.succeeded` or `payment.failed`. Headers `x-velo-signature` (HMAC over the raw body) and `x-velo-delivery`. | Verify the signature, de-duplicate by delivery ID, then fund the escrow from the treasury. |
| Reuse | `@noirx402/agent-sdk` 0.3.0 is on npm | The chain adapter wraps it |

## 2. Components
- **Broker** (`apps/web/lib/server/broker.ts`). One engine runs every paid call: quote, then policy, then pay or commit, then receipt. Both the MCP tools and `POST /api/agent/call` use it.
- **Hosted MCP** (`apps/web/app/mcp/route.ts`)
  - Uses `@modelcontextprotocol/server` v2: `createMcpHandler` plus `requireBearerAuth`.
  - Agents authenticate with an `stl_agent_…` key, stored as a SHA-256 hash.
- **Provider SDK** (`packages/sdk`). Middleware that returns 402 quotes, checks payments, and handles the commit and result handshake.
- **Chain adapter** (`packages/stellar`). `@noirx402/agent-sdk` plus Velo Gas Station plus Friendbot setup.
- **Verifier** (`packages/verifier`). The receipt v1 checks.
- **Core** (`packages/core`). Protocol types and Zod schemas, plus peso, XLM and stroop conversion.

## 3. Payment header (replaces parent §7.2)
`X-PAYMENT` is base64 JSON in one of two forms:
- `{ "kind": "tx", "quoteId", "txHash" }`. Per-call: the broker paid before calling.
- `{ "kind": "commit", "quoteId", "reservationId" }`. Settl on Result: the amount is reserved off-chain and paid only if the result passes.

The provider SDK checks either form with the Settl API before running its handler.

## 4. Policy order (`policy.ts`)
1. Is the agent active and not expired? If not: `blocked`.
2. Is the provider on the agent's allowlist? If not: `blocked`.
3. Is the price within the `maxPrice` the caller passed? If not: `declined`.
4. Is spend today plus open reservations plus the price within the daily budget? If not: `declined`.
5. Is the price above the auto-approve limit, with no approved `approvalId`? Then: `approval_required`.
6. Otherwise: `allow`. The on-chain cap can still refuse the payment, which is recorded as `blocked`.

## 5. MCP tools
| Tool | Input | Output status |
|---|---|---|
| `settl_list_services` | none | A list of services |
| `settl_get_budget` | none | Balance, cap, daily spend left, expiry, open approvals |
| `settl_quote` | `serviceId` | 402 terms |
| `settl_call` | `serviceId`, `input`, `maxPricePhp`, `approvalId?` | `paid`, `not_charged`, `blocked`, `declined` or `approval_required` |
| `settl_check_approval` | `approvalId` | `pending`, `approved` or `declined` |
| `settl_receipts` | `limit?` | Recent receipts |

## 6. Automations
- **Outbound webhooks**
  - Headers: `x-settl-signature` (`t=<unix>,v1=<hex hmac-sha256 of "t.body">`) and `x-settl-delivery`.
  - Retries: 3 attempts with backoff.
  - Events: `payment.paid`, `payment.not_charged`, `payment.blocked`, `approval.requested`, `approval.resolved`, `budget.low`, `topup.completed`, `claim.completed`.
- **Auto-claim:** after a settled payment, if the provider's pending total is at or above its threshold, Settl queues a claim. A daily cron is the safety net.
- **Low budget:** after a payment, if the escrow balance is below the agent's alert level, Settl emits `budget.low` and creates a Velo checkout link. One alert per agent per day.
- **Approvals:** the buyer resolves them on the phone screen, which emits `approval.resolved`.
