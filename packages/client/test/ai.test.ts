import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { startSandbox, type Sandbox } from "@settl/dev";
import { settl } from "@settl/sdk";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { settlTools } from "../src/ai";
import { connectSettl, type SettlClient } from "../src/index";

let sandbox: Sandbox;
let provider: Server;
let client: SettlClient;
const providerApp = express();
providerApp.use(express.json());

beforeAll(async () => {
  provider = await new Promise<Server>((resolve) => { const server = providerApp.listen(0, "127.0.0.1", () => resolve(server)); });
  sandbox = await startSandbox({ port: 0, providerUrl: `http://127.0.0.1:${(provider.address() as AddressInfo).port}` });
  providerApp.post("/parse-receipt", settl({ endpointId: "resibo_parse", apiUrl: sandbox.url, apiKey: sandbox.providerKey }), (_req, res) => res.json({ ok: true }));
  client = await connectSettl({ mcpUrl: sandbox.mcpUrl, apiKey: sandbox.agentKey });
}, 90_000);

afterAll(async () => {
  await client?.close();
  await sandbox?.close();
  await new Promise((resolve) => provider?.close(resolve));
});

const options = { toolCallId: "t1", messages: [], context: {} };

describe("settlTools (Vercel AI SDK)", () => {
  it("exposes the seven Settl tools with descriptions an agent can act on", () => {
    const tools = settlTools(client);
    expect(Object.keys(tools).sort()).toEqual([
      "settl_call", "settl_check_approval", "settl_get_budget", "settl_list_services", "settl_quote", "settl_receipts",
      "settl_wait_for_approval",
    ]);
    for (const tool of Object.values(tools)) expect(String(tool.description).length).toBeGreaterThan(20);
  });

  it("runs discovery and a purchase through the client", async () => {
    const tools = settlTools(client);
    const listed = await tools.settl_list_services.execute?.({}, options) as { services: Array<{ id: string }> };
    expect(listed.services.map((service) => service.id)).toContain("resibo_parse");
    const bought = await tools.settl_call.execute?.({ serviceId: "resibo_parse", maxPricePhp: "10.00" }, options) as { status: string };
    expect(bought.status).toBe("paid");
  });

  it("rejects arguments that break the contract before they reach the gateway", () => {
    const tools = settlTools(client);
    const schema = tools.settl_call.inputSchema as { safeParse(value: unknown): { success: boolean } };
    expect(schema.safeParse({ serviceId: "resibo_parse", maxPricePhp: "ten pesos" }).success).toBe(false);
    expect(schema.safeParse({ maxPricePhp: "10.00" }).success).toBe(false);
    expect(schema.safeParse({ serviceId: "resibo_parse", maxPricePhp: "10.00" }).success).toBe(true);
  });
});
