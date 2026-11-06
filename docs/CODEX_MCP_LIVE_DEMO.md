# Settl.ai: Provider-to-Codex Live Demo

Updated: November 6, 2026. Network: Stellar testnet only.

## The agreed product flow

A provider sells an API endpoint. An AI company funds an agent's prepaid XLM escrow and sets spending limits. The company connects its existing CLI agent, such as Codex CLI, to Settl's MCP server. The agent discovers a service and requests it. Settl checks policy, coordinates payment and returns the API result with a receipt. The company and provider inspect the records on the website; the provider claims its earnings to its Stellar wallet.

The website is the management console. Codex CLI is the external AI agent. No website-hosted agent or "Run agent" button is required for this demo.

The company pays per use. Selecting an allowed provider does not itself purchase an API call. Available spending money must be funded into Noir escrow; the agent does not get unrestricted access to the company's wallet.

| Participant | Responsibilities |
| --- | --- |
| Provider: ResiboAI | Register a priced endpoint, run its API with the Settl Express middleware, receive pending earnings and claim them. |
| Buyer: Juan's Accounting | Register an agent, fund its escrow, set policy and approve exceptional requests. |
| External agent: Codex CLI | Discover services, request paid API calls and use their returned data. |
| Settl | Authenticate the agent, enforce spending rules, verify outcomes, submit Noir operations and store audit records. |
| Noir on Stellar | Register identities/policies, hold escrow, authorize payments and pay provider claims. |
| Velo | Provide checkout and eligible transaction fee sponsorship. Settl's configured relayer can pay fees after specific sponsorship refusals. |

### What is live and what is a sample

- HTTP/MCP requests, result verification, escrow operations and successful Stellar transactions are live when the services are running and configured.
- The existing Resibo server returns deterministic receipt fixtures. It does not call an OCR model. Present it as a sample paid receipt API.
- The current wallet model is custodial and testnet-only. Settl holds encrypted signing keys; Codex receives only its agent-scoped bearer credential.
- Result checks and quote-to-payment mappings are stored in PostgreSQL. The full receipt output and checks are not written into a custom on-chain outcome receipt.
- A successful `authorize` credits a merchant's pending escrow earnings. A separate `claim` pays the merchant wallet.
- Codex integration is the chosen demo plan; this guide does not claim that a fresh Codex-to-Settl live run has already been verified.

## Step 1. Prepare the runtime and services

Run npm commands from the repository root: `C:/Users/Miggy/Documents/Noir` on Windows, or `/mnt/c/Users/Miggy/Documents/Noir` in WSL.

Use Node 24.22.1, the previously verified runtime, or another version satisfying the Noir SDK's declared engine range: `^22.23.4 || ^24.22.1 || >=26.12.1`. Node 24.19.0 does not meet that range.

Use one execution environment consistently. Native Windows and WSL need platform-compatible dependencies and workspace links. If dependencies are broken, repair the installation in the chosen environment before rehearsing; do not delete the lockfile as a first response.

For a fresh setup:

```sh
npm install
npm run db:generate -w web
```

Use an already configured demo database when available. For a new database, follow the [database setup instructions](../apps/web/prisma/README.md) and the repository's migration history. Seeding creates database records; it does not register or fund the seeded Bookkeeper on Stellar. Do not reset an existing database to prepare a presentation.

### Server configuration

Preserve the existing ignored `apps/web/.env.local`. If it does not exist, use [.env.example](../.env.example) as the template. Never copy placeholder values over working credentials.

| Configuration | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL persistence. |
| `WALLET_ENC_KEY` | Stable 64-hex-character key for encrypted wallet custody. |
| `STELLAR_RPC_URL`, `STELLAR_NETWORK_PASSPHRASE` | Stellar testnet RPC/network. |
| `NOIR_DEVICE_REGISTRY_ID`, `NOIR_AGENT_REGISTRY_ID`, `NOIR_PAYMENT_ESCROW_ID` | Explicit Noir contract addresses. Use the running environment as the source of truth. |
| `VELO_GAS_API_KEY` | Gas Station credential. |
| `SETTL_PROVIDER_KEY` | Shared testnet service credential; must match the provider server. |
| `SETTL_TREASURY_SECRET` | Prefunded testnet treasury used for escrow funding; also the default relayer fallback. |
| `SETTL_RELAYER_SECRET` | Optional separate fallback fee payer. |
| `VELO_API_KEY`, `VELO_WEBHOOK_SECRET` | Checkout and signed checkout webhook processing. |
| `PHP_PER_XLM` | Fixed presentation exchange rate; the example uses 15 PHP per XLM. |
| `SETTL_PROVIDER_ALLOWED_ORIGINS` | Origins accepted when registering provider URLs. Defaults include local port 3001. |
| `CRON_SECRET` | Required only when demonstrating the protected automation worker. |

