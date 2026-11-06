# Settl.ai pitch and recording guide

This accompanies the editable deck, not a recording. Main slides use the app's paper/ink palette with restrained status colors. All narration and source notes are editable in the PPTX. Appendix slides are hidden during a normal slide show.

## Five-minute pitch

| Slide | Seconds | Speaking goal |
| --- | ---: | --- |
| 1. Settl.ai | 15 | Agents buy needed APIs while their company controls spend. Introduce Miggy Rivera. |
| 2. The purchase between agent and API | 25 | Explain the buyer's spending-control problem and the seller's payment-record problem. |
| 3. Settl connects the purchase | 25 | Provider prices an API; buyer sets rules; existing agent uses MCP. |
| 4. A budget the agent must respect | 30 | Explain PHP 2 allowed usage, PHP 15 refusal and PHP 8 approval with the example policy. |
| 5. Live demo | 90 | Show the external agent request a paid API call and inspect the returned evidence, then a refusal. |
| 6. Noir and Velo | 40 | Identify the real contract/SDK paths and the separate checkout-to-treasury-to-escrow flow. |
| 7. First users and business model | 35 | Target API providers/agent operators; label transaction fees/hosted plans as hypotheses. |
| 8. Next purchase and pilot ask | 40 | Ask API builders and agent teams to try a testnet pilot. Show live/repo links. |
| **Total** | **300** | **Five minutes, including the demo** |

Appendix 9 covers implementation boundaries. Appendix 10 supplies evidence links for Q&A. No market size, production revenue, customer traction or proven production readiness is claimed.

## Demo preparation

Use [the current provider-to-Codex runbook](../CODEX_MCP_LIVE_DEMO.md). Prepare a known active agent, reachable hosted provider, valid scoped bearer key, enough available escrow and remaining daily headroom. Open the buyer page and terminal before speaking. Keep API keys, wallet secrets and environment files off screen.

The external agent first reads budget and discovers services. Request **one** clean Receipt OCR invocation at PHP 2, with `maxPricePhp: "10.00"`. Show the actual result status, receipt and transaction link. Request Pro at PHP 15 with the same maximum and show `declined / over_max_price`. This refusal is off-chain. If rehearsed within the time, demonstrate the PHP 8 GeoPH human approval and resume precisely that approval ID once.

For per-call services, blurry fixture data and provider errors can still carry a confirmed usage fee. The business expense in the fixture is separate from that API fee. Optional outcome mode can fail its checks without charging, but the default OCR product no longer demonstrates that behavior.

Do not retry a paid, pending or unknown request. Describe an unresolved result honestly and switch to a clearly identified recording or historical receipt. `/stage` is a scripted fallback. This guide authorizes no new payment by itself.

## Two-minute recording storyboard

| Time | Screen and action |
| --- | --- |
| 0:00-0:15 | State the buyer/provider problem and show the live site. |
| 0:15-0:35 | Show provider per-call pricing and the buyer's capped agent budget. |
| 0:35-1:10 | In the connected external agent, read budget/discover services, request one PHP 2 call and show its observed status. |
| 1:10-1:35 | Show the receipt and complete Stellar Expert link. If pending, do not label it paid or replay it. |
| 1:35-1:50 | Show the PHP 15 refusal against a PHP 10 maximum. |
| 1:50-2:00 | Close on Noir/Velo roles and the live/public-repo URLs. |

The user has not recorded the video yet. Add its actual URL to the root README only after upload.

## Q&A preparation

- **Who decides?** The external agent chooses and requests a service; the broker enforces buyer rules and signs with its stored constrained agent identity.
- **What is on-chain?** Device registration, asset/cap/expiry policy, escrow authorization and claims. Provider allowlist, daily budget, approval workflow and outcome reservations are application rules.
- **Who receives funds?** Authorization credits the provider's pending escrow balance. Claim transfers it to the provider wallet.
- **What does Velo do?** Checkout sessions, remote payment status, signed callbacks and eligible gas sponsorship requests. A signed paid callback triggers a separate treasury funding operation after validation.
- **What is simulated?** ResiboAI/GeoPH output fixtures and the scripted stage view. Historical chain records and deployed dashboard captures are labelled separately.
- **What remains?** Original hosted top-up reconciliation, operator recovery tooling, production authentication/custody and real provider/customer validation.
