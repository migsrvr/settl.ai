# Handoff: Settl.ai

Last updated 2026-11-04 by Claude (Claude Code). Read this first, then the docs it links to.

## What this is
**Settl.ai** is pay-as-you-go for AI agents, built for the Velo x Noir Agentic Payment Hackathon on Stellar testnet.
- **Providers** (example: ResiboAI, a receipt-OCR API) put a price on their API.
- **Buyers' AI agents** pay for each call from a prepaid, capped escrow on Stellar. In *Settl on Result* mode they pay only when the result passes agreed checks.
- **Settl** is the facilitator. It hosts an MCP server so any AI agent can find paid tools and pay for them, and it holds the agents' keys (custodial, testnet only).

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
apps/web                Next.js 16 app: UI + (future) API routes + hosted MCP
  app/                  routes: / (landing), /login, /provider/*, /buyer/*, /stage
  components/           ui.tsx (Button, Pill, TabBar, Meter…), app-shell.tsx, provider/*, buyer/*, stage-player.tsx
  lib/auth.ts           demo accounts + SESSION_COOKIE ("settl_demo" = "provider" | "buyer")
  lib/demo-data.ts      hardcoded demo data the UI renders today
  lib/claim.ts, stage.ts  pure state machines behind the claim flow and stage view
  lib/server/           backend logic (pure, tested): policy, nonce, reservations, webhooks, events
  proxy.ts              Next 16 "proxy" (formerly middleware): guards /provider and /buyer
packages/core           @settl/core: Zod schemas (Quote, PaymentHeader, Receipt), header encoding, peso/XLM/stroop math
packages/verifier       @settl/verifier: receipt v1 checks (runChecks)
docs/superpowers        specs and plans
.claude/launch.json     dev-server launch config (npm run dev, port 3000)
```

## Commands (run from the repo root)
| Command | What it does |
|---|---|
| `npm install` | Install all workspaces |
| `npm run dev` | Next dev server at http://localhost:3000 |
| `npm test` | Vitest in every workspace (47 tests, all passing) |
| `npm run typecheck` | `tsc --noEmit` in every workspace |
| `npm run lint` | ESLint for apps/web |
| `npm run build` | Production build of apps/web (typechecks too) |

**Demo sign-in:** pick a workspace on `/login` (`mara@example.com` is the provider, `juan@example.com` the buyer). Any password works.

## Status
**Done and verified** (typecheck, lint, 47 tests, build all pass):
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

**Not started:** the database, the chain adapter, the broker, API routes, the hosted MCP, the provider SDK, the demo provider, the demo agent, the Velo integration, and wiring the UI to live data. Nothing has touched testnet yet.

**Git:** the repo is initialised on `master`, with **no commits yet**. Commit only when the user asks. Stay on `master` unless they say otherwise.

## What to build next (in this order)
Each step: write failing tests first, then the code, then run the full check (`npm test && npm run typecheck && npm run lint && npm run build`).

1. **Chain adapter (`packages/stellar`).**
   - Wrap `@noirx402/agent-sdk@0.3.0` (on npm) and `@stellar/stellar-sdk@17`.
   - Functions: register device, register agent policy, `fund_escrow`, `authorize`, `claim`, `balance_of`, `pending_balance`, `get_policy`, revoke and sweep in the safe order (revoke_agent, then sweep_on_revoke, then device revoke).
   - Fee sponsorship through Velo Gas Station: `velo.gas.sponsorAndSubmit(signedXdr, { idempotencyKey })`, then `waitForResult`; only the `succeeded` status counts. Friendbot to create testnet accounts.
   - **Gate:** a real `authorize` lands on testnet. Write the outcome of the remaining checks in `docs/spikes.md`:
     - Is `payment_escrow` on Gas Station's allowed-contract list? If not (`contract_not_whitelisted`), a Settl relayer account pays the fee in testnet XLM.
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
- **Testnet IDs** (also in the parent spec §8.2; confirm against the hackathon form):
  - `device_registry`: `CB4DPMGOA374JIB2ZVD4AHW5GJKQUYNOFGRYNOJ75EFH2KCJSMHOWIRA`
  - `agent_registry`: `CBTDMJVCFQDIVWZBKAKZ2FQ3UEJNAAUFYCTJ3E4ON2MYXPLPSIXQ25JZ`
  - `payment_escrow`: `CA5S4S7QGHJHJWVJBYL3CXZXZTNGKXMNZVDAEQNN7NUXFP4D7BYK7HIX`

## Velo facts
- **Gas Station.** It takes a fully signed envelope with **exactly one** `invokeHostFunction` and wraps it in a fee bump. It needs `VELO_GAS_API_KEY` (`tg_test_…`), separate from `VELO_API_KEY`. Refusal codes: `contract_not_whitelisted`, `daily_cap_exceeded`, `wallet_rate_limited`.
- **Webhooks.** Events: `payment.succeeded`, `payment.failed`. Headers: `x-velo-signature` (HMAC-SHA256 over the raw body) and `x-velo-delivery`.
- **SDK version.** `@carts1024/velo-sdk`: the `latest` tag is alpha.2, the `alpha` tag is alpha.4. Install with `@alpha`.

## Gotchas
- **Next.js 16 differs from older versions.** Read `node_modules/next/dist/docs/` before using an API (see `apps/web/AGENTS.md`):
  - Middleware is now `proxy.ts`.
  - `cacheComponents` is on, so reading `cookies()` or `headers()` in a page needs a `<Suspense>` boundary. The UI avoids this: pages are static and client components hold the state.
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
Copy `.env.example` to `apps/web/.env.local` and fill it in. **The user still has to supply:** the Velo keys from velo-build.dev (`VELO_API_KEY`, `VELO_WEBHOOK_SECRET`, `VELO_GAS_API_KEY`) and a Neon `DATABASE_URL`. Never commit real keys.

## Working agreement
- Write tests before code, then run the full check before calling anything done.
- Don't commit, push or switch branches unless the user asks.
- Keep the demo script working (parent spec §13): a clean receipt is paid, a blurry one isn't charged, the ₱15 Pro call is blocked, the ₱8 GeoPH call needs approval, and claiming works.
- Update this file and the plan's revision note when a decision changes.
