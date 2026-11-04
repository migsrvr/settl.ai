# Settl.ai: Design Draft

> Pay-as-you-go for AI agents.
> Agents pay startups' APIs per use, or only for results that pass agreed checks, from a prepaid, capped budget settled on Stellar.

**Naming:** the brand is **Settl.ai**, shortened to "Settl" in body text. Packages are `settl-sdk` and `settl-client`, and the client function is `settlFetch()`. Outcome mode is marketed as **"Settl on Result"**.

- **Event:** Velo x Noir Agentic Payment Hackathon (build Nov 5, submit by Nov 8, 8:00 AM Manila)
- **Team:** solo
- **Status:** FINAL v1.0. Concept and design only; no code yet.
- **Platform:** responsive web app (desktop-first, works on a phone). No native mobile app.
- **Date:** 2026-11-03

---

## 1. One-liner and pitch

**One-liner:** Settl.ai is pay-as-you-go for AI agents: when an agent uses a startup's API, it pays per use from a prepaid, capped budget on Stellar, and can pay only for results that pass agreed checks. Startups earn from AI agents with five lines of code, with no subscriptions or invoices.

**Pitch line:** *"Agents pay as they go. Startups Settl."*

**Registration form answers (submitted wording):**
- *Idea:* "Settl.ai is pay-as-you-go for AI agents: when an agent uses a startup's API, it pays per use from a prepaid, capped budget on Stellar, and can pay only for results that pass agreed checks. Startups earn from AI agents with five lines of code, with no subscriptions or invoices, and companies never face a runaway bill."
- *Noir and Velo:* see §8. Each agent's identity is registered in `device_registry` and its limits in `agent_registry`. Its budget is loaded through Velo Checkout and confirmed by webhook into `payment_escrow`. Each use is paid with `authorize`, submitted only on a passing result in Settl on Result mode, with fees sponsored by Velo Gas Station. Providers collect with `claim`, and revoking an agent returns its unused budget.

**30-second pitch:**
AI agents are becoming software's newest customers. They need to buy OCR, translation, data and models while they work. But SaaS billing assumes a human with a credit card, a signup form and a monthly plan, and Stripe doesn't support PH-registered businesses. Settl.ai makes any API pay-as-you-go for agents. An agent hits the API and gets back "402, pay ₱2". It checks its budget, pays from a prepaid escrow and gets the result. In outcome mode the startup gets paid only when the result passes checks both sides agreed on up front. Startups monetize agents from day one. Companies let agents spend without fearing a runaway bill.

---

## 2. The problem

### For startups (providers), the hero side
- Usage-based billing is hard to build: metering, invoicing, failed cards, dunning.
- Agents can't complete human checkout flows (signup, card, plan, API key).
- PH startups have limited access to global usage-billing tools. Stripe doesn't support PH-registered businesses (to re-verify before pitching), and local gateways are built for cards and e-wallets, not machine payments.
- "Pay per outcome" pricing (per resolved ticket, per correct extraction) is in demand but needs a neutral way to decide what counts as a good outcome.

### For companies running agents (buyers)
- Giving an agent a corporate card is unsafe: there are no caps per agent, no per-provider rules and no audit trail.
- Every new tool means a human signup and API-key handling, multiplied across tools and agents.
- They pay for garbage outputs because billing is per call, not per result.

---

## 3. The solution

### Roles

