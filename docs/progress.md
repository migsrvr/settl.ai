# Settl.ai progress

Snapshot: **November 5, 2026**. This report separates implemented local work from planned integration and live verification.

## Product and delivery commitment

Settl.ai is an API and MCP payment gateway for startups to charge AI agents for API and service usage. Buyers fund prepaid agent budgets; Settl checks spending rules and coordinates payments through Noir and Velo on Stellar testnet.

The API/MCP is the core product. The **November 8 demo still includes fully live provider and buyer dashboards, approvals, top-ups, claims, automations, and an end-to-end agent run**. No live features were cut or deferred by the November 5 product clarification. Existing demo screens are work already completed toward that goal, not evidence of completed backend integration.

## What has been built

| Area | Implemented work | Current boundary |
|---|---|---|
| Workspace | npm monorepo, shared TypeScript configuration, Vitest, web lint, and production build scripts. | Run commands from the repository root. |
| Web UI | Landing, demo sign-in and route guards, provider overview/earnings/endpoints, buyer agents/create/detail/approval screens, and stage view. | Uses hardcoded demo data and local flow state; live payment/API wiring remains pending. |
| Core protocol | Quote, payment header, criteria and receipt schemas; header encoding; XLM/stroop and peso display helpers. | Shared protocol foundations, not a running gateway. |
| Verifier | Deterministic receipt checks for fields/schema, confidence, arithmetic, and date sanity. | Local verification logic; outcome settlement integration is pending. |
| Backend rules | Spending policy, nonce helper, reservation state machine, webhook signing/verification, and effect planning. | Pure tested logic with no database or network integration. |
| Chain adapter | Device and agent registration; policy, balance and token reads; escrow funding; authorize; claim; safe revoke/sweep; transaction proof decoding. | Implemented and tested locally; no confirmed live contract cycle yet. |
| Fee handling | Velo Gas Station submission and identity-only recovery, pending-result handling, and relayer fee bumps after explicit whitelist denial. | Mocked network tests pass; live sponsorship eligibility remains unknown. |
| Testnet harness | Opt-in lifecycle suite with generated Friendbot-funded wallets, plus a checkout destination spike. | Prepared, but the recorded live gate has not passed. |

Tests were written before the chain adapter implementation. No application API or MCP availability should be inferred from the implemented package methods.

## Verification record

The latest full repository check completed on **November 5**, after the documentation refresh, using Node **24.22.1**. It reproduced the successful November 4 adapter validation:

```sh
npm test && npm run typecheck && npm run lint && npm run build
```

| Workspace | Offline tests passed |
|---|---:|
| Web | 30 |
| Core | 10 |
| Stellar adapter | 48 |
| Verifier | 7 |
| **Total** | **95** |

Typecheck, lint, and production build also passed. The adapter tests include actual Noir call encoding with Stellar SDK 17, source signatures, sponsorship identity checks, pending reconciliation, Soroban resource-fee accounting, safe revocation ordering, and fee-bump transaction decoding.

During the November 4 adapter work, an initial Turbopack worker-port/cache problem was resolved before implementation. An environment restart interrupted an intermediate validation session; the complete final check was subsequently rerun successfully. The November 5 documentation check also passed the full command. These are offline results, not proof of live settlement.

Documentation validation also passed: 37 local links and heading anchors resolve, all six documented MCP tool names match the backend design, and the documented environment keys exist in `.env.example`. This update changes documentation only; application code, dependencies, and credentials were preserved.

## Compatibility decisions already made

- Dependencies: Noir agent SDK **0.3.0**, Stellar SDK **17.0.0**, and Velo SDK **0.1.0-alpha.4**, installed through its `alpha` tag.
- The user approved a Noir-scoped npm peer override to SDK 17. Noir's encoder and read methods are reused; preparation, signing, and submission use SDK 17's renamed XDR APIs. No third-party source or globals were patched.
- Noir's packaged contract defaults differ from the hackathon IDs. The adapter receives explicit IDs from the template configuration.
- Amounts inside the chain adapter are bigint stroops. `PENDING` is unresolved and must be reconciled before another write; it is not permission to send a replacement payment.
- Per-source serialization exists within a client instance. Persistent pending state and the broker's database lock remain future work.

See the [adapter guide](../packages/stellar/README.md) and [spikes](spikes.md) for implementation details and evidence boundaries.

## What remains to build

The agreed order in [HANDOFF.md](../HANDOFF.md) is retained:

| Step | Remaining delivery |
|---|---|
| 1. Live chain gate | Confirm a real testnet authorization and record the Gas Station and checkout findings. |
| 2. Persistence | Prisma/Neon schema, encrypted custodial wallets, agent API keys, settings, reservations, approvals, webhook storage, and demo seed. |
| 3. Broker and REST | Shared quote/policy/payment/provider-call engine, serialized nonces, receipts, agent-call API, provider payment verification, and provider SDK. |
| 4. Demo providers | ResiboAI clean/blurry/wrong-total outputs, an over-cap Pro endpoint, and a service for the approval demo. |
| 5. Hosted MCP | Authenticated `/mcp` transport and the six agreed service, budget, quote, call, approval, and receipt tools. |
| 6. Demo agent | AI SDK agent using hosted MCP to purchase services within policy. |
| 7. Settl on Result | Reserve, serve, verify, authorize only on pass, and release without charge on failure. |
| 8. Automations | Webhook delivery/retries, provider auto-claim, low-budget alerts, and resolved spend approvals. |
| 9. Top-up | Velo checkout, signed webhook verification, deduplication, and treasury-to-escrow funding. |
| 10. Live UI | Connect existing provider/buyer screens and stage view to real backend data while retaining the scripted stage fallback. |

REST endpoints, MCP tools, and the provider SDK described in the [root README](../README.md) are planned integration interfaces. Their implementation has not started.

## Blockers and next gate

The last recorded environment setup copied `.env.example` to the ignored `apps/web/.env.local` with empty credential fields. The chain work stopped pending `VELO_GAS_API_KEY` and `VELO_API_KEY`; this documentation task does not change or inspect their values.

The next implementation action remains:

```sh
npm run test:testnet -w @settl/stellar
```

Run it only after the two Velo keys are configured. It does not require `DATABASE_URL`. The database step will need its own configuration later.

**No testnet transaction hashes are recorded.** The following remain unverified:

- A real `authorize` against the configured hackathon contracts and the resulting escrow/pending balance changes.
- Whether Gas Station allows the project's `payment_escrow` invocation or returns `contract_not_whitelisted`.
- This project's checkout `receiverAddress`, its ownership, and actual checkout settlement. Routing details alone do not prove funds arrived.

Record live results in [docs/spikes.md](spikes.md). Keep the existing checkpoint: summarize the verified hashes and blockers, then wait for the user before advancing to step 2. The full live demo is still targeted for **Sunday, November 8, 2026, before 8:00 AM Manila time**.
