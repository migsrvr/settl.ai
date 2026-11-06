# Handoff: Settl.ai

Last updated 2026-11-07 by Codex. Read this first, then the docs it links to.

## Hosted mock OCR billing applied to Neon, Nov 7

The user explicitly authorized applying the prepared database update and accessing the configured Neon database. A credential-safe read verified the original `resibo_parse` product (provider `resibo`, active, price 1,333,334 stroops / PHP 2) against the hosted MCP service listing before any write. The existing `apps/web/.env.local` connection was loaded in place using the project client; connection strings and credentials were not printed or copied to the validation environment.

Ran the prepared scoped CLI once on Node 24.22.1: `npm exec -w web -- tsx prisma/demo-usage-billing.ts --apply`. It reported **1 matching endpoint updated**. A follow-up Neon read confirmed `mode: per_call`, `criteriaId: null`, and cleared JSON criteria. The fingerprint of the same database and all preserved endpoint fields matched before/after (including price, URL, provider, name, route, method, currency and active state). Fresh `settl_list_services` through the actual connected MCP now reports **Receipt OCR at PHP 2 in per-call mode**; the complete service list differs only in that intended billing-mode field. No deployment was needed because the existing broker already supports per-call authorization.

All required checks passed again in the isolated Linux source copy on Node 24.22.1: **752 tests**, typecheck, lint and production build, exit 0. No application source or dependencies changed in this application step. No paid tool invocation, chain transaction, funding, claim, top-up reconciliation, provider URL change, historical payment rewrite, commit or push occurred. The earlier uncharged attempts remain uncharged; the provider rejection's underlying HTTP cause remains unconfirmed. A future authorized purchase can now exercise the live per-call path. This authorization resolves the prior gate for this billing update only; unrelated Neon inspection, top-up work and URL updates were not performed.

## Mock service usage billing revision, Nov 7

The user explicitly changed the default mock-provider demonstration: invoking the paid tool should incur the usage fee regardless of fixture quality. `resibo_parse` now defaults to **per-call at PHP 2**, matching the existing Pro and GeoPH billing model. The broker already authorizes per-call payments before fetching provider output and retains a confirmed charge with `providerError` on a provider failure; no payment/recovery guard was bypassed. Discovery, budget reads and quotes remain free, refused/unapproved calls do not charge, and unknown/pending chain submissions stay pending. Outcome billing and the SDK's commitment handshake remain available for deliberately configured outcome products.

The actual MCP purchase in this conversation returned `not_charged` / `provider_rejected`, quote `cmw5922pc001jvktnlwnj0ew4`, receipt `cmw59231e001lvktnbm32u6wr`, at 2026-11-06 17:29:49 UTC. Both projects' runtime logs omitted a matching provider error, so the underlying HTTP rejection reason is unconfirmed. Source inspection establishes that missing input is supported and selects `clean`; no image is needed for this mock. Do not attribute the original rejection to missing receipt input.

Tests were written first and established failing default/upgrade expectations before implementation. The seed now creates per-call OCR and reuses a scoped, idempotent `apps/web/prisma/demo-usage-billing.ts` update for existing original Resibo OCR endpoints. That file also has an explicit `--apply` CLI: `npm exec -w web -- tsx prisma/demo-usage-billing.ts --apply`. Without `--apply` it never connects to the database. Only the endpoint billing mode and obsolete criteria change; prices, URLs, ownership, policies, wallets, historical quotes/payments and existing reservations are preserved. Previously uncharged attempts are never rebilled. Old outcome calls retain their quote snapshots and need original-term completion/reconciliation; old approvals cannot be resumed with different-mode terms.

The deterministic live-demo driver, agent instructions and current demo guides now expect the PHP 2 fee for both clean and blurry fixtures, verify three real authorizations in the full rehearsal, and require enough balance/daily headroom for all three charges. The bookkeeping agent still refuses to create a business expense from low-confidence mock receipt data even when its API usage fee was paid. Regression tests cover per-call-before-provider order, rejected-provider paid receipts, retained outcome behavior, empty input, bounded migration scope and reruns.

