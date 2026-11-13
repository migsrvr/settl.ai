import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startSandbox, type Sandbox } from "../src/index";
import { buyReceiptOcr } from "../../../examples/agent/buy";
import { createApp } from "../../../examples/express-provider/server";

// The examples are what the landing page and quickstart show. They must keep working against the sandbox.
let sandbox: Sandbox;
let provider: Server;
const saved: Record<string, string | undefined> = {};

function setEnv(values: Record<string, string>) {
  for (const [name, value] of Object.entries(values)) {
    saved[name] = process.env[name];
    process.env[name] = value;
  }
}

beforeAll(async () => {
  sandbox = await startSandbox({ port: 0 });
  setEnv({ SETTL_API_URL: sandbox.url, SETTL_MCP_URL: sandbox.mcpUrl, SETTL_AGENT_API_KEY: sandbox.agentKey });
  provider = createServer();
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
}, 90_000);

afterAll(async () => {
  await new Promise((resolve) => provider?.close(resolve));
  await sandbox?.close();
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});

describe("examples", () => {
  it("the Express provider and the agent example complete a paid call", async () => {
    const publicUrl = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`;
    const { app, ready } = createApp({ publicUrl });
    provider.on("request", app);
    await ready;

    const result = await buyReceiptOcr();
    expect(result.status).toBe("paid");
    if (result.status !== "paid") return;
    expect(result.data).toMatchObject({ merchant: "Mara's Store", total: 120 });
    expect(result.receipt.txHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("the Next.js route example answers an unpaid request with a quote for its registered price", async () => {
    // The route reads its gateway settings when it is imported, as a real Next.js route does.
    const { POST } = await import("../../../examples/next-route/route");
    expect(await POST.register()).toMatch(/\S/);
    const response = await POST(new Request("http://localhost:3000/api/parse-receipt", { method: "POST", body: "{}" }));
    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({ description: "Receipt OCR (Next.js)", displayPrice: { amount: "2.00" } });
  });
});
