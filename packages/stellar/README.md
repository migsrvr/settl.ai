# @settl/stellar

Server-side, native-XLM adapter for the Noir contracts on Stellar testnet.

Use a Node release supported by Noir SDK 0.3.0: `^22.23.4 || ^24.22.1 || >=26.12.1`.
Development checks use Node 24.22.1. Run commands from the repository root:

```sh
npm install
npm test -w @settl/stellar
npm run typecheck -w @settl/stellar
npm run test:testnet -w @settl/stellar
```

Default tests use mocked network boundaries and never load local credentials.
The opt-in testnet suite explicitly loads `apps/web/.env.local`, created from
`.env.example`. It requires both `VELO_GAS_API_KEY` and `VELO_API_KEY` before any
network writes. It does not need `DATABASE_URL` or `SETTL_TREASURY_SECRET`.
Wallets used by the suite are generated in memory and funded by Friendbot.

## Usage

```ts
import { createStellarClient, loadStellarConfig, TESTNET_XLM } from "@settl/stellar";

// Outside Next.js, load this explicitly from the repo root.
process.loadEnvFile("apps/web/.env.local");
const client = createStellarClient(loadStellarConfig(), { relayer });
const result = await client.authorize(agentKeypair, {
  agent: agentKeypair.publicKey(), deviceHash, merchant: merchantPublicKey,
  asset: TESTNET_XLM, amount: 2_000_000n, nonce: 1n,
});
```

`relayer`, `agentKeypair`, device and merchant identifiers come from the caller.
The relayer is a funded testnet Keypair. It is used only after an explicit Velo
`contract_not_whitelisted` or `policy_disabled` denial. The original refusal code
is preserved in `sponsorshipError`, including during pending reconciliation.
Without a relayer, the denial remains a failed result.
Reads need no Velo key. Writes require the separate Gas Station key.

## Compatibility boundary

Noir SDK 0.3.0 declares Stellar SDK 16 as a peer. The root npm override is scoped
to Noir and pins its peer to Stellar SDK 17.0.0. Noir's `toCall` encoder and
read methods are reused. Its high-level envelope methods use removed
`toXDR`/`fromXDR` names, so `PreparedNoirClient` overrides preparation with
SDK 17's `toXdr`; the adapter signs and submits using SDK 17. No globals or
third-party files are patched. Contract IDs must be passed explicitly because
Noir's packaged defaults differ from the hackathon IDs in `.env.example`.

## Transaction results and recovery

- Only `SUCCESS` is a confirmed payment. `FAILED` is a terminal non-success.
  `PENDING` means the result is unresolved, including observer timeouts.
- `hash` is the outer fee-bump hash when available; `innerHash` identifies the
  signed invocation. Preserve both, the transport, and Velo recovery identity.
- `GasSubmitter.reconcile(result)` observes an existing operation without
  submitting. `client.reconcilePending(publicKey)` also releases the client's
  account guard after a terminal result. A missing reservation identity may
  leave an operation pending until RPC has final evidence; do not rebuild it.
- The client serializes writes per source account within one client instance.
  Reuse that instance. A future broker must additionally hold its database lock,
  persist pending results, and reconcile them across restarts. This package does
  not allocate nonces or provide a distributed lock.
- Use `revokeAndSweep` for lifecycle removal. It stops on pending or failed
  transactions and confirms zero balance before revoking the device.
- `escrowToken(deviceHash)` returns null before first funding. Policy expiry is
  Unix seconds (`0n` means no expiry); all amounts are bigint stroops.
- `readAuthorizeTx(hash)` verifies successful ledger execution, the escrow
  contract, method and argument types, including fee bumps. The broker must
  separately match those arguments to a quote and prevent proof reuse.

## Live evidence

The testnet suite logs public IDs and transaction results, never secrets or
signed envelopes. Copy verified results to `docs/spikes.md` after a live run.
The checkout spike records the live PaymentIntent destination and checkout URL.
Completing hosted checkout and observing Velo's scanner-confirmed `paid` status
is a separate live check; merely receiving an address does not prove settlement.