**Verification complete:** all 752 tests (agent 23, provider 29, web 574, core 10, SDK 49, Stellar 60, verifier 7), typecheck, lint and production build passed, exit 0, in a fresh local Linux source copy at `/tmp/settl-usage-validation-w9_6uuh5` using Node 24.22.1 and the unchanged lockfile. No active environment/secret files were copied; Prisma generation and the build required no database access. Changed source/tests and both root manifests were hash-compared with this checkout. The scoped update's no-apply invocation printed its no-change guidance successfully.

The original mounted installation (Node 24.21.0, below the stated Noir range) passed tests, typecheck and lint, but **its production build failed** resolving existing `@settl/core` and `@settl/verifier` workspace links. Fresh Linux installation resolved that environment issue without changing application build configuration, the existing dependencies or lockfile. Initial sandbox cache/listener failures were rerun with approval. At this code-only checkpoint, no hosted database update, deployment, paid retry, funding, claim, commit or push had been performed; the connected MCP still used its stored outcome mode. The subsequent, explicitly authorized Neon application is recorded above and supersedes that pending billing-update status. Historical outcome-mode evidence below predates this decision.

## Hosted webhook HTTP 400 investigation, Nov 6

**Root cause confirmed by the user's generated test at 17:06:08 UTC:** production logs show `invalid_velo_payload` / `invalid_project_fields`, so raw-body HMAC/timestamp verification succeeded. Velo's public backend schema defines `registryProjectId: v.optional(v.number())` and its sender copies that value into `project.registryProjectId`; the pinned alpha.4 SDK erroneously requires a string. See Velo's `packages/backend/convex/projects/schema.ts` and `packages/backend/convex/webhookDelivery.ts` versus `packages/velo-sdk/src/webhooks.ts`.

A narrow payment-event adapter is implemented: call the SDK on the ORIGINAL raw body/signature first; only its exact `VeloWebhookSignatureVerificationError("Invalid webhook event: project fields must be strings")`, emitted after successful HMAC/timestamp verification, permits strict local payment-event validation accepting numeric/omitted registry metadata. Do not normalize a body before signature verification, bypass bad signatures, or broaden the catch. This depends on the pinned alpha.4 SDK's verified control flow; reassess/remove it when upgrading. All required project identity/name/slug, event and payment fields remain validated; stored intent, amount, receiver, independent remote retrieval and funding guards are unchanged. Tests precede implementation and cover generated created events, numeric paid events with one-time funding, malformed metadata/payment fields, tampering/expiry and remote amount mismatch. All required tests/typecheck/lint/build passed in Linux (exit 0). Production fix deployment `dpl_5UM5Ukn4z4X7NZMmQ2tte5UuMGZA` is READY and assigned to `settl-ai-pi.vercel.app`; fresh unauthenticated GETs return homepage 200 and webhook 405 without login redirects. The temporary verification environment is stopped. A new Velo generated test is still needed to establish live signed-callback success; existing paid checkouts have not been reconciled or funded by this patch.

The user's Velo screenshots now establish that `payment.created` and `payment.succeeded` reach the public Settl callback but receive HTTP 400. Their older HTTP 200 delivery went to `www.velo-build.dev`, not Settl; Velo's temporary tester defaults to 200 and does not verify the merchant signing secret. Its 23:00:33 Manila timestamp is close to the pending PHP 50 checkout at 23:00:05, but their association and the initiating client remain unverified. Do not infer escrow funding from either a checkout redirect or a successful tester acknowledgment.

Vercel metadata confirms the signing secret was updated before production deployment `dpl_4jweBSiPkGQvo3TPzYj24DBgyoxJ` became READY. The installed Velo alpha.4 SDK verifies both HMAC and event schema; Settl previously collapsed both failures into `invalid_velo_signature` and emitted no route diagnostics. New regression tests precede a diagnostic change: signed shape failures return `invalid_velo_payload`; verification logs contain only fixed reason identifiers; route failures log only sanitized HTTP status/public error code. Never log raw payloads, exception messages, headers, signatures or secret values. Signature tolerance, independent intent retrieval, amount/receiver matching and funding idempotency are unchanged. All required checks (`npm test && npm run typecheck && npm run lint && npm run build`) passed in a fresh Linux environment, exit 0. The new diagnostics deployment `dpl_8VJc445xNDPiAWeAyZgdHJXRtaxz` is READY and assigned to `settl-ai-pi.vercel.app`. Unauthenticated GET checks returned homepage 200 and webhook 405 (POST-only), without a login redirect. No matching diagnostic logs exist yet; the actual live rejection reason remains unconfirmed until a new signed test. The temporary Linux environment is stopped.

