# Handoff: Settl.ai

Last updated 2026-11-06 by Codex. Read this first, then the docs it links to.

## What this is
**Settl.ai** is an API and MCP payment gateway that lets startups charge AI agents for API and service usage, with automated payments through Noir and Velo on Stellar testnet.
- **Providers** (example: ResiboAI, a receipt-OCR API) put a price on their API.
- **Buyers' AI agents** pay for each call from a prepaid, capped escrow on Stellar. In *Settl on Result* mode they pay only when the result passes agreed checks.
- **Settl** is the facilitator. REST and hosted MCP let agents find paid tools and pay for them, with custodial agent keys for the testnet MVP. Phases 1–10 are accepted and verified.

**Product clarification, Nov 5:** API/MCP is the core product, and the full November 8 demo still requires live provider/buyer dashboards, approvals, automations, top-ups, claims, and an end-to-end agent run. No live features were cut or deferred. The existing demo UI remains part of that delivery. See the [project README](README.md) and [progress report](docs/progress.md).

**Hackathon rules:** the project must use Velo (`@carts1024/velo-sdk`) and the Noir testnet contracts (`device_registry`, `agent_registry`, `payment_escrow`), and the agent must decide, request or make the payment.

**Deadlines (Manila time):** submissions close **Sun Nov 8, 8:00 AM**. Top 10 announced at 11:00 AM; live pitch at 1:00 PM. The organisers' kickoff was Thu Nov 5.

## Read these, in order
1. [`docs/superpowers/specs/2026-11-04-settl-api-mcp-design.md`](docs/superpowers/specs/2026-11-04-settl-api-mcp-design.md): **the current backend design.** Where it disagrees with an older doc, it wins.
2. [`docs/superpowers/specs/2026-11-03-settl-design.md`](docs/superpowers/specs/2026-11-03-settl-design.md): the original product design, demo script and limitations.
3. [`docs/superpowers/plans/2026-11-03-settl.md`](docs/superpowers/plans/2026-11-03-settl.md): the build plan by day. The revision note at the top lists what has changed.
4. [`docs/superpowers/specs/2026-11-03-settl-ui-design.md`](docs/superpowers/specs/2026-11-03-settl-ui-design.md): user flows (§1) and the visual system (§2). Follow §2 for any UI.

## Repository map
```
package.json            npm workspaces (apps/*, packages/*). pnpm is NOT installed; use npm.
tsconfig.base.json      shared TS settings for packages/*
apps/web                Next.js 16 app: UI + initial API routes; hosted MCP pending
  app/                  routes: / (landing), /login, /provider/*, /buyer/*, /stage
  components/           ui.tsx (Button, Pill, TabBar, Meter…), app-shell.tsx, provider/*, buyer/*, stage-player.tsx
  lib/auth.ts           demo accounts + SESSION_COOKIE ("settl_demo" = "provider" | "buyer")
  lib/demo-data.ts      scripted pitch/stage data; live dashboards use server queries
  lib/claim.ts, stage.ts  pure state machines behind the claim flow and stage view
  lib/server/           backend logic (pure, tested): policy, nonce, reservations, webhooks, events
  proxy.ts              Next 16 "proxy" (formerly middleware): guards /provider and /buyer
packages/core           @settl/core: Zod schemas (Quote, PaymentHeader, Receipt), header encoding, peso/XLM/stroop math
packages/verifier       @settl/verifier: receipt v1 checks (runChecks)
packages/sdk            @settl/sdk: Express per-call and outcome middleware (new outcome checks pending)
packages/stellar        @settl/stellar: testnet Noir adapter, Velo gas, relayer fallback; live gate passed
apps/web/prisma         PostgreSQL schema and demo seed (DB verification reported by Gemini)
apps/resibo             Standalone Express demo provider (accepted)
apps/web/app/mcp        Hosted MCP Streamable HTTP/SSE endpoint (accepted)
apps/agent              Autonomous AI SDK bookkeeping CLI (accepted)
docs/superpowers        specs and plans
.claude/launch.json     dev-server launch config (npm run dev, port 3000)
```

## Commands (run from the repo root)
| Command | What it does |
|---|---|
| `npm install` | Install all workspaces |
| `npm run dev` | Next dev server at http://localhost:3000 |
| `npm test` | Vitest in every workspace (Gemini verified 99 before Phase 2; 52 cover the chain adapter) |
| `npm run typecheck` | `tsc --noEmit` in every workspace |
| `npm run lint` | ESLint for apps/web |
| `npm run build` | Production build of apps/web (typechecks too) |