Codex uses its own existing model access. You do not need a Groq key or the separate `apps/agent` runner when Codex is the client.

### Start the services in separate terminals

Terminal A, website and MCP:

```powershell
npm run dev
```

Terminal B, provider API, using PowerShell:

```powershell
$env:SETTL_API_URL = "http://localhost:3000"
$env:SETTL_PROVIDER_KEY = "<same value configured in apps/web/.env.local>"
npm run start -w @settl/resibo
```

If using WSL/Bash, use this equivalent in Terminal B:

```bash
export SETTL_API_URL="http://localhost:3000"
export SETTL_PROVIDER_KEY="<same configured provider key>"
npm run start -w @settl/resibo
```

Keep both terminals running. The provider is at port 3001, and the website/MCP server is at port 3000. A browser GET to a POST-only provider route is not a valid health test.

### If `npm run demo` is already running

That command launches a deterministic purchase driver in addition to the services. Let any submitted payment reach a known state before switching approaches. It is not the Codex-client demo described here.

The current Python launcher deletes its local demo journal and lock, uses POSIX process APIs and stops processes it started when it exits. Do not rerun it merely to restart the website, and do not run its buyer sequence concurrently with Codex for the same agent. Use the independent service commands above for this presentation.

## Step 2. Show the API provider's product

Open `http://localhost:3000/login`, choose ResiboAI / `mara@example.com`, then open `http://localhost:3000/provider/endpoints`.

Your screenshot already shows these registered routes:

| Endpoint ID | Route | Price | Payment mode |
| --- | --- | --- | --- |
| `resibo_parse` | `POST /parse-receipt` | PHP 2.00 | On every call. |
| `resibo_pro` | `POST /parse-receipt-pro` | PHP 15.00 | On every call. |

Use those existing routes. Adding the same provider/method/path again is rejected as a duplicate.

### What each "Price a new route" field means

These are the receipt route's reference values. Do not submit them again when the existing route is already listed.

| Website field | Receipt demo value | Meaning |
| --- | --- | --- |
| Route name | `Receipt OCR` | Human-readable product name. `resibo_parse` is an endpoint ID, not a required route name. |
| Route path | `/parse-receipt` | Path mounted on the provider's API server. |
| Provider URL | `http://localhost:3001/parse-receipt` | Full URL Settl calls to execute the service. This is not the Settl website or `/mcp` URL. |
| Price per call, PHP | `2.00` | Display price converted into native testnet XLM stroops using the configured fixed rate. |
| When agents pay | `On every call` | The API usage fee is authorized before the mock provider runs, independent of fixture quality. |