After deployment, use Velo's **Send test event** with **payment.created** to diagnose callback verification without another checkout or escrow funding. The generated intent does not match a stored top-up and is ignored after verification. Read `velo_webhook_verification_failed` / `velo_webhook_rejected` in Vercel runtime logs. Once the cause is fixed, reconcile/redeliver the ORIGINAL paid intent; the current Velo UI source exposes generated tests, not a redeliver control. Do not claim that sending a generated test reconciles an existing paid checkout. Velo's sender treats HTTP 400 as non-retryable, so waiting alone will not recover the failed event. No new live callback, payment or database access has been performed for this diagnostic patch.

## Vercel deployment requested, Nov 6

The user requires a deployed submission and authorized deploying the website and provider through their Vercel connection. Preparation adds per-app `vercel.json` files with npm workspace install/build commands and 300-second settlement budgets, a default Express export and non-billing `/health`, repository-wide web output tracing, and exclusions for local secrets/builds in CLI uploads. Tests were added before source changes. See [VERCEL_DEPLOYMENT.md](docs/VERCEL_DEPLOYMENT.md) for the exact two-project settings, required server environment, provider URL updates, existing paid-checkout recovery and MCP validation.

Team access has now been authorized for `team_Xg9E9oYVPw79KZqwMsJnosNt`. Both production deployments report READY: web project `prj_uMJRuW9WPLPbsAcw83fTBD0IolEK`, deployment `dpl_C7BwzYeLMVJ5PBrimD4JHtmfm8V9`, stable domain `https://settl-ai-pi.vercel.app`; provider project `prj_kzZO0Yt7gVU3PhQ9utXFe4pKBFCv`, deployment `dpl_6vCDTzV3VLibo2QqijfZcSpx97GJ`, stable domain `https://settl-provider.vercel.app`. The initial authenticated checks returned HTTP 200 for the homepage and provider `/health`. Public access was subsequently enabled and verified as recorded below; an end-to-end hosted paid call remains unverified.

The first Express deployment compiled but failed at runtime because its bare workspace package exports referenced TypeScript files missing from the function. The provider now bundles workspace code with esbuild 0.28.2 into `dist/server.mjs`, exposes it through `api/index.mjs`, and uses Vercel's generic Node function configuration with a `dist/**` include and path rewrite. `public/robots.txt` supplies the generic builder's required static output directory. A regression test boots the packaged output and verifies no external `@settl/*` imports. The web typecheck generates Next route types first. No user dependency tree was reinstalled; package-lock was updated only for the already-resolved esbuild version.

A separate Node 24.22.1 Linux environment passed `npm test && npm run typecheck && npm run lint && npm run build`, plus the provider build: **728 tests** (agent 22, provider 30, web 550, core 10, SDK 49, Stellar 60, verifier 7), all checks exit 0. Existing Windows dependency limitations are not the release result. Both projects have the required existing application environment values; provider settings contain only the API origin and shared provider key. Preserve the existing Neon database, encryption key, treasury and scoped agent identity. Local fixes remain uncommitted; no commit, push or branch switch occurred.

The user explicitly approved public access ("yes make it public, we need it public all"). Vercel login protection is now disabled on both new projects. Fresh unauthenticated requests from a temporary Linux environment returned 200 for the web homepage and provider health; `/mcp` returned Settl's own 401 JSON without a bearer key. Demo accounts and application API-key/signature checks remain in place.

Automatic review still rejected passing the Neon credential into a temporary session and reading the original agent's top-ups: it interpreted the latest approval as public access only. Explicit consent for that credential use, top-up inspection and updating only the three demo provider URLs remains necessary; do not bypass the rejection with another mechanism. Database records, Velo webhook configuration and blockchain state remain unchanged. The supplied paid checkout must be reconciled by its original intent/event; do not pay again. Temporary verification environments are stopped after use.

A proposed invalid-signature POST probe to the hosted webhook was also rejected by automatic review as potentially payment-affecting; it was not executed or retried. No webhook invocation or funding action was performed during public-access verification.

## Checkout return rendering fix, Nov 6

