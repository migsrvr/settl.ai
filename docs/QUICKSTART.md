# Settl quickstart: charge an AI agent in five minutes

You will run a local Settl gateway with fake money, put a price on an API, and let an agent buy it. No Neon, Velo, Stellar wallets or accounts are needed.

The code below is the code in [`examples/`](../examples). A test runs those examples against the sandbox, so it stays working.

> **Packages are not published yet.** Until they are, run everything from a clone of this repository. Where a step says `npx settl-dev`, use `npm run sandbox` from the clone instead.

## 0. Get the code

```sh
git clone https://github.com/migsrvr/settl.ai.git
cd settl.ai
npm install
npm run db:generate -w web
```

Use Node 24.22.1 or newer. The generated database client is the only setup step.

## 1. Start the sandbox

```sh
npm run sandbox        # once published: npx settl-dev
```

It prints the gateway URL, a provider key, an agent key and ready-to-paste MCP config. The money is fake and the ledger lives in memory, so stopping the process resets everything.

Pass flags after `--`, for example `npm run sandbox -- --port 5000`. Useful flags: `--port 5000`, `--balance 250` (fake pesos for the agent), `--auto-approve` (skip human approvals), `--provider-url`, `--agent-key`.

## 2. Put a price on your API

In the terminal where you will run your API, set the two values the sandbox printed:

```sh
export SETTL_API_URL=http://127.0.0.1:4000
export SETTL_PROVIDER_KEY=sandbox_provider_key
```

Then gate a route with the SDK (`npm install @settl/sdk`):

```ts
import { settl } from "@settl/sdk";

const ocr = settl({ provider: "acme", name: "Receipt OCR", price: "2.00",
                    url: `${PUBLIC_URL}/parse-receipt` });
app.post("/parse-receipt", ocr, (req, res) => res.json(parseReceipt(req.body)));
```

- `provider` is your id on the gateway. The sandbox creates it the first time you use it.
- `url` is where Settl will call your API after payment. `PUBLIC_URL` is wherever your server is reachable.
- The endpoint registers itself on the first request. Call `await ocr.register()` at startup to list it immediately, so agents can find it before any request arrives.
- Describe the service for agents with `description`, `inputSchema` (a JSON Schema with `"type": "object"`) and `example`. Agents see them in `settl_list_services` and in the service's own tool, and Settl refuses input that does not match the schema before any payment, so nobody pays for a call your API would reject.
- Registering the same route again is safe. It never changes an existing price or URL; if your code differs, the SDK warns once and the registered values stay.

Run the full example with `npx tsx examples/express-provider/server.ts`.

Not on Express? `withSettl` gates any handler that takes a web-standard `Request`, such as a Next.js route handler. See [`examples/next-route/route.ts`](../examples/next-route/route.ts).

```ts
import { withSettl } from "@settl/sdk";

export const POST = withSettl(
  async (request, { receipt }) => Response.json({ paidWith: receipt?.txHash }),
  { provider: "acme", name: "Receipt OCR", price: "2.00", url: `${PUBLIC_URL}/api/parse-receipt` },
);
```

## 3. Let an agent buy it

**Any MCP client.** Run the line the sandbox printed. For Claude Code:

```sh
claude mcp add --transport http settl http://127.0.0.1:4000/mcp --header "Authorization: Bearer stl_agent_sandbox_demo"
```

The agent gets seven tools: `settl_list_services`, `settl_get_budget`, `settl_quote`, `settl_call`, `settl_wait_for_approval`, `settl_check_approval` and `settl_receipts`. Each service is also offered as its own tool, named after its provider and service (for example `acme_receipt_ocr`), with that service's input schema. The gateway also serves a buying guide as the `settl://guide` resource and a `buy_service` prompt, and every result and error includes a `next` field that says what to do.

**From code** (`npm install @settl/client`):

```ts
import { connectSettl } from "@settl/client";

const agent = await connectSettl();   // SETTL_MCP_URL and SETTL_AGENT_API_KEY from the environment
const { services } = await agent.listServices();
const ocr = services.find((service) => service.providerName === "acme");
if (!ocr) throw new Error("No acme service registered yet");

const result = await agent.callAndWait(ocr.id, { input: { image: "receipt.jpg" }, maxPricePhp: "5.00" });
if (result.status === "paid") console.log(result.data, result.receipt.txHash);
```

Run it with `npx tsx examples/agent/buy.ts` after exporting the agent key and MCP URL from the sandbox banner.

**With the Vercel AI SDK:**

```ts
import { generateText, isStepCount } from "ai";
import { connectSettl } from "@settl/client";
import { settlTools } from "@settl/client/ai";

const agent = await connectSettl();
await generateText({
  model,
  tools: settlTools(agent),
  stopWhen: isStepCount(8),
  prompt: "Parse this receipt with the cheapest service, but never pay more than 5 pesos.",
});
```

## 4. Understand the results

`call` returns one of these. Only `paid` means money moved.

| Status | Meaning | What to do |
| --- | --- | --- |
| `paid` | Charged. `receipt.txHash` and the provider's `data` are included. | Use the data. |
| `declined` | Refused before payment, for example `over_max_price`. | Raise `maxPricePhp` or pick another service. |
| `approval_required` | The price is above the agent's auto-approve limit. | A human approves, then call again with the `approvalId`. `callAndWait` does this for you. |
| `blocked` | The payment could not be authorized. Nothing was charged. | Check the reason and the budget. |
| `not_charged` | An outcome-billed result failed its checks. | Nothing to pay. |
| `pending` | The outcome is not known yet. | **Do not retry.** Check receipts first. |

A `declined` result with reason `invalid_input` lists what was wrong under `issues`.

In the sandbox a human approves with the curl command the banner prints, or start with `--auto-approve`.

## 5. What is fake, and the way to real money

The sandbox runs the real Settl broker, spending policy, approvals and MCP tools. Only the money is fake: an in-memory ledger replaces Stellar, and nothing talks to Velo or a real database. Transaction hashes are made up.

To use the hosted testnet gateway, change only the settings: `SETTL_API_URL` and `SETTL_PROVIDER_KEY` for the provider, and `SETTL_MCP_URL` and `SETTL_AGENT_API_KEY` for the agent. A deployed gateway keeps the production rules: your endpoint URL must be on the operator's allowed list, and providers are real organizations created by the operator.
