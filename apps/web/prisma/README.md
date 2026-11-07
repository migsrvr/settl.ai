# Database setup

### Performance snapshot upgrade (prepared, not applied)

Before deploying the dashboard performance changes to an existing database, review
`apps/web/prisma/performance-upgrade.sql` against the intended database. It adds
nullable provider snapshot columns and history indexes idempotently; it does not
backfill balances, rewrite payments, or contact Stellar. No migration history is
checked into this repository, so do not run `migrate deploy` assuming this standalone
upgrade is a baseline migration. With database-write authorization and the intended
environment selected, run from the repository root:

```sh
npm exec -w web -- prisma db execute --file prisma/performance-upgrade.sql
```

This upgrade has not been applied to Neon during local performance implementation.
Apply it before deploying dependent application code. Repeated application is a
no-op for existing columns/indexes. Snapshots remain unknown until a successful
read; financial operations continue using their existing authoritative checks.

Prisma 7 uses PostgreSQL through `@prisma/adapter-pg`. Configuration loads
`apps/web/.env.local` with Next.js's environment loader. Run from the repo root:

```sh
npm run db:generate -w web
npm run db:migrate -w web -- --name initial
npm run db:seed -w web
```

Gemini owns the initial migration, seed execution and verification for Phase 2.
No migration or seed was executed by Codex. For an existing migration history,
deploy with `npm run db:deploy -w web`; do not reset a database to fix a conflict.

The generated client lives in ignored `apps/web/lib/generated/prisma`.
Generate it after installing dependencies and before tests or typecheck. The web
build also generates it. `getDb()` in `lib/server/db.ts` creates a single client
lazily, reuses it during development reloads, and limits each process's pool to
five connections. Use it only in server code; routes using it require Node.js.

The schema includes the requested 16 models plus the parent spec's Verification
and inbound WebhookEvent records. Amounts and nonces are JavaScript `bigint`
backed by PostgreSQL signed 64-bit integers. Application writes must stay in that
range; serialize them as strings in JSON responses. Nonce allocation and one
payment in flight per agent still require the broker's transaction and row lock.
Cross-record checks (quote/agent/provider consistency and state transitions) also
belong in the broker; a foreign key alone does not enforce them.

`WALLET_ENC_KEY` is exactly 32 bytes encoded as 64 hex characters. Encrypted
wallets use `v1:<12-byte IV hex>:<16-byte auth tag hex>:<ciphertext hex>` with
AES-256-GCM and an authenticated version. Keep that key stable to read stored
wallets. Plaintext secrets are never persisted or printed.

The database-only seed creates Mara/ResiboAI, Juan's Accounting Firm with Juan's
Bookkeeper, and GeoPH. It includes receipt OCR (₱2, per-call), Pro (₱15, per-call),
and GeoPH (₱8, per-call), a ₱10 cap, ₱50 daily budget and ₱5 approval threshold.
Prices use `PHP_PER_XLM` (default 15) and round up to integer stroops. Allowlisted
provider IDs are `resibo` and `geoph`. Wallets are randomly generated and
encrypted; reruns preserve existing wallets, policy, revocations and nonce state.
The seed never contacts Stellar, funds accounts, registers contracts, or invents
on-chain balances. New agents remain `provisioning` until a later live setup step.

### Existing mock OCR billing

The November 7 decision changes `resibo_parse` to usage billing. New seeds create it as `per_call`; rerunning the seed also upgrades that original Resibo endpoint. For an existing database, use this narrower command from the repo root after selecting the intended database environment:

```sh
npm exec -w web -- tsx prisma/demo-usage-billing.ts --apply
```

Without `--apply`, the command prints guidance and never connects to the database. Applying it updates only `resibo_parse` owned by `resibo` while its mode is `outcome`, switches it to `per_call`, and clears obsolete result criteria. Reapplying is a no-op. It preserves price, provider URL, ownership, wallets, policy, outstanding reservations, and historical quote/payment terms. Old uncharged calls remain uncharged; new calls use the stored per-call setting. Pending old outcome calls must finish or be reconciled under their original terms; old approval snapshots with a different mode cannot resume as per-call payments. No chain operation is submitted by this update. On November 7, the user authorized applying this to the configured Neon database: exactly one endpoint changed, a database read confirmed preserved fields, and actual hosted MCP discovery confirmed Receipt OCR at PHP 2 in per-call mode. No purchase was made during that update. Other environments still require their own deliberate application.

Because the demo row ID `bookkeeper` repeats across databases, its device hash is
SHA-256 of `settl:agent:bookkeeper:<agentPublic>`. Including its generated wallet
identity prevents separate demo databases from claiming the same testnet device.
Live setup must use the persisted `deviceHash` rather than recomputing it from
the short demo row ID.

The default API token is the public testnet demo value
`stl_agent_bookkeeper_demo`; set `DEMO_AGENT_API_KEY` for any exposed deployment.
Only its SHA-256 digest is stored. Rerunning does not reactivate revoked keys.
Changing the override creates another hashed key without revoking existing ones.
Webhook signing secrets use the same encrypted-envelope storage; delivery
workers and inbound signature verification are later phases.

Prisma configuration follows the official [Next.js guide](https://www.prisma.io/docs/guides/v7/frameworks/nextjs)
and [explicit seed configuration](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/seeding).