The user reported a completed Velo checkout followed by Next.js `blocking-prerender-current-time` at the buyer dashboard's pending-approval expiry query. Both live dashboard loaders now explicitly await `connection()` outside their data-error catch boundary, before session reads, database queries and clock access. Regression tests were written first for the request boundary and propagation of prerender suspension. Native Windows test execution is blocked by the missing Rollup Windows optional dependency; typecheck/build also encounter the existing workspace-link/Prisma setup issues. This does not establish live payment completion.

The supplied log shows `?topup=success` returns but no `/api/velo/webhook` POST. A missing callback is suspected, not confirmed: inspect Velo delivery history and the stored Budget loads status. Returning from checkout only reads the dashboard; it never marks a top-up paid or sends escrow funds. Configure a publicly reachable callback to the existing signed webhook route and redeliver the original payment event after fixing delivery; do not create another payment or manually fund over an unresolved paid top-up. See the troubleshooting section in the Codex demo guide. No payment, database mutation, or live blockchain transaction was performed for this patch.

## Agreed external-agent demonstration, Nov 6

The user reaffirmed the product flow: a provider sells an endpoint; an AI company funds a capped XLM escrow for its agent; the company connects its existing CLI agent (Codex CLI for the demo) to Settl's hosted MCP; the agent requests and uses the paid API; Settl coordinates policy, automatic charging and records; the provider claims earnings to its Stellar wallet. The website manages products, agents, funding, approvals and audit records. A website-hosted agent or Run agent control is not required for this demo. No existing live feature is removed from scope.

Use [the provider-to-Codex walkthrough](docs/CODEX_MCP_LIVE_DEMO.md) as the current demonstration runbook. It includes exact values for the provider endpoint and buyer agent forms, independent service startup, funding alternatives, Codex bearer-token configuration, purchase/refusal/approval prompts, records and claims. The existing npm demo command is a deterministic rehearsal driver, not the external Codex agent; its launcher resets its journal and stops services it starts. Keep it separate from the Codex presentation. Resibo outputs are fixtures, verification reservations are off-chain, and a price refusal is not an on-chain cap rejection.

This checkpoint documents the user's confirmed plan and does not establish a new live Codex test, checkout completion or transaction. The Nov 6 native Windows review found missing platform/workspace dependencies; use a compatible runtime and fresh execution checks before claiming readiness. Historical reports below retain their original attribution.

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
| `npm run demo` | **1-Terminal Live Demo Orchestrator:** Starts Next.js (:3000), Resibo (:3001), resets ledger, and runs the real Stellar testnet demonstration driver with single-terminal interactive human approval |
| `npm run demo:fast` | Runs the 1-terminal live demo without pauses and auto-approves Step 6 via API |
| `npm install` | Install all workspaces |
| `npm run dev` | Next dev server at http://localhost:3000 |
| `npm test` | Vitest in every workspace (720 tests across 7 workspaces) |
| `npm run typecheck` | `tsc --noEmit` in every workspace |
| `npm run lint` | ESLint for apps/web |
| `npm run build` | Production build of apps/web (typechecks too) |

