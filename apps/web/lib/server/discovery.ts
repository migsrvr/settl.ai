import { createHash } from "node:crypto";

/** Every agent tool, in the order an agent should usually meet them. Tests keep this list complete. */
export const TOOL_GUIDE: Array<[name: string, summary: string]> = [
  ["settl_list_services", "Paid services, their prices, what they do, the input they take and an example. Free."],
  ["settl_get_budget", "Balance, today's spending, limits and approvals waiting for a human. Free."],
  ["settl_quote", "The exact price of one service, without paying."],
  ["settl_call", "Buy and run a service by serviceId. Spends money."],
  ["settl_wait_for_approval", "Wait up to 55 seconds for a human to decide an approval. Never pays."],
  ["settl_check_approval", "Read an approval once. Never pays."],
  ["settl_receipts", "Recent receipts, including calls that were not charged or were blocked."],
];

/** How to buy safely. Served as the settl://guide MCP resource and inside llms.txt. */
export const BUY_GUIDE = `How to buy a service through Settl safely
1. Call settl_list_services. Pick a service and read its description, inputSchema and example.
2. Call settl_get_budget if you need to know what you can spend today.
3. Buy with the service's own tool (named after the provider and service) or with settl_call. Always set maxPricePhp to the most you accept.
4. Send input that matches inputSchema. Input that does not match is refused before any payment, and the result lists the issues.
5. Read the status of the result:
   - paid: money moved; use data, and keep receipt.txHash as proof.
   - declined or blocked: nothing was charged; follow next.
   - approval_required: a human must approve. Call settl_wait_for_approval with the approvalId, then buy again with the same approvalId once it is approved.
   - not_charged: nothing was charged.
   - pending: the outcome is not known yet. Never retry a pending call; check settl_receipts first.
6. Every result and error has a next field that says what to do.
`;

const SERVER_CARD_SCHEMA = "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET",
  "access-control-allow-headers": "Content-Type, If-None-Match",
  "access-control-expose-headers": "ETag",
};

function origin(request: Request): string {
  return new URL(request.url).origin;
}

/** A cacheable public document with an ETag, answering 304 when the client already has it. */
function publicDocument(request: Request, body: string, contentType: string): Response {
  const etag = `"${createHash("sha256").update(body).digest("base64url").slice(0, 27)}"`;
  const headers = { ...CORS, "content-type": contentType, "cache-control": "public, max-age=3600", etag };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(body, { status: 200, headers });
}

export function serverCard(base: string) {
  return {
    $schema: SERVER_CARD_SCHEMA,
    name: "ai.settl/gateway",
    version: "1.0.0",
    title: "Settl",
    description: "Lets AI agents find and pay for APIs from a capped budget, with human approval above a limit.",
    websiteUrl: base,
    repository: { url: "https://github.com/migsrvr/settl.ai", source: "github" },
    remotes: [{
      type: "streamable-http",
      url: `${base}/mcp`,
      headers: [{
        name: "Authorization",
        description: "Bearer followed by the agent key (stl_agent_...) shown once when the agent is created in the Settl dashboard.",
        isRequired: true,
        isSecret: true,
      }],
    }],
  };
}

/** GET <mcp-url>/server-card, the location SEP-2127 reserves for a server card. */
export function handleServerCard(request: Request): Response {
  return publicDocument(request, JSON.stringify(serverCard(origin(request))), "application/mcp-server-card+json");
}

/** GET /.well-known/ai-catalog.json, which points discovery tools at the server card. */
export function handleAiCatalog(request: Request): Response {
  const base = origin(request);
  const catalog = {
    specVersion: "1.0",
    entries: [{ identifier: "ai.settl/gateway", type: "application/mcp-server-card+json", url: `${base}/mcp/server-card` }],
  };
  return publicDocument(request, JSON.stringify(catalog), "application/ai-catalog+json");
}

export function llmsText(base: string): string {
  return `# Settl

> Settl lets an AI agent buy paid APIs from a budget its owner sets, with spending limits, human approval above a set amount, and a receipt for every charge.

## Connect
- MCP endpoint (streamable HTTP): ${base}/mcp
- Send the header \`Authorization: Bearer <agent key>\`. The owner creates the agent and its key in the Settl dashboard; the key starts with stl_agent_.
- Server card: ${base}/mcp/server-card

## Tools
${TOOL_GUIDE.map(([name, summary]) => `- ${name}: ${summary}`).join("\n")}
- Each service is also offered as its own tool, named after its provider and service, with that service's input schema.

## ${BUY_GUIDE.trim()}
`;
}

/** GET /llms.txt */
export function handleLlmsTxt(request: Request): Response {
  return publicDocument(request, llmsText(origin(request)), "text/plain; charset=utf-8");
}

/** CORS preflight for the public discovery documents. */
export function handleDiscoveryOptions(): Response {
  return new Response(null, { status: 204, headers: CORS });
}