| Role | Example | What Settl gives them |
|---|---|---|
| **Buyer** (owns the agent) | Juan's Accounting Firm runs an AI bookkeeping agent | Agents that buy tools on their own, with on-chain caps, allowlists and an audit trail |
| **Agent** (the buyer's AI worker) | The bookkeeping agent processing 500 receipts | `settlFetch()`, which pays automatically, within policy |
| **Provider** (sells the API) | ResiboAI sells receipt OCR | Pay-per-use or pay-per-result revenue with no billing system |
| **Verifier** (Settl's judge) | Checks the OCR output | A neutral pass/fail decision before money moves |

The AI agents are the **customers**. The provider's API may or may not be AI.

### Analogy
A highway toll. Startups own the roads (APIs). Agents are the cars. Escrow is the prepaid RFID load (like Autosweep or Easytrip). The policy is the fleet manager's rules. The verifier is a toll that only charges if the road got you where you needed to go.

---

## 4. How it meets the hackathon requirements

| Requirement | How Settl meets it |
|---|---|
| Agentic payment: the agent decides, requests or makes the payment | The agent decides whether a tool is worth paying for and within budget. The verifier decides whether a result earned its payment. The provider's API *requests* payment through 402. |
| Built with Velo (`@carts1024/velo-sdk`) | Checkout sessions for buyer top-ups, signed webhooks to confirm funding, Gas Station to sponsor every Soroban transaction |
| Uses the latest Noir testnet contracts | `device_registry` gives each agent an identity, `agent_registry` enforces each agent's policy on-chain, `payment_escrow` holds prepaid funds, authorizations and claims |
| Registered on velo-build.dev | Pre-hackathon checklist (§17) |

---

## 5. System overview

```
┌ Settl web app (Next.js) ───────────────────────────────────────────────────┐
│  Provider dashboard (hero)           Buyer console (minimal)               │
│  revenue · pending/claimed ·         create agent · policy · top-up        │
│  claim · pass rate · pricing         Velo checkout · revoke                │
│                                                                            │
│  API: /api/velo/webhook · /api/verify · /api/quotes · /api/agents          │
└───────────┬───────────────────────────────────────────┬────────────────────┘
            │                                           │
┌ Postgres ─┴──────────┐          ┌ Stellar testnet ────┴──────────────────┐
│  metering, quotes,   │          │  Noir: device_registry,                │
│  logs, verifications,│          │        agent_registry,                 │
│  policies            │          │        payment_escrow                  │
└──────────────────────┘          │  Velo: Gas Station, checkout           │
                                  └────────────────────────────────────────┘
                                                        │  signed txs
┌ Demo agent ──────────────────────┐      ┌ ResiboAI ───┴──────────────────────────┐
│  LLM bookkeeping agent           │      │  POST /parse-receipt                   │
│  tool: parse_receipt             │ ──▶  │  wrapped by settl-sdk middleware       │
│  settl-client: settlFetch()      │ ◀──  │  402 → verify → result + receipt       │
└──────────────────────────────────┘      └────────────────────────────────────────┘
```

### Components

| Component | Type | Responsibility |
|---|---|---|
| `settl-sdk` | npm package (server) | Middleware: issues 402 quotes, verifies payment, attaches receipts, forwards outcome-mode results to the verifier |
| `settl-client` | npm package (agent side) | `settlFetch()`: parses the 402, checks local policy, signs or submits payment, retries |
| Settl web app | Next.js App Router | Provider dashboard, buyer console, webhook receiver, verifier service, settlement worker |
| Verifier | Service inside the web app | Runs deterministic checks for outcome mode and submits pre-signed authorizations on pass |
| ResiboAI | Demo provider API | Fake receipt OCR with canned, predictable outputs |
| Demo agent | Node script with an LLM | Bookkeeping agent whose `parse_receipt` tool uses `settlFetch`, with a visible reasoning log |

**Stack:** TypeScript, Next.js (App Router), `@carts1024/velo-sdk`, `@stellar/stellar-sdk` (Soroban RPC), Neon Postgres, and AI SDK tool-calling for the demo agent.

---

## 6. Payment modes

### 6.1 Per-call mode (pay, then serve)
The agent pays before the provider does the work. Best for cheap, deterministic calls.

1. The agent sends `POST /parse-receipt` with no payment.
2. The SDK requests a quote from the Settl API, which stores it (nonce, price, expiry), and returns **402** with that quote (§7.1). Providers stay stateless.
3. `settlFetch` checks local policy: provider allowlist, `maxPrice`, daily budget.
4. The agent builds `payment_escrow.authorize(agent, device_hash, merchant, asset, amount, nonce)`, signs it and submits through **Velo Gas Station** (`gas.sponsorAndSubmit`, then `waitForResult`).
5. The agent retries with `X-PAYMENT` set to the payment proof (§7.2).
6. The SDK verifies the proof on-chain: the transaction succeeded, the arguments match the quote, and the nonce hasn't been used. It marks the quote paid and runs the handler.
7. The response includes the result and an `X-PAYMENT-RECEIPT` header.

**Speed option (stretch):** "optimistic" verification serves the response once the transaction *simulates* successfully and confirms in the background. Cheap calls only.

### 6.2 Outcome mode (serve, verify, then pay), the differentiator
The provider does the work, and money moves only if the result passes criteria agreed in the quote.

1. The agent sends a request with no payment, and the SDK returns **402** with `mode: "outcome"` and `criteria`.
2. The agent checks policy and **pre-signs** the Soroban authorization entry for `authorize(...)` without submitting it.
3. The agent retries with `X-PAYMENT` holding the pre-signed authorization.
4. The SDK runs the handler, then posts `{ quoteId, result, preSignedAuth }` to the Settl verifier.
5. The verifier runs the checks (§9):
   - **Pass:** it submits the pre-signed authorization through Gas Station. Money moves to the provider's pending balance in escrow, and the response is released with the receipt.
   - **Fail:** it discards the authorization and returns a **422**-style response with the reasons. The agent pays nothing, and the provider can contest the result (stretch).
6. Who gets the result if it fails: the MVP still returns it to the agent, marked "unverified, not charged". That keeps the demo honest and simple. Withholding it is a stretch option.

**Dependency:** outcome mode requires that someone other than the agent can submit the agent's signed authorization. See Spike S1 (§15). **Fallback:** the verifier returns `pass` to the agent client, which then submits `authorize` itself. That's weaker, because the client could decline to pay, but fine for the demo.

---

## 7. Wire protocol (draft)

> To align with Noir's or Velo's x402 conventions if either defines a canonical 402 body. Otherwise this is Settl's own format, modeled on x402.

### 7.1 `402 Payment Required` body
```json
{
  "settl": "0.1",
  "quoteId": "q_01JC...",
  "mode": "outcome",
  "network": "stellar:testnet",
  "asset": "<escrow token contract id>",
  "amount": "2.0000000",
  "displayPrice": { "currency": "PHP", "amount": "2.00" },
  "merchant": "G...PROVIDER_WALLET",
  "escrowContract": "CA5S4S7QGHJHJWVJBYL3CXZXZTNGKXMNZVDAEQNN7NUXFP4D7BYK7HIX",
  "nonce": "184467",
  "expiresAt": "2026-11-06T10:05:00Z",
  "resource": "POST /parse-receipt",
  "description": "Parse one receipt image into structured JSON",
  "criteria": {
    "schema": "resibo.receipt.v1",
    "required": ["merchant_name", "date", "total", "line_items"],
    "minConfidence": 0.85,
    "lineItemsSumToTotal": { "tolerance": 0.01 }
  },
  "verifier": "https://settl.ai/api/verify"
}
```

### 7.2 `X-PAYMENT` header (base64 JSON)
```json
// per-call
{ "quoteId": "q_...", "kind": "tx", "txHash": "abc123...", "agent": "G...AGENT", "deviceHash": "…" }
// outcome
{ "quoteId": "q_...", "kind": "auth", "authEntryXdr": "AAAA...", "agent": "G...AGENT", "deviceHash": "…" }
```

### 7.3 `X-PAYMENT-RECEIPT` header
```json
{ "quoteId": "q_...", "status": "paid", "txHash": "...", "amount": "2.0000000",
  "verified": true, "remainingBudget": "48.0000000" }
```

### 7.4 Provider integration (developer experience target)
```ts
import { settl } from "settl-sdk";

app.post("/parse-receipt",
  settl({ price: "2.00", currency: "PHP", mode: "outcome", criteria: "resibo.receipt.v1" }),
  parseReceiptHandler
);
```

### 7.5 Agent integration
```ts
import { settlFetch } from "settl-client";

const res = await settlFetch("https://resibo.demo/parse-receipt", {
  method: "POST", body: image,
  wallet: agentKeypair, deviceHash, maxPrice: "5.00"
});
```

---

## 8. Noir and Velo mapping

### 8.1 Concept mapping
Noir models spenders as **devices**. Settl treats each **AI agent** as a device.

| Noir concept | Settl meaning |
|---|---|
| `wallet` (owner) | Buyer organization's Stellar wallet |
| `device_hash` | `sha256("settl:agent:" + agentId)` |
| `agent` (address) | The AI agent's own Stellar keypair |
| `merchant` | Provider's payout wallet |
| `AgentPolicy { max_amount, asset, expires_at }` | On-chain hard limits for the agent |
| Escrow balance for each device | The agent's prepaid budget |
| Pending payments for each merchant | The provider's earned, unclaimed revenue |

### 8.2 Testnet contract IDs ("latest Noir Testnet contracts" from the hackathon registration form, 2026-11-03)
- `device_registry`: `CB4DPMGOA374JIB2ZVD4AHW5GJKQUYNOFGRYNOJ75EFH2KCJSMHOWIRA`
- `agent_registry`: `CBTDMJVCFQDIVWZBKAKZ2FQ3UEJNAAUFYCTJ3E4ON2MYXPLPSIXQ25JZ`
- `payment_escrow`: `CA5S4S7QGHJHJWVJBYL3CXZXZTNGKXMNZVDAEQNN7NUXFP4D7BYK7HIX`

These replace the IDs in the Noir README (redeployed 2026-10-24), which are now outdated. They were transcribed from a screenshot, so copy them from the form at kickoff.

### 8.3 Call sequences

**Create agent (buyer console)**
1. Generate the agent keypair and compute `device_hash`.
2. `device_registry.register(org_wallet, device_hash, agent)`
3. `agent_registry.register_agent(org_wallet, device_hash, agent, max_amount, asset, expires_at)`

**Top up the agent budget**
1. `velo.checkout.sessions.create({ amount, asset, description, successUrl, cancelUrl })` returns `checkoutUrl`. The buyer pays there.
2. Velo webhook to `/api/velo/webhook`. Check it with `Velo.webhooks.verify(...)` and confirm through `paymentIntents.retrieve`.
3. The settlement worker calls `payment_escrow.fund_escrow(token, org_wallet, device_hash, amount)`.
4. **Hackathon simplification:** org wallets are custodial testnet keypairs managed by Settl, so the server can sign `fund_escrow` after the checkout confirms. A non-custodial version would use `@carts1024/velo-wallets` to let the buyer sign. See Open Question Q3.

**Pay (per-call):** `payment_escrow.authorize(...)`, signed by the agent and submitted through Gas Station.
**Pay (outcome):** the same call, pre-signed by the agent and submitted by the verifier on pass.
**Claim (provider dashboard):** `payment_escrow.claim(token, merchant)`, signed by the provider wallet.
**Read state:** `balance_of(device_hash)`, `pending_balance(merchant)`, `agent_registry.get_policy(device_hash)`, `escrow_token()`.

**Revoke an agent (safe order, per Noir docs)**
1. `agent_registry.revoke_agent(...)`
2. `payment_escrow.sweep_on_revoke(token, device_hash, agent)`. This returns the leftover budget to the owner.
3. `device_registry.revoke(...)`, only after the escrow balance is 0. Revoking first breaks the refund lookup.

### 8.4 Velo usage summary
| Velo feature | Used for |
|---|---|
| `checkout.sessions.create` / `paymentIntents.retrieve` | Buyer top-ups |
| `Velo.webhooks.verify` | Trusting top-up confirmations |
| `gas.sponsor` / `sponsorAndSubmit` / `waitForResult` | Fee-less agent payments, verifier submissions, claims |
| Idempotency keys and correlation IDs | Linking quote, payment and receipt; safe retries |

---

## 9. Verifier (outcome mode)

### 9.1 Principles
- **Terms first:** the criteria travel inside the 402 quote, so both sides see them before any work.
- **Deterministic in the MVP:** no LLM judge on stage. Every check is reproducible.
- **Neutral:** the verifier is run by Settl, not by the buyer or the provider.
- **Explainable:** every fail lists the exact check that failed.

### 9.2 Check set for `resibo.receipt.v1`
| Check | Pass condition |
|---|---|
| Schema | Output validates against the receipt JSON schema |
| Required fields | `merchant_name`, `date`, `total` and `line_items` are present and non-empty |
| Confidence | `confidence ≥ minConfidence` (0.85) |
| Arithmetic | The sum of `line_items[].amount` equals `total` within the tolerance |
| Date sanity | `date` parses and isn't in the future |

### 9.3 Results
- `pass`: submit the authorization and the provider is paid.
- `fail`: discard the authorization and store the reasons. It counts against the provider's pass rate.
- `error` (verifier fault): the agent isn't charged and the event is flagged for review.

### 9.4 Stretch
- An LLM judge for fuzzy criteria ("Is the summary faithful to the source?")
- A provider "contest" flow leading to a human review queue, filling the dispute gap in Noir
- Criteria templates for other services: translation, geocoding, lead enrichment

---

## 10. Policy model

| Layer | Rule | Enforced by |
|---|---|---|
| On-chain | Spend cap (`max_amount`; per payment or lifetime, see Spike S2) | `agent_registry.check_payment` inside `authorize` |
| On-chain | Allowed asset | `agent_registry` |
| On-chain | Expiry (`expires_at`) | `agent_registry` |
| On-chain | Budget can't exceed funded balance | `payment_escrow` |
| On-chain | Replay protection (nonce) | `payment_escrow` |
| Off-chain | Provider allowlist | `settl-client` and Settl API |
| Off-chain | Max price per call | `settl-client` |
| Off-chain | Daily budget | Settl API (metering) |
| Off-chain (stretch) | Human approval above a threshold | Settl API sends a notification and holds the request |

**Pitch point:** even if the agent's code is compromised, the on-chain caps still hold.

---

## 11. Data model (Neon Postgres, draft)

| Table | Key fields |
|---|---|
| `orgs` | id, name, role (`buyer` / `provider`), wallet_public, wallet_secret_enc (testnet custodial) |
| `agents` | id, org_id, agent_public, agent_secret_enc, device_hash, status, created_at |
| `policies` | agent_id, max_amount, asset, expires_at, daily_budget, max_price_per_call, allowlist (provider ids) |
| `providers` | id, org_id, merchant_wallet, display_name |
| `endpoints` | id, provider_id, route, price, currency, mode, criteria_id |
| `quotes` | id, endpoint_id, agent_id, nonce, amount, mode, criteria, status (`issued`/`paid`/`verified`/`failed`/`expired`), expires_at |
| `payments` | id, quote_id, kind (`tx`/`auth`), tx_hash, status, submitted_at, confirmed_at |
| `verifications` | id, quote_id, result (`pass`/`fail`/`error`), reasons (json), checked_at |
| `topups` | id, agent_id, velo_payment_intent_id, amount, status, fund_tx_hash |
| `claims` | id, provider_id, amount, tx_hash, claimed_at |
| `webhook_events` | id, source, event_id, payload, verified, processed_at (idempotency) |

Nonce allocation: one sequence per (device, agent). The client sends payments one at a time per agent to avoid nonce races (see Q4).

---

## 12. Screens

### Provider dashboard (hero)
- **Overview:** revenue today and all time, calls, pass rate, and a live feed of paid calls
- **Earnings:** pending (`pending_balance`) vs claimed, a **Claim** button and claim history with tx links
- **Endpoints:** price, mode (per-call / outcome), criteria, and an SDK snippet to copy
- **Quality:** verifier pass/fail breakdown by check (e.g. "12% failed the arithmetic check")
- **Customers:** revenue by buyer org and by agent

### Buyer console (minimal)
- **Agents:** create, view balance, view policy, revoke (in the safe order)
- **Top up:** amount, then Velo checkout, then the balance updates after the webhook
- **Policy:** cap, expiry, allowlist, max price per call, daily budget
- **Activity:** each payment: provider, amount, verified or not, tx link

### Demo agent console
- A terminal or web log showing the agent's reasoning: *"Need to parse receipt 17. ResiboAI quotes ₱2, outcome mode. Within budget (₱48 left) and on the allowlist. Paying."*

---

## 13. Demo script (about 3 minutes)

1. **Setup (20s):** "Juan's firm has a bookkeeping agent with a ₱50 budget, capped on-chain. ResiboAI is a 2-person startup that added Settl in 5 lines."
2. **Happy path (40s):** the agent processes a clean receipt and gets a 402 quote for ₱2 in outcome mode. It pays, the verifier passes the result, and ResiboAI's dashboard ticks to +₱2 live, with a tx link.
3. **Bad result (30s):** the agent sends a blurry receipt. ResiboAI returns low confidence and totals that don't add up, so the verifier fails it. **₱0 charged**, and the reason is shown on both dashboards.
4. **Guardrail (30s):** the agent tries an endpoint that costs more than its cap. `check_payment` rejects it on-chain, and the policy holds even though the agent "wanted" to pay.
5. **Top-up (20s):** the buyer tops up through Velo checkout. The webhook arrives and the escrow balance updates.
6. **Claim (20s):** ResiboAI clicks Claim, one transaction runs and the money lands in its wallet.
7. **Close (20s):** "Any startup can sell to agents from day one, and only get paid for real results. Agents paying agents, settled on Stellar."

**Backup:** record the whole demo video on Nov 7 in case testnet or Wi-Fi fails on stage.

---

## 14. Trust model and known limitations

| Limitation | Impact | MVP handling | Future fix |
|---|---|---|---|
| The owner can `defund_escrow` at any time | No hard guarantee for the provider in outcome mode | Show `balance_of` as visible solvency; track buyer reputation | A lock contract that holds committed funds for each quote |
| Noir doesn't restrict the merchant | An agent could pay any merchant | Off-chain allowlist in the client and API | A policy wrapper contract with an on-chain allowlist |
| Noir has no dispute function | Contested results have no on-chain path | The verifier is the decider; a contest queue is a stretch goal | An arbitration contract |
| Custodial org wallets | Not production-grade | Testnet only, clearly labeled | Non-custodial through Velo wallets |
| Roughly 5s ledger close | Per-call latency | Outcome or optimistic modes; batching is a stretch goal | Payment channels or batched settlement |
| Velo and Noir are alpha, testnet-only | No real money yet | Hackathon scope | Mainnet once Velo settlement ships, plus Velo's PH provider rails for PHP cash-out |
| Verifier centralization | Both sides trust Settl | Deterministic, explainable checks | Multiple verifiers, or on-chain attestations |

---

## 15. Technical spikes (day 1, before building on assumptions)

| # | Question | Why it matters | Fallback |
|---|---|---|---|
| S1 | Can a third party submit a transaction carrying the agent's signed authorization for `authorize`? | Outcome mode depends on it | The agent client submits after a verifier pass |
| S2 | Is `max_amount` a cap per payment or a lifetime total? | Console labels and guardrail demo | Label it accordingly and add an off-chain total |
| S3 | Does Velo Gas Station sponsor Soroban contract invocations, not only classic operations? | Fee-less UX | Fund agents with a little testnet XLM through Friendbot |
| S4 | Which token is `escrow_token()` on testnet (XLM SAC, test USDC, other)? | Pricing and top-ups | Price in that token and show PHP as display only |
| S5 | Does `fund_escrow` require the device owner's signature, or can anyone fund? | Top-up flow design | Custodial org wallet signs (current plan) |
| S6 | Nonce rules: strictly increasing, or just unique? | Concurrency and quote design | Send payments one at a time per agent |
| S7 | Where does a Velo checkout payment settle (destination and asset)? | Bridging checkout to `fund_escrow` | A treasury wallet forwards to the org wallet |

---

## 16. Scope

### MVP (must ship)
- `settl-sdk` middleware with per-call and outcome modes
- `settl-client` (`settlFetch`) with allowlist and max-price checks
- ResiboAI demo API (canned clean and blurry outputs)
- Deterministic verifier for `resibo.receipt.v1`
- Provider dashboard: overview, earnings plus Claim, quality
- Buyer console: create agent, set policy, Velo top-up, revoke
- Demo agent with a visible reasoning log
- Full flow on Stellar testnet with the latest Noir contracts

### Stretch (in order)
1. Optimistic verification for per-call mode
2. Human spend approval: a phone-sized web page opened from a notification ("Juan's Bookkeeper wants to pay ₱12 to GeoPH. Approve?"), used for the on-stage approval moment
3. Provider contest and review queue
4. LLM judge criteria
5. Lock contract for committed outcome-mode funds
6. Agent-to-agent demo: ResiboAI's own agent buys translation through Settl

### Cut order if behind
Daily budget, then pricing editor, then buyer console polish, then the quality page. **Never cut:** 402 → pay → verify → claim.

---

## 17. Timeline

| When | Goal |
|---|---|
| **Nov 3–4** | Register: Google form (closes Nov 4, 11:59 PM Manila), velo-build.dev project, star the Velo and Noir repos, follow the required X accounts, upload screenshots. Read the contract source for S1–S7. **No product code before kickoff** (check the rules). |
| **Thu Nov 5** | Kickoff. Run spikes S1–S7 on testnet. Scaffold the monorepo. End-to-end per-call payment: SDK, client and ResiboAI. |
| **Fri Nov 6** | Buyer console: agent creation, policy, Velo top-up through webhook to `fund_escrow`. Demo agent with the LLM and reasoning log. |
| **Sat Nov 7** | Outcome mode and verifier. Provider dashboard with Claim. Record the backup demo video. |
| **Sun Nov 8, before 8:00 AM** | Polish, README, architecture diagram, rehearse, submit. 11:00 AM top 10 announced, 1:00 PM pitch. |

---

## 18. Business model (for the pitch)
- **Per-call mode:** 1% fee on settled volume.
- **Outcome mode:** a small fee per verification (the verifier is the value).
- **Later:** hosted criteria templates, verifier SLAs, and PH fiat cash-out through Velo's provider rails once live.

---

## 19. Decisions

| # | Question | Decision |
|---|---|---|
| D1 | Product name | **Settl.ai** (short form "Settl"). Check the settl.ai domain and @settl_ai handle before launch. |
| D2 | Platform | **Responsive web app**, desktop-first. Providers and buyers are developers and finance or ops staff who work at a desk, and judges open a link with nothing to install. |
| D3 | Demo agent LLM | Set by the `AGENT_MODEL` env var; any AI SDK provider you have a key for. |
| D4 | Org wallets | Custodial testnet keypairs for the MVP (labelled as testnet only). |
| D5 | Concurrency | One payment at a time per agent. |
| D6 | Hosting | Vercel (web app and ResiboAI) with Neon Postgres. |
| D7 | Demo provider | Fake ResiboAI receipt-OCR API with canned outputs. |
| D8 | Team and hero side | Solo. Provider side leads the pitch. |
| D9 | Verifier | Deterministic checks in the MVP; LLM judge is a stretch goal. |
