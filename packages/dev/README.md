# @settl/dev

A local Settl gateway with fake money. It runs the real broker, spending policy, approvals and MCP tools on an in-process Postgres (PGlite) and an in-memory ledger, so you can build a provider or an agent without Neon, Velo, Stellar wallets or accounts.

```sh
npm run sandbox -- [options]     # from the repo root; once published: npx settl-dev
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--port <n>` | 4000 | Gateway port. |
| `--provider-url <url>` | `http://localhost:3001` | Origin the three demo services point at. |
| `--balance <php>` | 100 | Fake escrow for the demo agent, in pesos. |
| `--auto-approve` | off | Let the agent spend its daily budget without a human. |
| `--provider-key <key>` | `sandbox_provider_key` | Credential providers send. |
| `--agent-key <key>` | `stl_agent_sandbox_demo` | Demo agent bearer key. |

It prints the gateway URL, keys and paste-ready Claude Code and Codex MCP config. Data lives in memory and resets when you stop it.

## From code

```ts
import { startSandbox } from "@settl/dev";

const sandbox = await startSandbox({ port: 0 });
// sandbox.url, sandbox.mcpUrl, sandbox.providerKey, sandbox.agentKey, sandbox.chain, sandbox.prisma
await sandbox.close();
```

Use it in your own tests. `sandbox.chain` is the fake ledger: `fund(deviceHash, amount)`, `failNext(error)` to see a blocked payment, and `claim(merchant)`.

## What is real and what is fake

Real: quoting, spending policy (caps, daily budget, allowlist, auto-approve limit), human approvals, receipts, outcome checks, the MCP tools and the provider SDK handshake. Fake: the ledger and transaction hashes, and there is no Stellar, Velo or production database.

A provider that registers (`settl({ provider, name, price, url })`) is created on first use and the demo agent is allowed to buy from it. Only one sandbox can run per process.

## Notes for contributors

- `src/schema.sql` is generated from `apps/web/prisma/schema.prisma`. A test fails when they drift apart; run `npm run schema -w @settl/dev` to regenerate.
- The sandbox replaces `@settl/stellar` with `src/stellar-stub.ts` so the real Noir, Velo and Stellar clients are never loaded.
- The embedded database allows one connection, so code must use the transaction client inside a transaction.
