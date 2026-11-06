# Settl chain adapter spikes

Updated 2026-11-05. **Step 1 gate passed**, reported by Gemini's verification
session on Nov 5 at 20:57 (Asia/Singapore). A real `authorize` succeeded on
Stellar testnet. Codex recorded the supplied evidence without rerunning the suite.

## Verified testnet run (Gemini report)

Command: `npm run test:testnet -w @settl/stellar`. All listed operations returned
`SUCCESS` against Stellar testnet (`Test SDF Network ; September 2015`).

| Operation | Transaction hash |
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
Contract IDs match the Builder Handbook's 2026-10-24 redeployment in `.env.example`:
device `CAC4KOLHDLDYDWBOKXNKRN5KVHO56PLOIFXDLTBUWGVN6GVDEB7FQHU5`,
agent `CCMZDSPTLX7IIJWCYEUM5DJUHOSOYSTHGK777S2TXZWEMC5ZZGPJ3EBV`,
escrow `CC7EAW5FNJEDBS7THM5IT6XIOHO4AOYMLXT3KSZ3HWUIKEACTW7E5BFS`.
Gas Station previously refused with `policy_disabled`; the adapter now permits
the configured relayer for that code and `contract_not_whitelisted`, retaining
the actual reason through reconciliation. The report does not include per-operation
transport, fees, account identities, or balance deltas; those are not inferred here.

Checkout route creation/retrieval succeeded: PaymentIntent
`jx78vwa1e5q82w37pdhw87k0v58hmxzt`, receiver
`GAHJPWGSD6KIJMB2ER5RIY7FCKUK7RGJALPVWQ4ZILKVVROW42G7G3E3`.
Receiver ownership, memo, paid status and payment hash were not supplied. This
establishes the returned route, not a completed checkout payment.

## Remaining live checks

| Check | Current evidence | Decision / next action |
|---|---|---|
| Real `authorize` on the hackathon contracts | Passed in Gemini's Nov 5 live suite; hash above. | Step 1 accepted and Phase 2 authorized by the operator's delegation brief. |
| Gas Station allows `payment_escrow` | Earlier live request refused with `policy_disabled`; the full cycle subsequently passed. | Do not assume Velo sponsorship is enabled. Only explicit `contract_not_whitelisted` and `policy_disabled` refusals permit relayer fallback. |
| Velo checkout destination (`receiverAddress`) | Returned receiver recorded above. | Confirm wallet ownership before integrating the treasury funding path. |
| Checkout payment actually settles | Not run. The public SDK exposes creation/retrieval, while hosted checkout separately reports a wallet submission to Velo's scanner. | Complete the returned hosted checkout, observe `paid`, and record the payment hash and actual ledger destination. A routing response is not settlement evidence. |

The opt-in suite stops before network writes if either Velo key is absent.
`DATABASE_URL` is unnecessary for this step. Generated testnet signer secrets
remain in memory; never copy them or signed envelopes into evidence records.

## Verified locally

- Exact versions installed: `@noirx402/agent-sdk@0.3.0`,
  `@stellar/stellar-sdk@17.0.0`, `@carts1024/velo-sdk@0.1.0-alpha.4` via `@alpha`.
- Noir declares Stellar SDK `^16.0.1` as a peer. The user selected a Noir-scoped
  override to SDK 17. Its real `toCall` encoder works with SDK 17, but the
  original `prepare` fails with `(intermediate value).toXDR is not a function`.
  The adapter therefore reuses Noir's encoder and reads, and overrides preparation
  using SDK 17's `toXdr`. Signing, decoding and fee bumps use SDK 17 directly.
- Noir requires Node `^22.23.4 || ^24.22.1 || >=26.12.1`; checks use task-local
  Node 24.22.1 rather than changing the system Node installation.
- Noir SDK's bundled testnet contract IDs differ from `.env.example`. The
  adapter always receives the explicit hackathon IDs. The Nov 5 live cycle
  passed using the redeployed contracts.
- 52 adapter tests cover real contract encoding, source signatures, fee-bump
  decoding and resource-fee accounting, sponsorship identity checks, refusal
  handling, pending recovery, and safe revocation ordering.
  They do not establish that any live contract or Gas policy accepts a call.

## Evidence record for the live run

Record UTC timestamp, SDK versions, RPC network/passphrase, contract IDs, device
hash and public accounts, then each operation's status, inner hash, outer hash,
fee evidence and sponsorship transport/refusal. Verify `authorize` through RPC
and balance deltas. For checkout, record PaymentIntent ID, receiver address,
memo, asset, amount, `paid` status and payment transaction hash separately.

## Source references

- Installed Noir SDK: `dist/client.js`, `dist/networks.js`, `package.json`.
- Installed Stellar SDK 17: transaction/XDR types and fee-bump builder.
- [Velo Gas Station](https://github.com/Velo-Ecosystem-Collection/Velo/blob/main/docs/velo-gas-station.md): only `succeeded` confirms execution; uncertain submissions recover by identity.
- [Velo SDK payment routing](https://github.com/Velo-Ecosystem-Collection/Velo/blob/main/packages/velo-sdk/README.md#payment-routing): `receiverAddress` is the destination wallet; the project's actual receiver requires a live retrieval.
- [Velo hosted checkout](https://github.com/Velo-Ecosystem-Collection/Velo/blob/main/apps/web/features/checkout/checkout-client.tsx): wallet submission and backend scanner confirmation are separate from creating a session.

## Validation

The original baseline passed 47 tests, typecheck, lint and build before adapter
implementation. A cached Turbopack local-port failure cleared after preserving
the generated `.next` cache in `/tmp` and rebuilding with worker-port access.
Historical repository validation passed using task-local Node 24.22.1:
`npm test && npm run typecheck && npm run lint && npm run build`.
All 95 offline tests passed (48 adapter tests plus the original 47). The production
build completed successfully. The environment restart interrupted an earlier
check session; the complete final command was rerun successfully. Live
verification was subsequently completed by Gemini on Nov 5: 99 offline tests
(30 web, 10 core, 52 stellar, 7 verifier), typecheck, lint and production build all
passed, as did the live suite above. Phase 2 changes require fresh verification;
the operator assigned migrations, tests, lint and build to Gemini.
