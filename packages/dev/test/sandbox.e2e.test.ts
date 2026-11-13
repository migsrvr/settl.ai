import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { phpToStroops } from "@settl/core";
import { registerEndpoint, settl } from "@settl/sdk";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startSandbox, type Sandbox } from "../src/index";

let sandbox: Sandbox;
let provider: Server;
const providerApp = express();
providerApp.use(express.json());

const post = (path: string, body: unknown, token: string) => fetch(`${sandbox.url}${path}`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify(body),
});
const call = async (body: unknown) => (await post("/api/agent/call", body, sandbox.agentKey)).json() as Promise<Record<string, any>>;
const stroops = (php: number) => phpToStroops(php, 15);

beforeAll(async () => {
  provider = await new Promise<Server>((resolve) => { const server = providerApp.listen(0, "127.0.0.1", () => resolve(server)); });
  const providerUrl = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`;
  sandbox = await startSandbox({ port: 0, providerUrl, balancePhp: 100, quiet: true });
  // A real provider: the published middleware talking to the sandbox gateway.
  for (const [route, endpointId] of [["/parse-receipt", "resibo_parse"], ["/parse-receipt-pro", "resibo_pro"], ["/lookup", "geoph_lookup"]] as const) {
    providerApp.post(route, settl({ endpointId, apiUrl: sandbox.url, apiKey: sandbox.providerKey }), (req, res) => {
      res.json({ ok: true, endpointId, paidTx: req.settlReceipt?.txHash });
    });
  }
}, 90_000);

afterAll(async () => {
  await sandbox?.close();
  await new Promise((resolve) => provider?.close(resolve));
});

const agentBalance = async () => {
  const agent = await sandbox.prisma.agent.findUniqueOrThrow({ where: { id: "bookkeeper" } });
  return sandbox.chain.balanceOf(agent.deviceHash);
};

describe("sandbox gateway", () => {
  it("answers health and describes itself", async () => {
    const health = await fetch(`${sandbox.url}/health`);
    expect(health.status).toBe(200);
    const info = await (await fetch(`${sandbox.url}/`)).json() as Record<string, any>;
    expect(info.sandbox).toBe(true);
    expect(info.mcpUrl).toBe(`${sandbox.url}/mcp`);
  });

  it("serves the discovery documents an agent or directory can find without a key", async () => {
    const card = await fetch(`${sandbox.url}/mcp/server-card`);
    expect(card.headers.get("content-type")).toBe("application/mcp-server-card+json");
    expect((await card.json()).remotes[0].url).toBe(sandbox.mcpUrl);
    const catalog = await (await fetch(`${sandbox.url}/.well-known/ai-catalog.json`)).json() as { entries: Array<{ url: string }> };
    expect(catalog.entries[0].url).toBe(`${sandbox.url}/mcp/server-card`);
    const llms = await (await fetch(`${sandbox.url}/llms.txt`)).text();
    expect(llms).toContain(sandbox.mcpUrl);
  });

  it("rejects unauthenticated agent and provider calls", async () => {
    expect((await post("/api/agent/call", { endpointId: "resibo_parse" }, "stl_agent_wrong")).status).toBe(401);
    expect((await post("/api/quotes", { endpointId: "resibo_parse" }, "wrong")).status).toBe(401);
  });

  it("pays a real provider through the SDK and moves fake escrow", async () => {
    const before = await agentBalance();
    const result = await call({ endpointId: "resibo_parse", input: { fixture: "clean" }, maxPricePhp: "10.00" });
    expect(result.status).toBe("paid");
    expect(result.receipt.txHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.data).toMatchObject({ ok: true, endpointId: "resibo_parse", paidTx: result.receipt.txHash });
    expect(before - (await agentBalance())).toBe(stroops(2));
  });

  it("declines a call above the agent's price cap before any payment", async () => {
    const before = await agentBalance();
    const result = await call({ endpointId: "resibo_pro", maxPricePhp: "10.00" });
    expect(result).toMatchObject({ status: "declined", reason: "over_max_price" });
    expect(await agentBalance()).toBe(before);
  });

  it("requires a human approval above the auto-approve limit, then pays once approved", async () => {
    const first = await call({ endpointId: "geoph_lookup", maxPricePhp: "10.00" });
    expect(first.status).toBe("approval_required");
    const resolved = await post(`/api/approvals/${first.approvalId}/resolve`, { decision: "approved" }, "none");
    expect(resolved.status).toBe(200);
    const second = await call({ endpointId: "geoph_lookup", maxPricePhp: "10.00", approvalId: first.approvalId });
    expect(second.status).toBe("paid");
  });

  it("serves the same flow over MCP with the agent bearer key", async () => {
    const client = new Client({ name: "sandbox-e2e", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
    await client.connect(new StreamableHTTPClientTransport(new URL(sandbox.mcpUrl), {
      requestInit: { headers: { authorization: `Bearer ${sandbox.agentKey}` } },
    }));
    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
        "settl_call", "settl_check_approval", "settl_get_budget", "settl_list_services", "settl_quote", "settl_receipts",
        // One typed tool per seeded service, carrying its input schema.
        "resibo_receipt_ocr", "geoph_lookup",
      ]));
      expect(tools.find((tool) => tool.name === "geoph_lookup")?.inputSchema.properties).toHaveProperty("input");
      const budget = await client.callTool({ name: "settl_get_budget", arguments: {} });
      expect((budget.structuredContent as Record<string, string>).balanceStroops).toBe((await agentBalance()).toString());
      const bought = await client.callTool({ name: "settl_call", arguments: { serviceId: "resibo_parse", maxPricePhp: "10.00" } });
      expect((bought.structuredContent as Record<string, unknown>).status).toBe("paid");
    } finally {
      await client.close();
    }
  });

  it("lets a new provider describe its endpoint in code and be bought from straight away", async () => {
    const registration = {
      provider: "acme-translate", name: "Translate", price: "3.00",
      url: `${sandbox.providerUrl}/v1/translate`, apiUrl: sandbox.url, apiKey: sandbox.providerKey,
    };
    providerApp.post("/v1/translate", settl(registration), (req, res) => res.json({ text: "hola", paidTx: req.settlReceipt?.txHash }));

    // No dashboard, no copied endpoint id: registering twice is harmless and returns the same endpoint.
    const endpointId = await registerEndpoint(registration);
    expect(await registerEndpoint(registration)).toBe(endpointId);

    const client = new Client({ name: "sandbox-e2e", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
    await client.connect(new StreamableHTTPClientTransport(new URL(sandbox.mcpUrl), {
      requestInit: { headers: { authorization: `Bearer ${sandbox.agentKey}` } },
    }));
    try {
      const listed = await client.callTool({ name: "settl_list_services", arguments: {} });
      const services = (listed.structuredContent as { services: Array<{ id: string; displayPrice: { amount: string }; providerName: string }> }).services;
      expect(services.find((service) => service.id === endpointId)).toMatchObject({ providerName: "acme-translate", displayPrice: { amount: "3.00" } });
    } finally {
      await client.close();
    }

    const before = await agentBalance();
    const result = await call({ endpointId, maxPricePhp: "10.00" });
    expect(result.status).toBe("paid");
    expect(result.data).toMatchObject({ text: "hola", paidTx: result.receipt.txHash });
    expect(before - (await agentBalance())).toBe(stroops(3));
  });

  it("lets a provider describe its input so agents use a typed tool and never pay for input it would reject", async () => {
    const registration = {
      provider: "acme-geo", name: "Barangay finder", price: "1.00", url: `${sandbox.providerUrl}/v1/barangay`,
      apiUrl: sandbox.url, apiKey: sandbox.providerKey,
      description: "Finds the barangay for a street address.",
      inputSchema: { type: "object", properties: { address: { type: "string", minLength: 3 } }, required: ["address"], additionalProperties: false },
      example: { address: "1 Ayala Ave, Makati" },
    };
    const guard = settl(registration);
    providerApp.post("/v1/barangay", guard, (req, res) => res.json({ barangay: "San Lorenzo", address: req.body?.address }));
    const endpointId = await guard.register();

    const client = new Client({ name: "sandbox-e2e", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
    await client.connect(new StreamableHTTPClientTransport(new URL(sandbox.mcpUrl), {
      requestInit: { headers: { authorization: `Bearer ${sandbox.agentKey}` } },
    }));
    try {
      const listed = await client.callTool({ name: "settl_list_services", arguments: {} });
      const service = (listed.structuredContent as { services: Array<Record<string, unknown>> }).services.find((entry) => entry.id === endpointId);
      expect(service).toMatchObject({ description: registration.description, inputSchema: registration.inputSchema, example: registration.example });

      const tool = (await client.listTools()).tools.find((candidate) => candidate.name === "acme_geo_barangay_finder");
      expect(tool?.description).toMatch(/Finds the barangay/);

      const before = await agentBalance();
      const bought = await client.callTool({ name: "acme_geo_barangay_finder", arguments: { input: { address: "1 Ayala Ave, Makati" }, maxPricePhp: "5.00" } });
      expect(bought.structuredContent).toMatchObject({ status: "paid", data: { barangay: "San Lorenzo" } });
      expect(before - (await agentBalance())).toBe(stroops(1));

      // Through the generic tool the schema still guards the money: nothing is charged.
      const refused = await client.callTool({ name: "settl_call", arguments: { serviceId: endpointId, input: { street: "x" }, maxPricePhp: "5.00" } });
      expect(refused.structuredContent).toMatchObject({ status: "declined", reason: "invalid_input", next: expect.stringMatching(/inputSchema/) });
      expect((refused.structuredContent as { issues: string[] }).issues.length).toBeGreaterThan(0);
      expect(before - (await agentBalance())).toBe(stroops(1));
    } finally {
      await client.close();
    }
  });

  it("refuses MCP without a valid agent key", async () => {
    const response = await fetch(sandbox.mcpUrl, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(response.status).toBe(401);
  });
});