This is the November 7 usage-billing revision. Existing databases must apply the [scoped billing update](../apps/web/prisma/README.md#existing-mock-ocr-billing) before presenting the revised flow. Do not purchase again while discovery still reports `resibo_parse` as `outcome`. No image is required; omitted input selects the mock's clean fixture.

The Pro route uses `/parse-receipt-pro`, URL `http://localhost:3001/parse-receipt-pro`, price `15.00`, and `On every call`.

For an actually new product, use a distinct route and an implemented provider handler. Registration returns a generated endpoint ID. Copy the integration snippet for that exact endpoint into the provider server. Registering a URL does not deploy an API handler.

## Step 3. Show the provider SDK integration

The current provider middleware is the Express export `settl` from `@settl/sdk`. It handles per-call and outcome modes using the endpoint's stored settings.

```typescript
import { settl } from "@settl/sdk";

app.post(
  "/parse-receipt",
  settl({
    endpointId: "resibo_parse",
    apiUrl: process.env.SETTL_API_URL,
    apiKey: process.env.SETTL_PROVIDER_KEY,
  }),
  yourJsonHandler,
);
```

`yourJsonHandler` means the provider's existing handler; it is not an SDK export. The repository's [Resibo server](../apps/resibo/src/server.ts) already mounts the real middleware and returns sample receipt JSON. Do not paste a second handler onto the same route.

`@settl/sdk` is currently a private workspace package in this repository. This demo does not assume that an external startup can install it from public npm. The implemented adapter is Express middleware; Next.js/Fastify adapters are not established by this guide.

The provider middleware validates payment or reservation proof before serving the protected handler. Outcome handlers must return JSON so the SDK can submit and deliver the same result snapshot after verification.

## Step 4. Create the AI company's agent on the website

Switch to Juan's Accounting / `juan@example.com`, then open `http://localhost:3000/buyer/agents/new`.

Enter these values in the form from your second screenshot:

| Website field | Enter/select | What it controls |
| --- | --- | --- |
| Agent name | `Codex Purchasing Agent` | Name shown on the company's agent and payment records. |
| Most per payment, PHP | `10.00` | Per-payment cap; also used as the broker's configured maximum price. |
| Most per day, PHP | `50.00` | Cumulative daily spending limit, enforced by Settl using UTC days. Change the form's default `20.00` to `50.00` for this walkthrough. |
| Pays without asking up to, PHP | `5.00` | Payments above this require buyer approval. |
| Stops working on (UTC) | `12/31/2026` | Select December 31, 2026, or another date after the actual demonstration date. |
| Providers it may pay | Check `ResiboAI` and `GeoPH` | Allow both services needed for the demonstration. An empty selection blocks all providers. |

Click **Create agent** once. Wait for **Agent registered on Stellar** / `active`. A provisioning or error result is not ready to spend; inspect its state before creating another agent or repeating registration.

Save both the returned agent ID and its one-time `stl_agent_...` API key. The ID selects the agent's dashboard/funding record. The API key authenticates Codex as that agent. They are different values.

Use **View agent** to open `/buyer/agents/<AGENT_ID>`. New agents start with no funded escrow. A PHP 50 daily limit is permission to spend up to that amount, not a PHP 50 deposit.

If using the already active, funded Bookkeeper instead, inspect its settings and use its existing matching token. Do not use the seeded Bookkeeper token for a newly created agent.

## Step 5. Fund the agent's XLM escrow

Use one of the following funding paths and identify it honestly during the demo.

### A. Velo Checkout through the website

1. On the agent detail page, click **Load budget**.
2. Enter `50.00` PHP and continue to checkout.
3. Complete the testnet XLM payment in hosted checkout using the appropriate funded wallet.
4. Velo sends a signed event to Settl's public `/api/velo/webhook` endpoint.
5. Settl verifies the event and independently retrieves the paid intent.
6. The prefunded Settl treasury submits Noir `fund_escrow` for this agent's device.
7. Refresh the agent page. Continue only after funding is `completed` and a live chain balance is observed.

For a local server, configure a publicly reachable HTTPS callback that forwards to the running Settl webhook route. Velo cannot deliver a remote webhook directly to your machine's `localhost`. Use an already configured public deployment or tunnel; its setup is separate from starting Next.js. Preserve the raw request body and signature headers.

A successful checkout redirect is not funding evidence. Checkout and treasury-to-escrow funding are two separate transactions. Treasury control of the checkout receiver and a complete live checkout cycle still need explicit rehearsal; do not assume checkout receipts directly replenish the treasury.

### B. Operator-funded testnet escrow for the CLI purchase demo

This uses the configured treasury to fund escrow directly. Present it as testnet prefunding, not a completed Velo Checkout.

For `PHP_PER_XLM=15`, PHP 50 rounds up to `33333334` stroops, or `3.3333334` XLM:

```sh
npx --no-install tsx scripts/fund-agent.ts "<AGENT_ID>" 33333334 "codex-demo-initial"
```

Replace `<AGENT_ID>` with the exact ID from Step 4. The last argument identifies this deliberate funding operation. Reusing a completed operation returns its recorded result; it does not deposit again. If it is pending or failed, reconcile before any further treasury transfer. Do not change the operation key merely to bypass an unresolved attempt.

Confirm a successful funding transaction and observed escrow balance on the agent page. Funding the treasury's wallet or the agent's ordinary Stellar account alone does not fund the Noir escrow.

## Step 6. Connect the external Codex CLI to Settl MCP

Run Codex in the environment where it is installed and authenticated. This can be a separate demo workspace; it does not need to edit Settl's source code.

Edit the existing Codex `~/.codex/config.toml` and add this table, preserving unrelated settings. On native Windows this normally means `%USERPROFILE%/.codex/config.toml`; WSL has its own home directory/configuration. If a `settl` table already exists, update it instead of adding a duplicate.

```toml
[mcp_servers.settl]
url = "http://localhost:3000/mcp"
bearer_token_env_var = "SETTL_AGENT_API_KEY"
startup_timeout_sec = 30
tool_timeout_sec = 180
```

The URL must be reachable from the process running Codex. If Codex is remote or `localhost` refers to a different machine/environment, use the deployed HTTPS MCP URL or a reachable demo host instead.

In a fresh PowerShell terminal, set the key from Step 4 and start Codex:

```powershell
$env:SETTL_AGENT_API_KEY = "<API key belonging to this funded agent>"
codex
```

WSL/Bash equivalent:

```bash
export SETTL_AGENT_API_KEY="<API key belonging to this funded agent>"
codex
```

The token belongs in the launching process's environment. This MCP configuration does not automatically read the web app's `.env.local`. Do not put the treasury secret, a wallet secret or the provider key in this variable.

Inside Codex, enter `/mcp` and confirm Settl is connected. Restart the Codex session after changing its MCP configuration or launching environment.

The expected tools are:

| Tool | Purpose |
| --- | --- |
| `settl_get_budget` | Read this agent's live escrow balance, spending limits, holds and approvals. |
| `settl_list_services` | Discover active priced endpoints. |
| `settl_quote` | Obtain terms without charging. |
| `settl_call` | Request a service purchase under the authenticated agent's policy. |
| `settl_check_approval` | Read one of this agent's approvals. |
| `settl_receipts` | Read terminal payment/verification receipts for this agent. |

MCP authentication determines the agent identity. Codex does not supply an arbitrary `agentId` to choose whose money to spend. No Settl SDK installation is required in Codex for this HTTP MCP connection.

## Step 7. Establish the live starting state

Send this prompt to Codex:

> Use the Settl MCP tools to read my budget and list the available paid services. Show the available escrow balance, per-payment cap, daily spending remaining, automatic approval threshold, and prices for resibo_parse, resibo_pro and geoph_lookup. Do not purchase anything yet. Do not edit the repository or run its demo scripts.

Confirm that the selected agent has enough escrow and remaining daily budget for both clean and blurry receipt calls plus GeoPH, and no unresolved payments or holds. In this example, those three purchases total 8,000,002 stroops, displayed as PHP 12.00 at the demo rate.

The provider server at port 3001 must be reachable from the Settl backend. Discovery alone does not prove provider execution works.

## Step 8. Have Codex buy and use the provider's result

Send this prompt:

> Use the Settl MCP tools to purchase one clean sample receipt from resibo_parse. Pass input {"fixture":"clean"} and maxPricePhp "2.00". Make actual tool calls. After a confirmed paid result, use the returned data to summarize the merchant, receipt date, line items and total. Show the API fee, quote ID and Stellar transaction hash separately. If the payment is pending, unknown or fails, stop and report its status without resubmitting.

Expected path:

1. Codex requests `settl_call` for `resibo_parse`.
2. Settl checks policy and commits a durable pending payment marker.
3. Settl submits Noir `authorize` through its transaction adapter.
4. Confirmed settlement records the paid receipt before the provider request.
5. Settl invokes the provider with transaction proof; its SDK verifies that proof before returning the sample JSON.
6. Settl returns the paid receipt and provider data, or a provider error alongside the confirmed charge.
7. Codex uses that data in its answer.

The clean fixture has merchant `Resibo Demo Store`, receipt date `2026-11-05`, total PHP `1250.50`, line amounts `1000.00` and `250.50`, and confidence `0.98`. The receipt's business total of PHP 1,250.50 is different from the API usage fee of PHP 2.00.

At the example rate, the API fee is `1333334` stroops / `0.1333334` XLM. Expect status `paid`, a quote ID, a real transaction hash, returned receipt data, and a reduced live escrow balance. Per-call receipt checks can be empty: payment is for usage, without an outcome-quality guarantee. A provider failure after confirmed payment retains the paid receipt with `providerError`.

Future presentations should review sample dates and policy expiry. Result-date verification applies only to explicitly configured outcome products.

## Step 9. Show the matching website and Stellar records

1. Refresh `/buyer/agents/<AGENT_ID>`.
2. Open the new **Paid** activity entry using **View call**.
3. Show the quoted/charged usage amount. Per-call products have no required result checks.
4. Open its actual transaction hash link.
5. Confirm successful execution against the configured Noir payment escrow contract.

The explorer URL format is `https://stellar.expert/explorer/testnet/tx/<ACTUAL_TX_HASH>`. Use the hash from this run, not a historical example from another guide.

Noir authorization arguments identify the agent, device hash, merchant, asset, amount and nonce. The broker's proof validation matches those fields to the stored quote. The website and database link that quote to its transaction.

| Stored on Stellar | Stored by Settl off-chain |
| --- | --- |
| Contract invocation and successful execution evidence. | Quote ID, endpoint and buyer/provider relationships. |
| Agent/device/merchant/asset/amount/nonce in the authorization. | Verification checks and reasons. |
| Escrow state, provider pending balance, funding and claim operations. | Reservations, approval decisions and API activity records. |

The current contracts do not independently prove OCR correctness. The verifier checks the provider's supplied output; a custom outcome-attestation contract is not part of this implementation.

## Step 10. Demonstrate usage billing for a blurry mock result

Send this prompt to Codex:

> Request resibo_parse once with input {"fixture":"blurry"} and maxPricePhp "2.00". Use the actual Settl result. Show the API usage fee, the mock receipt's confidence, the real transaction hash, and the balance afterward. Do not retry an uncertain payment or book low-confidence receipt data as a business expense.

Expected: confidence is `0.42`, status is `paid`, and the API fee is PHP 2.00, the same as the clean fixture. Receipt quality does not waive a per-call usage fee.

Refresh buyer activity and show **Paid**, the usage amount, and this call's transaction hash. The escrow balance decreases by the fee and confirmed daily spend increases by it. Outcome billing remains an optional product mode and must be explicitly configured before demonstrating a failed-result refund-free release; it is no longer the default mock OCR product.

## Step 11. Demonstrate a price refusal

Send this prompt:

> Request resibo_pro once using input {"fixture":"clean"} and maxPricePhp "10.00". Honor any refusal. Report the actual status and reason without changing my cap or retrying the purchase.

Expected: the PHP 15 service exceeds the PHP 10 limit. Settl returns `declined` with `over_max_price` before payment or provider execution.

This demonstrates Settl's off-chain maximum-price enforcement. It does not demonstrate an on-chain rejection. The broker returns this refusal before creating a Payment row, so it may be visible only in Codex's tool result rather than the website's payment activity table. No Stellar payment record is expected.

## Step 12. Approve an exceptional purchase on the website

Send this prompt:

> Use Settl to request geoph_lookup with input {"city":"Makati"} and maxPricePhp "10.00". If approval is required, show the approval ID and the URL http://localhost:3000/buyer/approvals/<approvalId>, then wait for me. Do not create another approval request. Stop on pending or unknown payment outcomes.

Expected: PHP 8 is within the PHP 10 cap but above the PHP 5 automatic threshold. The response is `approval_required`; no payment has happened yet.

1. Stay signed in as the agent's owning buyer.
2. Open **Waiting on you** or the exact approval URL in Codex's output.
3. Review the provider, amount and agent; click **Approve**.
4. Return to Codex promptly. Quotes and approvals currently expire five minutes after issue; the response contains the actual deadline.
5. Send this continuation:

> Check the existing approval with settl_check_approval. If it is approved and unexpired, resume geoph_lookup exactly once using the same input, maxPricePhp "10.00" and that approvalId. Show the real result and transaction hash. Do not submit a replacement request if settlement is pending or unknown.

Expected: status `paid`, GeoPH data for Makati and a new Stellar transaction hash. The agent resumes the same approved quote rather than obtaining permission for an unrelated purchase.

Refresh the buyer activity and show this second paid call. Use separate browser profiles for buyer/provider sessions when convenient; switching workspaces in one profile changes that profile's current demo identity.

## Step 13. Claim the provider's earnings

Switch to ResiboAI / `mara@example.com`, open `http://localhost:3000/provider/earnings` and refresh the observed pending balance.

1. Show the merchant wallet and paid API activity.
2. Click **Claim**, then **Confirm claim** once.
3. Wait for `completed`; if pending, inspect the recorded claim rather than submitting another.
4. Open the claim's returned Stellar transaction link.
5. Inspect the successful claim and its transfer effects to the provider's merchant wallet.

The receipt authorization and provider claim have different transaction hashes. A merchant claim collects all of that merchant's pending earnings, possibly from previous calls and multiple buyers. Its displayed amount is the pending balance observed before submission, not a guaranteed exact payout receipt under concurrent payments.

GeoPH's PHP 8 earnings belong to its own provider wallet. Switch to `geoph@example.com` and claim separately if demonstrating both payouts. ResiboAI cannot claim GeoPH's earnings.

If an enabled auto-claim already emptied the pending balance, show the completed claim history instead. The automation worker requires configured credentials and an external recurring POST; the website does not itself schedule it.

## Step 14. Close the demo with its evidence

Ask Codex to read `settl_receipts` and summarize observed outcomes without making additional purchases.

| Demonstrated action | Expected evidence |
| --- | --- |
| Company funds agent | Completed funding record, actual funding hash and observed escrow balance. |
| Codex purchases clean receipt | Useful returned data, paid receipt, passing checks and authorization hash. |
| Blurry result rejected | Not-charged receipt, failed confidence check and unchanged balance. |
| Expensive product refused | Actual CLI tool response `declined / over_max_price`. |
| Buyer approves GeoPH | Owned approval, one approved resumption and paid authorization. |
| Provider receives payout | Completed claim plus its separate transaction/transfer evidence. |

Suggested narration:

> "The provider prices an API. The company gives its existing AI agent a prepaid XLM budget and limits. We connect Codex to Settl through MCP. Codex discovers and uses the API, Settl enforces the spending rules, and a passing result triggers payment through Noir on Stellar. Both sides can inspect the payment record, and the provider can claim the earnings to its wallet."

## Rehearsal checklist and troubleshooting

### Checkout succeeds but the agent still has no budget

Do not pay again. A `?topup=success` redirect is informational and does not authorize treasury funding.

1. Refresh the agent page and check **Budget loads** for the original operation.
2. If it is `pending`, inspect the original Velo payment intent and its webhook delivery history. Velo must deliver `payment.succeeded` to a publicly reachable HTTPS URL forwarding to `/api/velo/webhook`. A local `http://localhost:3000` URL is not reachable from Velo's servers. Keep `x-velo-signature`, `x-velo-delivery` and the raw request body intact, and ensure the endpoint's signing secret matches `VELO_WEBHOOK_SECRET`.
3. Fix the callback URL or delivery failure, then resend the original payment event from Velo's delivery controls if available. This retries notification of the existing payment; it does not purchase or fund again. Do not fabricate a webhook body or bypass signature verification.
4. If it is `paid`, checkout has been verified but treasury funding has not completed. Inspect server errors and the configured treasury balance. The protected automation worker can drain already-paid jobs; it cannot discover a missing checkout webhook.
5. If it is `funding` or `failed`, inspect its stored recovery metadata and transaction identity before retrying anything. An unresolved submission must be reconciled against Stellar before another transfer.
6. Continue only after `completed`, a funding transaction hash and an observed escrow balance. Then ask Codex to call `settl_get_budget` again.

The November 6 patch adds an explicit request-time boundary to both live dashboard loaders for Next.js clock reads. Restart only the web dev server if hot reload does not apply it. Restarting the deterministic demo launcher may start another purchase sequence and is not necessary for this fix.

| Symptom or check | Action |
| --- | --- |
| No Settl tools in Codex | Check `/mcp`, the loaded config file, reachable server URL and a newly launched session. |
| Unauthorized MCP connection | Check the launching process's agent key, its stored identity/revocation state and active agent status. A website login cookie does not authenticate MCP. |
| Newly created agent has zero funds | Fund its specific Noir device escrow. Daily limits do not deposit money. |
| Wrong agent activity | Use the new agent's token and dashboard ID together; do not silently use the seeded Bookkeeper token. |
| Provider unavailable or SDK authentication fails | Confirm the provider process, stored endpoint URL, and matching server-side provider key. |
| New route cannot be saved | Check duplicate provider/method/path and the configured allowed URL origins. |
| New route appears but cannot execute | Implement its actual handler and use its generated endpoint ID in the provider middleware. |
| Checkout returns but budget is unchanged | Check payment state, public webhook delivery, treasury funding status and live balance. A redirect is not confirmation. |
| Paid or funding transaction is pending/unknown | Stop additional submissions for the affected agent/source. Record quote/top-up/claim IDs, hashes and recovery identity, then reconcile. There is no automatic pending-transaction recovery worker. |
| Approval expired | Inspect its actual status. Do not resume it or silently create another request. Deliberately prepare a new request only after resolving the old attempt. |
| Sponsorship refused | Inspect `transport` and `sponsorshipError`. Report Velo sponsorship only when supported by the actual result; configured relayer fallback is different. |
| Repeating a demonstration | Budget and prior paid calls remain real. Review pending work, remaining escrow and daily spend; a local journal reset does not undo blockchain transactions. |
| The website stops after `npm run demo` | Its launcher cleans up processes it started. Start services independently for the Codex demo. |
| Showing the stage page | `/stage` retains scripted presentation data. Use the buyer/provider dashboards and actual CLI/explorer evidence for live claims. |

Before calling a runtime ready, run from the repository root:

```sh
npm test && npm run typecheck && npm run lint && npm run build
```

The November 6 Windows review could not certify a green runtime: tests were blocked by missing `@rollup/rollup-win32-x64-msvc`, typecheck could not resolve some workspace links, and build could not find Prisma. Lint passed. Historical successful verification reports in HANDOFF do not replace a check in the environment used for the presentation.

This documentation does not run migrations, seed data, create agents, fund escrow, configure Codex, or purchase services on your behalf. Perform the steps in order and capture new evidence during rehearsal.

## Implementation and reference map

| Area | Source |
| --- | --- |
| Provider API and sample outputs | [server](../apps/resibo/src/server.ts), [fixtures](../apps/resibo/src/fixtures.ts) |
| Provider middleware | [SDK entry](../packages/sdk/src/index.ts), [middleware](../packages/sdk/src/middleware.ts), [outcome handshake](../packages/sdk/src/outcome.ts) |
| Agent creation and policy | [agent service](../apps/web/lib/server/agents.ts) |
| MCP transport and tools | [route](../apps/web/app/mcp/route.ts), [tools](../apps/web/lib/server/mcp-tools.ts) |
| Quote, policy and settlement | [broker](../apps/web/lib/server/broker.ts), [policy](../apps/web/lib/server/policy.ts) |
| Checkout/funding and payouts | [Velo integration](../apps/web/lib/server/velo.ts), [claims](../apps/web/lib/server/claims.ts), [operator funding](../scripts/fund-agent.ts) |
| Chain submission and proof | [Noir adapter](../packages/stellar/src/noir.ts), [gas adapter](../packages/stellar/src/gas.ts), [proof decoder](../packages/stellar/src/proof.ts) |
| Live dashboard records | [dashboard queries](../apps/web/lib/server/dashboard.ts) |

Codex configuration is based on the [official MCP documentation](https://developers.openai.com/codex/mcp), checked November 6, 2026. It documents Streamable HTTP, bearer-token environment variables, config tables, `/mcp`, and tool timeouts. Use the options supported by the installed Codex version.