**Demo sign-in:** pick a workspace on `/login` (`mara@example.com` is the provider, `juan@example.com` the buyer). Any password works.

## Status
**Latest checkpoint, Nov 6 (Gemini report):** All 10 phases are implemented, integrated, synced to Neon Postgres, and fully verified green:
- `npm test`: 634/634 tests passing across all 7 workspaces (`web` 466, `stellar` 52, `sdk` 49, `resibo` 28, `agent` 22, `core` 10, `verifier` 7).
- `npm run typecheck`: 0 errors across all 7 workspaces.
- `npm run lint`: 0 errors, 0 warnings.
- `npm run build`: Next.js 16 + Turbopack + Prisma 7 production build compiled with 0 errors (all 25 static and dynamic routes).
- `prisma db push`: Neon Postgres synchronized with new agent balance and lifecycle recovery columns.
- `prisma db seed`: Demo seed populated cleanly.

**Phases 9 and 10 accepted:**
- Buyer-owned `POST /api/agents/[id]/topup` creates an XLM Velo checkout and returns its real payment-intent ID as `sessionId`. A local pending operation and stable checkout idempotency key exist before the remote request. Raw-body signed `/api/velo/webhook` events are deduplicated by delivery ID, matched to stored intent/amount/receiver, and the paid intent is independently retrieved before funding. Unknown checkout creation remains pending for operator reconciliation; do not create a replacement blindly.
- Paid top-ups use a prefunded `SETTL_TREASURY_SECRET` wallet to call `fundEscrow`; checkout settlement does not directly fund escrow. Treasury ownership of Velo's receiver and a completed checkout still require live verification. Keep the treasury separate from buyer/provider owner wallets. A treasury advisory lock plus durable `funding` marker prevents repeated funding across processes. Agent row locks coordinate checkout/funding with lifecycle changes. Unknown funding retains hash/recovery identity and blocks later source work until reconciled. Inactive agents retain a failed operator-review top-up without sending funds. Actual chain observations update the balance cache; completed funding and its outbox event commit together.
- Protected `POST /api/cron/auto-claim` now drains paid top-ups in bounded batches too. Unresolved/failed work returns an error while independent delivery/claim queues still run. A later pass dispatches newly queued completion events. There is no automatic pending-transaction recovery worker.
- Provider home/earnings/endpoints and buyer home/new/detail pages query owned Prisma data. DTOs omit custodial secrets and key hashes. Balances use live chain reads, then dated cache or an unavailable state. Payments, checks, approvals, claims and hashes reflect actual records; search filters owned activity. The pitch `/stage` and scripted fallback remain unchanged.
- Live actions include manual provider claims, endpoint registration, buyer agent creation, policy replacement, revoke and checkout redirects. Manual claims reuse durable claim safeguards while bypassing auto-claim enable/threshold settings. Endpoint URL origins must be in `SETTL_PROVIDER_ALLOWED_ORIGINS` (default local Resibo origins), preventing arbitrary server fetch targets. Outcome receipt criteria use the canonical verifier preset.
- Buyer lifecycle operations serialize by organization owner and persist checkpoints before chain writes. New wallets are encrypted, device/policy registration is submitted, and only API-key hashes are stored. Creation returns the key once even for provisioning/error outcomes; retain it before leaving the screen. Policy replacement revokes the old on-chain policy before registering the replacement. Revocation uses revoke-policy/sweep/revoke-device and revokes API keys on success. Pending payments, held reservations and outstanding top-ups block lifecycle changes; unknown lifecycle writes block further owner operations until reconciled.
- **Gemini verification & DB sync complete:** Neon Postgres synced with nullable `cachedBalance`, `balanceUpdatedAt`, and `lifecycleRecovery` columns via `prisma db push`; seed populated; lockfile refreshed; all quality gates verified green (634 tests, 0 typecheck errors, 0 lint errors, Next 16 build passing). Codex is at rest.

**Step 1 passed, Nov 5:** Gemini reported 99 offline tests (30 web, 10 core, 52 stellar, 7 verifier), typecheck, lint, production build, and the full live testnet suite passing. `policy_disabled` and `contract_not_whitelisted` permit relayer fallback; both preserve their refusal reason through reconciliation. Phase 2 was explicitly authorized in the same delegation brief. Full evidence and checkout limitations are in [`docs/spikes.md`](docs/spikes.md).

