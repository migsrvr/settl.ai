# Settl.ai web app

Next.js 16 host for Settl's provider/buyer interfaces and stage view. The same app is the planned host for the gateway REST API, hosted MCP server, and backend integrations.

The existing pages use demo data. The broker, REST routes, MCP transport, database, and live payment wiring are not implemented yet. All live interfaces remain in scope for the November 8 demo. See the [project README](../../README.md) and [progress report](../../docs/progress.md).

## Run from the repository root

Use npm workspaces and a Node release supported by Noir SDK 0.3.0. Node 24.22.1 is the previously verified runtime.

```sh
npm install
npm run dev
```

Open [localhost:3000](http://localhost:3000).

| Route | Current demo |
|---|---|
| `/` | Landing page. |
| `/login` | Select provider or buyer; any password works for demo sign-in. |
| `/provider` | Provider overview, with earnings and endpoints under the same prefix. |
| `/buyer` | Buyer agent list, create/detail flows, and approval screen. |
| `/stage` | Scripted presentation view. |

Demo accounts are `mara@example.com` (provider) and `juan@example.com` (buyer). Claim and top-up UI flows currently simulate state changes; they do not transfer funds.

## Configuration and checks

If absent, create `apps/web/.env.local` from the root `.env.example`. Preserve existing local values and never commit credentials. The [root setup guide](../../README.md#run-locally) explains which configuration is needed for each integration. Rendering the current demo pages does not require live Velo or database credentials.

Run the required repository check from the root:

```sh
npm test && npm run typecheck && npm run lint && npm run build
```

For web-only debugging, also from the root:

```sh
npm test -w web
npm run typecheck -w web
npm run lint -w web
npm run build -w web
```

## Development references

- [App agent instructions](AGENTS.md): read the installed Next.js docs before using an API; this project uses Next.js 16 conventions.
- [Handoff](../../HANDOFF.md): current checkpoint and build order.
- [API/MCP design](../../docs/superpowers/specs/2026-11-04-settl-api-mcp-design.md): current backend design.
- [UI design](../../docs/superpowers/specs/2026-11-03-settl-ui-design.md): follow section 2 and the tokens in `app/globals.css`.

Keep the full demo working as integrations are added: paid clean results, failed results without charge, cap rejection, human approval, top-up, and claim.
