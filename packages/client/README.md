# @settl/client

Let an AI agent discover and buy paid APIs through a Settl gateway. It wraps the gateway's MCP tools in a typed client, and adds Vercel AI SDK tools.

```ts
import { connectSettl } from "@settl/client";

const agent = await connectSettl();   // SETTL_MCP_URL and SETTL_AGENT_API_KEY from the environment
const { services } = await agent.listServices();
const result = await agent.callAndWait(services[0].id, { input: { image: "receipt.jpg" }, maxPricePhp: "5.00" });
if (result.status === "paid") console.log(result.data, result.receipt.txHash);
await agent.close();
```

Settings, in order of precedence: the options you pass, then `SETTL_AGENT_API_KEY` and `SETTL_MCP_URL`, then the local sandbox at `http://localhost:4000/mcp`. A remote URL must use https.

## Methods

| Method | What it does |
| --- | --- |
| `listServices()` | Services you can buy, with peso prices. Free. |
| `getBudget()` | Balance, spending today, policy limits and approvals waiting for a human. Free. |
| `quote(serviceId)` | Exact price of one service, without charging. |
| `call(serviceId, { input, maxPricePhp, approvalId })` | Buy and run a service. Spends money. |
| `callAndWait(serviceId, options)` | Like `call`, but waits for a human approval and then pays once. Options: `pollMs` (2000), `approvalTimeoutMs` (300000). |
| `checkApproval(id)` | Read an approval's status. Does not pay. |
| `waitForApproval(id, { timeoutSeconds })` | Wait on the gateway (up to 55 s) for a human decision. Does not pay. |
| `receipts(limit)` | Recent receipts, including uncharged and blocked calls. |
| `callTool(name, args)` | Call any Settl MCP tool by name. |

Errors are `SettlToolError` with `code`, `next` and `retryable`. `listServices()` includes each service's `description`, `inputSchema` and `example` when the provider gave them; input that does not match is declined with reason `invalid_input` and the `issues`, without charge. `callAndWait` waits on the gateway when it supports `settl_wait_for_approval` and polls otherwise.

`call` returns `paid`, `approval_required`, `declined`, `blocked`, `not_charged` or `pending`. Only `paid` means money moved. Never retry `pending`; check `receipts()` first. `callAndWait` returns `declined` (`approval_declined` or `approval_expired`) without paying, or the original `approval_required` with the reason `approval_pending` if the wait times out, so you can resume later with its `approvalId`.

An agent pays by service id, not by URL: Settl holds the agent's spending key and calls the provider after policy checks, so the agent never signs or calls the provider itself.

## Vercel AI SDK

```ts
import { settlTools } from "@settl/client/ai";

const result = await generateText({ model, tools: settlTools(agent), prompt: "..." });
```

`ai` and `zod` are optional peer dependencies, needed only for `@settl/client/ai`.

See the [quickstart](../../docs/QUICKSTART.md) to try it locally with no accounts.