| Live operation | Confirmed transaction hash (Gemini report) |
|---|---|
| registerDevice | `56e00026438fe64ef549da5a25cf9a09032976335c0c5aeebc71af99e28c5374` |
| registerAgent | `dae593826f138b5d1386273b3d3c569bd99707271922bcddd74cc32cdba80edb` |
| fundEscrow | `e9ffcd1a31ddbc39cbd0ad25e17fdadd95da3260c56d2891e2993789bcbb3440` |
| authorize | `375dc60c53fab896945939f814fc71260a2f9951e5971bf30f433a4135fcc2de` |
| claim | `bc78af5e4dd80bef9fa47513e17b2be4ff7fe812ecb0f4f44cdf4ca0d84c887f` |
| revokeAgent | `ce5c901d228a73e93a058ef61cbd0329077698f143e4fa835665311abf77b55f` |
| sweepOnRevoke | `49ff611fc62ade4ad074f7ea027d7ab7ce57e94e22fcf8508e50424852edf164` |
| revokeDevice | `650ec709d7c9d2aa3decce5a5c9e7b5be79f207f5c918366ca17049cab873ca8` |

Authorize inner hash: `56d94837d923f3818d17f3298f322d9b3c513678811254c893f2bd62f95cb88f`.
Checkout route passed with PaymentIntent `jx78vwa1e5q82w37pdhw87k0v58hmxzt`, receiver `GAHJPWGSD6KIJMB2ER5RIY7FCKUK7RGJALPVWQ4ZILKVVROW42G7G3E3`. A completed checkout payment and receiver ownership remain unverified.