**Demo sign-in:** pick a workspace on `/login` (Providers: `mara@example.com` ResiboAI, `geoph@example.com` GeoPH; Buyers: `juan@example.com` Juan's Accounting, `acme@example.com` Acme AI Corp) or enter any registered organization's email. Use the in-app sidebar Workspace Switcher to switch workspaces with 1-click.

## Status
**Latest checkpoint, Nov 6 (Gemini report) — 100% Real Live Demonstration Passed:**
- **Zero Mocks, 100% Real Testnet Execution:** Executed `scripts/demo-e2e.ts` covering the entire Settl.ai lifecycle against live services:
  1. Discovery: Discovered live endpoints (`resibo_parse`, `resibo_pro`, `geoph_lookup`) through hosted `/mcp`.
  2. Escrow & Policy: Read live native XLM escrow balance (33,333,334 stroops / ₱50.00) & hard Soroban guardrails.
  3. Settl on Result (Clean Receipt): Verified OCR passing confidence, automatically settled ₱2.00 (1,333,334 stroops) on Stellar testnet: [Tx `fcb5d00a...`](https://stellar.expert/explorer/testnet/tx/fcb5d00a5dc4af8d17c3e34f9294257de169ee9db9ed84eeaa8e6364e86c3105).
  4. Outcome Protection (Blurry Receipt): Low confidence detected -> `not_charged`, ₱0.00 deducted, escrow balance untouched.
  5. Cap Protection (Pro Route): ₱15.00 exceeded ₱10.00 policy cap -> declined locally (`over_max_price`), 0 gas spent.
  6. Human In-The-Loop Approval & Settlement: ₱8.00 exceeded ₱5.00 auto-approve -> generated real approval ticket `cmw4rz4yy000eigtn2eys0z54`, buyer approved via `/api/approvals/[id]/resolve`, settled on Stellar testnet: [Tx `44f3c9cd...`](https://stellar.expert/explorer/testnet/tx/44f3c9cdaf4ace58092146b09d05022e6b42e1849f445f2661ac8fb06e5e6d95).
  7. Provider Claim: Resibo claimed accrued earnings to merchant wallet (claim `cmw4s22fr...` queued).
- **Prisma Interactive Cloud Timeouts Patched:** Resolved cloud database roundtrip timeouts (`P2028: Unable to start a transaction in the given time`) in `apps/web/lib/server/db.ts` with default `{ maxWait: 20_000, timeout: 30_000 }`.
- **Quality Gates Passing:**
  - `npm test -w @settl/stellar`: 4/4 files, 60/60 tests passing.
  - `npm test -w web`: 40/40 files, 544/544 tests passing.
  - `npm run typecheck`: 0 errors across all 7 workspaces.
  - `npm run lint -w web`: 0 errors.
  - `npm run build -w web`: 25/25 routes built cleanly.

**Previous checkpoint, Nov 6 (Gemini report):** Real RBAC, multi-account workspace management, and Neon DB connectivity complete and verified green:
- `npm test`: 682/682 tests passing across all 7 workspaces (`web` 514, `stellar` 52, `sdk` 49, `resibo` 28, `agent` 22, `core` 10, `verifier` 7).
- `npm run typecheck`: 0 errors across all 7 workspaces.
- `npm run lint`: 0 errors, 0 warnings.
- `npm run build`: Next.js 16 + Turbopack + Prisma 7 production build compiled with 0 errors (all 25 static and dynamic routes).
- Connection & Dashboard Fix: Resolved WSL2 Node 24 dual-stack IPv6 socket timeouts to Neon Postgres by enforcing IPv4 family selection in `apps/web/lib/server/db.ts` (`net.setDefaultAutoSelectFamily(false)`, `dns.setDefaultResultOrder('ipv4first')`). "Live dashboard unavailable" eliminated; live dashboard, agent creation form, and provider endpoint forms load instantly.
- Multi-Account Support: Dynamic session resolution (`resolveSession`, `findWorkspaceAccount`) supporting 4 pre-configured demo workspaces (ResiboAI, GeoPH, Juan's Accounting, Acme AI Corp) and dynamic database orgs.
- Real RBAC: `requireBuyerOrg` and `requireProviderOrg` dynamically query the database for the session's organization and enforce role boundaries.
- Cross-role navigation: `proxy.ts` strictly redirects cross-role requests (e.g. buyers navigating to `/provider` redirected to `/buyer`).
- Endpoint creation: `AddRouteForm` uses valid local origins (`http://localhost:3001/parse-receipt`) and clear inline allowed-origin guidance.
- Neon DB seeded with all 4 accounts (`org_resibo`, `org_geoph`, `org_juan`, `org_acme`).

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
4. **Demo provider (`apps/resibo`, Express with `packages/sdk`).** Fake receipt OCR with predictable outputs: clean, blurry, wrong totals. Under the Nov 7 revision, `/parse-receipt` costs ₱2 per call regardless of fixture quality. `/parse-receipt-pro` costs ₱15 per call (it gets blocked by the ₱10 cap). Add a GeoPH-like ₱8 service for the approval demo.
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
- Keep the demo script working with the Nov 7 user revision: clean and blurry mock receipts each incur the ₱2 usage fee, the ₱15 Pro call is refused at a ₱10 caller cap, the ₱8 GeoPH call needs approval, and claiming works. The general outcome product mode retains its separate failed-check/no-charge behavior.
- Update this file and the plan's revision note when a decision changes.
