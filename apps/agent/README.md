# Settl Bookkeeper

An autonomous bookkeeping CLI using AI SDK 7 and the authenticated hosted Settl MCP endpoint. The model receives executable tools and decides when to request each service; payments are made by the hosted broker through its stored agent identity. The CLI never signs a Stellar transaction or supplies `agentId`.

From the repository root, after Gemini installs workspace dependencies:

```bash
export GROQ_API_KEY="<your-groq-key>"
export SETTL_MCP_URL="https://<your-settl-host>/mcp"
export DEMO_AGENT_API_KEY="<your-agent-token>"
npm run start -w @settl/agent
```

Environment examples are placeholders. Configure keys in the launching environment; this app does not read or modify `apps/web/.env.local`. Use Node 22 or newer, subject to the repository's stricter Stellar runtime requirement.

| Variable | Behavior |
| --- | --- |
| `GROQ_API_KEY` | Preferred provider. Defaults to `llama-3.3-70b-versatile`. |
| `OPENAI_API_KEY` | Selected when Groq has no key. Defaults to `gpt-4.1-mini`. |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Selected when neither Groq nor OpenAI has a key. Defaults to `gemini-2.5-flash`; `GEMINI_API_KEY` and `GOOGLE_API_KEY` are aliases. |
| `AGENT_MODEL` | Optional model name for the selected provider. It must support tool calling. |
| `SETTL_MCP_URL` | Defaults to `http://localhost:3000/mcp`. Hosted endpoints require HTTPS. |
| `DEMO_AGENT_API_KEY` | Bearer credential for MCP. When omitted, uses the public Bookkeeper demo token already documented by the seed. |
| `AGENT_LEDGER_PATH` | Optional path. Defaults to `apps/agent/.data/ledger.json` relative to this package's source location. |

Provider fallback is configuration selection in the order above. A configured provider's runtime failure stops the run; it does not switch models and replay a partially completed payment mission. With no provider key, startup fails before connecting or writing a ledger.

The hosted server, seeded active agent, escrow funds, provider URLs and provider server must already be ready. This CLI does not provision or fund them.

The mission asks the model to perform these actions using the registered `settl_` tools:

1. Read `settl_get_budget` and the real policy.
2. Discover prices with `settl_list_services`.
3. Request `resibo_parse` with `{ "fixture": "clean" }`. Record an expense only from a paid receipt with a transaction hash and valid receipt line items.
4. Request `resibo_parse` with `{ "fixture": "blurry" }`. Log `not_charged`; do not record an expense.
5. Request the PHP15 `resibo_pro` service with a PHP10 limit. Report the broker's `declined` / `over_max_price` result.
6. Request the PHP8 `geoph_lookup` service. Display the real `/buyer/approvals/<id>` notification URL and poll `settl_check_approval` for up to 60 seconds, normally every three seconds. Once approved, the model can resume the same call with the same `approvalId` exactly once.

`settl_quote` and `settl_receipts` are also available to the model. MCP responses may provide JSON through `structuredContent` or a text content block; both are decoded. Streamable HTTP handles the endpoint's HTTP and SSE responses through the official MCP client. Bearer headers are sent on each request; redirects are refused. No legacy `/sse` endpoint is invented.

Only observed statuses, hashes and notification URLs are printed. The model's narrative is not treated as settlement evidence. A mission report records which actions were requested; completing those requests does not mean every payment settled. The CLI reports an incomplete mission if the model omits actions. Actual paid/pending/declined outcomes always come from MCP.

The ledger stores receipt expenses and a separate operation journal. `totalPhp` is the amount on the business receipt; `feeStroops` is the OCR API charge. Only `paid` plus a valid paid receipt, 64-character transaction hash, passing checks, confidence of at least 0.85, valid date, and line items summing exactly in PHP cents creates an expense. Geography results never become receipt expenses. Either a repeated `quoteId` or repeated transaction hash prevents another insertion.

Every payment request is journaled before network submission. The file is written to a temporary file, flushed and atomically renamed, with an exclusive lock for the whole CLI run. Calls execute sequentially. Already paid, uncharged, declined, blocked, submitted, pending or unknown operations cannot submit another payment, including after restart. Approval resumes must preserve a fingerprint of the original input and price cap. No price above PHP10 is accepted by the CLI.

On an approval timeout, no payment is retried. Running the CLI again with the same ledger can recheck the existing approval and resume that same ID after approval. Declined or expired approvals stop the action. A transport error or unrecognized payment result is recorded as unknown and requires operator reconciliation against server receipts before further payment. The CLI never assumes a timeout means failure. MCP closes and the ledger lock releases on success or failure; a hard process termination may leave a stale lock. Reconcile the server operation before manually removing that lock. Keep the ledger when restarting; deleting it removes the local duplicate guard. Use a separate ledger per agent and MCP environment.

SDK dependencies are pinned to the official upstream source versions inspected for this implementation:

| Package | Version |
| --- | --- |
| `ai` | `7.0.163` |
| `@ai-sdk/groq` | `4.0.59` |
| `@ai-sdk/openai` | `4.0.108` |
| `@ai-sdk/google` | `4.0.111` |
| `@modelcontextprotocol/client` | `2.4.0` |
| `zod` | `^4.2.0` |
| `tsx` | `^4.20.6` |

The implementation uses `generateText`, `tool({ inputSchema, execute })`, `isStepCount(24)` and `toolCallConcurrency: 1`. AI SDK 7 uses `isStepCount`, replacing the older `stepCountIs` name. LLM retries are disabled. Explicit typed tool wrappers use the standard MCP v2 `Client`, `StreamableHTTPClientTransport`, `callTool(params, options)` and `close`; this does not depend on AI SDK's separate MCP package.

References: [AI SDK tool calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling), [Groq provider](https://ai-sdk.dev/providers/ai-sdk-providers/groq), [AI SDK 7 pinned source](https://github.com/vercel/ai/blob/ai%407.0.163/packages/ai/src/generate-text/generate-text.ts), [Groq package](https://github.com/vercel/ai/blob/main/packages/groq/package.json), [OpenAI package](https://github.com/vercel/ai/blob/main/packages/openai/package.json), [Google package](https://github.com/vercel/ai/blob/main/packages/google/package.json), [MCP v2 client guide](https://ts.sdk.modelcontextprotocol.io/v2/clients/connect).

Vitest tests mock the LLM and MCP, including the production AI SDK tool wrapper path. They cover expense validation and deduplication, approval polling with an injected clock, exact approval resume, transport uncertainty, concurrent calls, cleanup, configuration, and credential redaction. No test uses live models or payments.

Implementation status: written, statically inspected, and **not executed or verified**. AI SDK packages were absent locally during implementation. Gemini owns dependency installation and lockfile refresh, then the required root checks:

```bash
npm install
npm test && npm run typecheck && npm run lint && npm run build
```

A live model/MCP test must separately verify model access, transport compatibility, server data, approval UI resolution and real settlement. Repeated demo missions need a deliberately prepared fresh ledger only after all previous pending operations have been reconciled. This package does not implement a pending-payment recovery worker or infer ledger expenses from a server receipts list without original OCR data.