**Phase 2 accepted (Gemini's phases-4-to-8 plan reports database verification):** Prisma 7 PostgreSQL schema, lazy client singleton, AES-256-GCM wallet encryption, and rerunnable seed for Mara/ResiboAI, Juan's Accounting Firm/Bookkeeper, and GeoPH. Includes hashed agent API keys, reservations, approvals, settings, payment recovery metadata, inbound webhook deduplication and outbound deliveries. The seed preserves existing keys, revocations and policy; its device hash includes the generated wallet public key to avoid collisions across demo databases. The seed itself does not fund or register wallets and creates the agent as `provisioning`. Run commands from the root: `npm run db:generate -w web`, `npm run db:migrate -w web -- --name initial`, then `npm run db:seed -w web`. Gemini reports the schema synced and seed populated; Codex did not execute those checks or database writes. See [`apps/web/prisma/README.md`](apps/web/prisma/README.md).

**Previously verified UI and pure logic** (before Phase 2):
- **All UI screens**, using hardcoded demo data:
  - landing page
  - demo sign-in (server action sets a role cookie; `proxy.ts` guards routes; sign out works)
  - provider home, earnings (claim flow) and endpoints
  - buyer agents, create agent, agent detail (top-up and activity filters) and the phone-sized approval screen
  - stage view for the pitch
- **`@settl/core`** and **`@settl/verifier`**, as described above.
- **`apps/web/lib/server`**, pure logic only, no database or network yet:
  - `policy.decide()`: off-chain spending rules
  - `nextNonce()`
  - `reservationReducer()`
  - `signWebhook` and `verifyWebhook`: HMAC, header `x-settl-signature: t=…,v1=…`, 5-minute window
  - `planEffects()`: which webhooks, auto-claims and low-budget alerts a payment sets off

**Phase 3 implementation (verification pending):** the operator authorized broker core, provider SDK and three API routes on Nov 5. `apps/web/lib/server/broker.ts` exports `executeCall`, `createQuote`, `verifyPayment` plus injectable `createBroker` for offline tests. Routes are `POST /api/quotes`, `POST /api/payments/verify`, and `POST /api/agent/call`. `packages/sdk` exports Express `settl()` middleware. Unit tests were written before implementation. This session ran no tests, typecheck, lint, build, install or database commands. Gemini owns dependency installation/lockfile refresh and all verification; no Phase 2 results were supplied in the Phase 3 brief, so the earlier verification status is not inferred.

**Phase 3 verification update, Nov 5 at 21:45 (Gemini report):** 258/258 tests passed (web 185, core 10, SDK 4, Stellar 52, verifier 7); lint passed with zero errors. Typecheck/build found approval enum narrowing, Express 5 `NextFunction` mock typing, and explicit route `runtime` incompatibility with `cacheComponents`. Targeted fixes are applied, including removing the corresponding runtime-export assertions from route tests. Routes inherit the default Node.js runtime. Codex did not rerun checks; typecheck/build and affected tests await Gemini re-verification.

- Agent calls authenticate the SHA-256 digest of a non-revoked `stl_agent_…` key and use its stored agent identity. Provider routes require the shared testnet `SETTL_PROVIDER_KEY`; missing configuration returns 503. Configure the same value for SDK callers. This is a service credential, not per-provider tenancy.
- Nonce allocation and fresh policy/budget checks run under an agent row lock. UTC defines the daily spending window. A pending Payment is committed before network submission, preventing a second authorization across processes and crashes. Pending/unknown results remain pending and return HTTP 202; stored hashes/recovery identity support later reconciliation. A crash without a returned hash requires explicit ledger investigation, never a blind retry. An expired pending quote also needs explicit reconciliation before another payment; this phase adds no recovery worker.
- The production broker uses a fresh Stellar writer for each database-claimed submission. The database marker controls pending state across processes; a stale in-memory SDK guard cannot block a subsequent payment after another process verifies it.
- Verification matches all six authorize arguments, rejects expired quotes and mismatched endpoints/hashes, and consumes a confirmed quote once (`paid` to `verified`) under the same agent lock. The SDK sends `endpointId` alongside its proof. Receipt headers contain base64 UTF-8 receipt JSON; core's actual proof helpers are `decodePaymentHeader` and `encodePaymentHeader`.
- Approved calls reuse their bound quote with a newly allocated nonce; ownership, amount, asset, merchant, endpoint, expiry and prior use are checked. Phase 7 below supersedes the original outcome-not-supported behavior and SDK commitment rejection. Per-call provider failures retain the paid receipt with `providerError`. As requested, a missing per-call endpoint URL returns a paid receipt with `data: null`; configure endpoint URLs to run a provider. Automation effects are planned and returned, not dispatched yet.

**Phase 3 accepted, Nov 5 at 22:15 (Gemini report):** all 258 tests, typecheck across five workspaces, lint and the Next.js/Turbopack/Prisma production build passed, including the three API routes. This supersedes the earlier pending Phase 3 checks.

**Phases 4, 5 and 7 implementation (verification pending):** the operator authorized these in parallel on Nov 5 at 22:29. Two workers owned `apps/resibo/**` and the MCP files separately; the coordinator owned outcome broker/API work, required SDK integration, manifests and documentation. No shell commands, installs, tests, typechecks, lint, builds, database operations or commits ran in this implementation turn. Gemini owns all execution and verification; source compatibility, dependency installation/lockfile refresh, transport tests and live settlement remain to be checked.

- **Demo provider:** `apps/resibo` supplies an import-safe Express app factory and guarded startup on port 3001 by default. Payment-protected routes are `/parse-receipt` (`resibo_parse`, ₱2 outcome), `/parse-receipt-pro` (`resibo_pro`, ₱15 per-call), and `/lookup` (`geoph_lookup`, ₱8 per-call). Receipt fixtures select `clean`, `blurry`, or `wrong_total`; malformed input is rejected before paid work. Source-export workspace dependencies run through `tsx`. Configure `SETTL_API_URL` and matching `SETTL_PROVIDER_KEY`, and set stored endpoint URLs to this server before a live broker call. The service does not change prices or policy in the database.
- **Hosted MCP:** `/mcp` uses the official TypeScript SDK v2 handler with Streamable HTTP/SSE and stateless compatibility. Every request authenticates a stored agent-key hash; a fresh server binds tools to that agent. Browser origins are restricted to the request origin. Six tools expose services, budget, quotes, calls, approval status and receipts. Monetary values use exact bigint formatting; queries are agent-scoped and explicitly project public fields. Terminal receipts include non-paid outcomes with zero charges and validated checks. Dependencies are `@modelcontextprotocol/server ^2.4.0`, `zod ^4`, and the v2 client for transport tests.
- **Outcome handshake:** the broker locks the agent, applies policy, allocates a quote/nonce, holds a Reservation and commits a pending `commit` Payment before calling the provider. A missing provider URL is not charged. SDK commitment preflight posts `{quoteId,reservationId,endpointId,checkOnly:true}` to `/api/verify`; it claims the provider invocation once. SDK `res.json` buffers the exact JSON output, posts it for verification, then delivers that output only with a known paid or not-charged receipt. Outcome handlers must use JSON responses; raw/streaming results are unsupported. The coordinator extended `packages/sdk` because the prior SDK rejected commitments.
- **Verification:** authenticated `POST /api/verify` also accepts `{quoteId,result,endpointId,reservationId?}`. Quote, endpoint, reservation ownership/amount/expiry and agent policy are checked under the agent lock. Failed checks release the reservation, mark the Payment `not_charged`, fail the Quote and plan `payment.not_charged` effects. Passed checks commit a settlement marker before custodial `authorize`; success settles the hold, records hashes, marks the Payment/Quote paid and plans `payment.paid`. Repeat finalization returns the stored terminal receipt without another authorization. Pending/unknown chain outcomes retain the hold and recovery identity; no automatic retry or expiry-based release is allowed after settlement starts.
- **Concurrency/recovery:** `Payment.error` distinguishes `provider_running` from `verification_in_progress` and submission errors while status remains pending. If a provider fails before an authorization claim, the broker releases the hold under the same lock, so a late result cannot start payment. Once settlement is claimed, failures/timeouts return pending for explicit reconciliation. A recovery worker, automation dispatch and result streaming remain separate work. Settlement API waits up to 120 seconds and the broker's provider call up to 125 seconds; these are application deadlines, not hosting-duration configuration.

**Phases 4, 5 and 7 accepted (Gemini report, Nov 5 at 23:13):** all 370 tests passed (Resibo 28, web 265, core 10, SDK 8, Stellar 52, verifier 7), plus typecheck, lint and production build. This supersedes their earlier pending verification notes.

**Phases 6 and 8 implementation (Nov 6; verification pending):** agent and automation workers owned separate files. Coordinator integration adds the buyer authorization helper, approval snapshot route/page and transactional broker outbox hooks. Tests were written before implementation; only read-only inspection and diff checks ran here. Gemini owns dependency installation/lockfile refresh, tests, typecheck, lint, builds, live requests and database verification.

- **Bookkeeping CLI:** `apps/agent` uses actual AI SDK 7 tool calling with the official MCP v2 client. Groq/`llama-3.3-70b-versatile` is preferred; configured OpenAI or Gemini keys are fallbacks when Groq is absent. It inspects budget/services, requests clean and blurry OCR, handles the ₱15 Pro refusal, and requests/polls the ₱8 GeoPH approval. It records expenses only from paid, validated receipt data and preserves transaction/quote deduplication in an atomic local ledger. Each payment attempt is journaled before network submission; submitted, unknown, pending and terminal attempts cannot be silently repeated. Approved resumption requires the same input fingerprint and approval ID, once. Logs redact credentials. MCP closes and the ledger lock releases on exit; interrupted operations/stale locks require reconciliation.
- **CLI setup:** from the root, Gemini installs dependencies and runs `npm run start -w @settl/agent`. Export the LLM key, optional `SETTL_MCP_URL`, and `DEMO_AGENT_API_KEY` in that process's environment; the CLI does not read the web env file. Dependencies are pinned in its manifest (`ai 7.0.163`, provider SDKs 4.x, MCP client 2.4.0). SDK7 uses `isStepCount`, not the older `stepCountIs`. The model may omit actions; the CLI reports an incomplete mission rather than fabricating execution. Keep `apps/agent/.data/ledger.json` across restarts.
- **Durable automations:** payments, check failures, approval requests/resolutions and completed claims queue stable event intents atomically with their state changes. The existing `WebhookEvent` table uses `source: "settl"` for this outbox, separate from inbound source identities. No schema migration is required. `dispatcher.ts` reconstructs effects, queues subscribed endpoints, signs exact JSON bytes with `signWebhook`, and uses stable `x-settl-delivery` IDs and delivery leases/CAS. The latest brief's **three retries** means four total attempts (initial plus 1s/2s/4s retries), superseding the older three-total-attempt design. Delivery is at least once; recipients deduplicate the delivery ID. Due retries and failed/unknown work persist across processes.
- **Claims and alerts:** `claims.ts` checks enabled settings and live pending earnings, then commits a pending Claim under a provider lock before submitting. Completed claims and their notification intents commit together. Unknown outcomes remain pending with available hash/recovery identity; another worker cannot blindly repeat them. `Claim.amount` and notification `observedPendingStroops` are the pre-claim earnings observation, not an exact concurrently changing payout receipt. Low-budget work rechecks live balance and atomically commits its delivery rows with `lastAlertAt`, at most once per agent per UTC day.
- **Cron operation:** schedule authenticated **POST `/api/cron/auto-claim`** regularly with `Authorization: Bearer <CRON_SECRET>`. It drains automation intents, due webhook retries and enabled auto-claims; interactive payment and approval routes do not wait for third-party delivery. Each outbox/delivery batch is bounded to 25 records. Repeated POSTs process later batches/backoff deadlines; a later pass delivers newly queued claim-completion events. Missing cron configuration fails closed. An external scheduler must perform these POSTs; hosting cron is not deployed by this change. Configure active `WebhookEndpoint` subscriptions and encrypted secrets to receive events.
- **Live approvals:** buyer GET `/api/approvals/[id]` returns an organization-scoped public snapshot and actual payment state. POST `/api/approvals/[id]/resolve` requires the existing testnet demo buyer session, JSON and same-origin browser requests, checks ownership/expiry, then atomically resolves a pending decision and queues `approval.resolved`. The page accepts actual IDs under a Suspense boundary. The card shows dynamic parties/amount, disables concurrent actions and polls for actual settlement; it has no simulated paid timer or fabricated transaction. Buyer identity uses the existing `settl_demo=buyer` demo session mapped to Juan's stored organization.

**Phases 6, 8, 9, and 10 accepted (Gemini report, Nov 6 at 01:46):** all 634 tests passed across all 7 workspaces (`web` 466, `stellar` 52, `sdk` 49, `resibo` 28, `agent` 22, `core` 10, `verifier` 7). Full repository typecheck passed with zero errors across all workspaces, ESLint passed with zero errors and zero warnings, and the Next.js 16 + Turbopack + Prisma 7 production build compiled all 25 dynamic and static routes cleanly. This includes:
- Phase 6: Bookkeeping agent (`apps/agent`) with AI SDK 7 and MCP client.
- Phase 8: Webhook dispatcher, HMAC signing, auto-claim cron, low-budget notifications, dynamic buyer approvals.
- Phase 9: Velo checkout top-up (`POST /api/agents/[id]/topup`), Velo webhook handler (`POST /api/velo/webhook`) with HMAC verification, deduplication, and testnet escrow funding.
- Phase 10: Live UI data binding across `/provider`, `/provider/earnings`, `/provider/endpoints`, `/buyer`, and `/buyer/agents/[id]` with real database state, plus pitch `/stage` preserved.

**Remaining operational work:** deployment, live end-to-end demo dry-run on testnet, and pitch rehearsal.

**Read-only inspection follow-up:** Gemini clarified that shell inspection is permitted while execution checks remain assigned to Gemini. Source inspection confirmed `runChecks(criteria, result, now)` returns `{ result, checks }`; the broker now reads that structure, preserves verifier error states, and uses its injected clock. Receipt fixtures match the installed verifier schema. The MCP budget response includes a scoped pending-approval list as well as its count. The standalone provider's unsupported lint script was removed; root web lint remains available. `git diff --check` passed; no tests, lint, typecheck, build or database writes were run by Codex.

**Git:** the repo has an existing `Scaffold and UI` commit. No commits were made for the chain adapter. Commit only when the user asks. Stay on the current branch unless they say otherwise.

## What to build next (in this order)
Each step: write failing tests first, then the code, then run the full check (`npm test && npm run typecheck && npm run lint && npm run build`).

1. **Chain adapter (`packages/stellar`).**
   - Gate passed in Gemini's Nov 5 run; evidence above. Step 2 was explicitly authorized. The user authorized step 1 implementation on Nov 4, overriding the older Day-0 timing restriction.
   - Wrap `@noirx402/agent-sdk@0.3.0` (on npm) and `@stellar/stellar-sdk@17`.
   - Functions: register device, register agent policy, `fund_escrow`, `authorize`, `claim`, `balance_of`, `pending_balance`, `get_policy`, revoke and sweep in the safe order (revoke_agent, then sweep_on_revoke, then device revoke).
   - Fee sponsorship through Velo Gas Station: `velo.gas.sponsorAndSubmit(signedXdr, { idempotencyKey })`, then `waitForResult`; only the `succeeded` status counts. Friendbot to create testnet accounts.
   - **Gate:** a real `authorize` lands on testnet. Write the outcome of the remaining checks in `docs/spikes.md`:
     - Is `payment_escrow` on Gas Station's allowed-contract list? If refused with `contract_not_whitelisted` or `policy_disabled`, a Settl relayer account pays the fee in testnet XLM.
     - Where do Velo checkout payments land (`receiverAddress`)?
2. **Database (`apps/web`, Prisma with Neon Postgres).**
   - Tables: the parent spec §11 plus `agent_api_keys` (hashed `stl_agent_…`), `reservations`, `approvals`, `webhook_endpoints`, `webhook_deliveries`, `provider_settings` (auto-claim threshold) and `agent_settings` (alert level).
   - Encrypt custodial secrets at rest with `WALLET_ENC_KEY`.
   - Seed script for the demo state: ResiboAI, Juan's Accounting, the Bookkeeper agent, GeoPH.
3. **Broker (`apps/web/lib/server/broker.ts`) and the per-call path.** Quote (call the provider, read the 402), then `policy.decide`, then take the per-agent row lock, allocate a nonce, sign and submit `authorize`, then retry the provider with `X-PAYMENT {kind:"tx"}`. Plus `POST /api/agent/call`, `POST /api/provider/payments/verify` and `packages/sdk` (provider middleware).
4. **Demo provider (`apps/resibo`, Express with `packages/sdk`).** Fake receipt OCR with predictable outputs: clean, blurry, wrong totals. `/parse-receipt` costs ₱2 and pays only on a passing result. `/parse-receipt-pro` costs ₱15 per call (it gets blocked by the ₱10 cap). Add a GeoPH-like ₱8 service for the approval demo.
5. **Hosted MCP (`apps/web/app/mcp/route.ts`).**
   - Built on `@modelcontextprotocol/server@2`: `createMcpHandler`, `registerTool` with `zod/v4` schemas, and `requireBearerAuth` to map the bearer key to an agent.
   - Tools: `settl_list_services`, `settl_get_budget`, `settl_quote`, `settl_call`, `settl_check_approval`, `settl_receipts`.
6. **Demo agent (`apps/agent`).** An AI SDK bookkeeping agent that uses an MCP client pointed at `/mcp`. Check the AI SDK 7 MCP client API in `node_modules/ai/docs` before writing code.
7. **Settl on Result.**
   - The broker reserves the amount and calls the provider with `X-PAYMENT {kind:"commit"}`.
   - The provider SDK checks the reservation, runs the handler, and posts the result to `/api/provider/results`.
   - `runChecks()` decides: on a pass Settl signs and submits `authorize`; on a fail the reservation is released and nothing is charged.
8. **Automations.** Wire `planEffects()` to webhook delivery (with retries), auto-claim (claim signed by the provider's custodial wallet, plus a daily cron at `/api/jobs/auto-claim`), `budget.low` with a Velo checkout link, and approvals resolved on `/buyer/approvals/[id]`.
9. **Top-up.** Velo `checkout.sessions.create`, then the webhook at `/api/velo/webhook`:
   - Verify `x-velo-signature` with `Velo.webhooks.verify` against the raw body.
   - De-duplicate by `x-velo-delivery`.
   - Then the treasury wallet calls `fund_escrow`. Any wallet may fund any device.
10. **Wire the UI to live data**, one screen at a time. Replace imports from `lib/demo-data.ts` with server queries, keep the components, and keep the stage view's scripted fallback.

## Noir contract facts (from reading the Rust source; don't re-derive them)
- **`authorize`.** Signature: `payment_escrow.authorize(agent, device_hash, merchant, asset, amount: i128, nonce: u64)`. It calls a plain `agent.require_auth()`, then `agent_registry.check_payment(device_hash, agent, asset, amount)`.
- **Nonces.** Each must be strictly greater than the last for that (device, agent) pair; gaps are allowed. If a higher nonce lands first, every lower one fails, so **keep one payment in flight per agent**.
- **The cap.** `max_amount` caps each payment only; nothing tracks a running total. Daily budgets are enforced off-chain (`policy.ts`).
- **Expiry.** It's compared to the ledger timestamp, and a policy is still valid at exactly `expires_at`.
- **Funding.** `fund_escrow(token, wallet, device_hash, amount)` needs `wallet.require_auth()`, and **any wallet can fund any registered device**. The escrow token is fixed per device on the first funding. Use the native XLM asset contract: `Asset.native().contractId(Networks.TESTNET)`.
- **Claims.** `claim(token, merchant)` is signed by the merchant and pays out all of that merchant's pending payments across every device.
- **Withdrawals.** `defund_escrow` and `sweep_on_revoke` are owner-only. Never revoke the device while its escrow balance is above zero.
- **Events.** `fund`, `authorize(device_hash, merchant)`, `claim(merchant)`, `defund`, `sweep`.
- **Testnet IDs** (Builder Handbook redeployment 2026-10-24; overrides the older parent spec §8.2):
  - `device_registry`: `CAC4KOLHDLDYDWBOKXNKRN5KVHO56PLOIFXDLTBUWGVN6GVDEB7FQHU5`
  - `agent_registry`: `CCMZDSPTLX7IIJWCYEUM5DJUHOSOYSTHGK777S2TXZWEMC5ZZGPJ3EBV`
  - `payment_escrow`: `CC7EAW5FNJEDBS7THM5IT6XIOHO4AOYMLXT3KSZ3HWUIKEACTW7E5BFS`

## Velo facts
- **Gas Station.** It takes a fully signed envelope with **exactly one** `invokeHostFunction` and wraps it in a fee bump. It needs `VELO_GAS_API_KEY` (`tg_test_…`), separate from `VELO_API_KEY`. Refusal codes include `policy_disabled`, `contract_not_whitelisted`, `daily_cap_exceeded`, `wallet_rate_limited`.
- **Webhooks.** Events: `payment.succeeded`, `payment.failed`. Headers: `x-velo-signature` (HMAC-SHA256 over the raw body) and `x-velo-delivery`.
- **SDK version.** `@carts1024/velo-sdk`: the `latest` tag is alpha.2, the `alpha` tag is alpha.4. Install with `@alpha`.

## Gotchas
- **Noir SDK 0.3.0 and Stellar SDK 17.** Noir declares a v16 peer and uses removed `toXDR`/`fromXDR` envelope helpers. The user approved a Noir-scoped npm override to 17.0.0. The adapter reuses Noir's real `toCall` encoder and reads, overrides preparation, and uses SDK 17 for signing/submission. Never call Noir's original high-level write/sign helpers. Use Node `^22.23.4 || ^24.22.1 || >=26.12.1` (locally checked on 24.22.1).
- **Pending transaction outcomes.** `TxResult` now includes `PENDING`, `innerHash`, transport and optional Velo recovery identity. Preserve that state and reconcile before retrying. The per-source queue is local to one client instance; the future broker still needs persistent state and its database lock. `escrowToken` takes a device hash and may return null before funding. See the package README.
- **Next.js 16 differs from older versions.** Read `node_modules/next/dist/docs/` before using an API (see `apps/web/AGENTS.md`):
  - Middleware is now `proxy.ts`.
  - `cacheComponents` is on: request-time cookies, headers, params and search data belong in an async child inside `<Suspense>`. Live pages use that pattern. Do not add route `runtime` exports with this configuration.
  - Route props use the global `PageProps<"/route">` and `LayoutProps<"/">` types.
- **Stale TypeScript cache.** If `tsc` reports errors that contradict `tsconfig.json`, delete `apps/web/tsconfig.tsbuildinfo` and `apps/web/.next`. This happened once already.
- **Tailwind v4.** Tokens live in `apps/web/app/globals.css` under `@theme`. Default colours are removed (`--color-*: initial`), so `bg-white` or `text-gray-500` won't exist. Use the named tokens (`bg-paper`, `bg-surface`, `text-ink-2`, `bg-saffron-well`…).
- **The UI's font scale is custom.** `text-xs` is 13px, `text-sm` 15px, `text-base` 16px, `text-lg` 20px, then 25, 31, 39, 49 and 61px.
- **npm warns about esbuild's install script** (`allow-scripts`). The tests run anyway; leave it alone unless something breaks.
- **Windows host, Git Bash shell.** Use forward slashes in scripts.
- **Vitest.** The web app's test environment is `jsdom`. Server tests start with `// @vitest-environment node`.

## Design rules for any UI work (from UI spec §2; don't break them)
- **Palette (ink and saffron):**
  - Ink, `#17181C`, is used for primary buttons and text.
  - Saffron, `#E9A92A`, is a fill only and under 5% of the screen; never use it for text.
  - Status pills: paid (green), not charged (grey), blocked (red), needs you (blue).
- **Type:** IBM Plex Sans for body text, Schibsted Grotesk for headings, IBM Plex Mono only for code and hashes. Body text is at least 16px. Labels are sentence case, never uppercase with letter spacing.
- **Spacing:** use only the scale 2, 4, 8, 12, 16, 24, 40, 64, 96, 144px. A card has a border or a shadow, never both, and never sits inside another card. Tables have no surrounding box, only horizontal rules.
- **Motion:** animate only `transform` and `opacity`, with `cubic-bezier(0.23, 1, 0.32, 1)`. Buttons get the `press` utility (scale 0.97). Respect `prefers-reduced-motion`.
- **Copy:**
  - No "A · B · C" strings, no arrows stuck to links, no decorative status dots, no eyebrow text, no emoji, no em dashes.
  - Buttons name the action ("Claim ₱86.00").
  - Error messages say what happened and what to do next.
- **One filled primary button per page.**

## Environment variables
The operator reports Velo credentials, `DATABASE_URL` and `WALLET_ENC_KEY` are configured in ignored `apps/web/.env.local`. Do not print or commit real values. `WALLET_ENC_KEY` must be exactly 64 hexadecimal characters (32 bytes). Optional `DEMO_AGENT_API_KEY` overrides the public testnet demo token; only its SHA-256 hash is persisted.

## Working agreement
- Write tests before code, then run the full check before calling anything done.
- Don't commit, push or switch branches unless the user asks.
- Keep the demo script working (parent spec §13): a clean receipt is paid, a blurry one isn't charged, the ₱15 Pro call is blocked, the ₱8 GeoPH call needs approval, and claiming works.
- Update this file and the plan's revision note when a decision changes.
