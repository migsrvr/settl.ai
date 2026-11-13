import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { startSandbox, type Sandbox } from "@settl/dev";
import { settl } from "@settl/sdk";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectSettl, type SettlClient } from "../src/index";

let sandbox: Sandbox;
let provider: Server;
let client: SettlClient;
const providerApp = express();
providerApp.use(express.json());

const resolveApproval = (id: string, decision: "approved" | "declined") => fetch(`${sandbox.url}/api/approvals/${id}/resolve`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision }),
});

/** Play the human: wait for the agent's pending approval to appear, then decide it. */
async function decideNextApproval(decision: "approved" | "declined", afterMs = 100): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, afterMs));
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const budget = await client.getBudget();
    const approval = budget.pendingApprovals[0];
    if (approval) {
      expect((await resolveApproval(approval.id, decision)).status).toBe(200);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("no approval appeared");
}

beforeAll(async () => {
  provider = await new Promise<Server>((resolve) => { const server = providerApp.listen(0, "127.0.0.1", () => resolve(server)); });
  sandbox = await startSandbox({ port: 0, providerUrl: `http://127.0.0.1:${(provider.address() as AddressInfo).port}`, balancePhp: 100 });
  for (const [route, endpointId] of [["/parse-receipt", "resibo_parse"], ["/parse-receipt-pro", "resibo_pro"], ["/lookup", "geoph_lookup"]] as const) {
    providerApp.post(route, settl({ endpointId, apiUrl: sandbox.url, apiKey: sandbox.providerKey }), (_req, res) => res.json({ ok: true, endpointId }));
  }
  client = await connectSettl({ mcpUrl: sandbox.mcpUrl, apiKey: sandbox.agentKey });
}, 90_000);

afterAll(async () => {
  await client?.close();
  await sandbox?.close();
  await new Promise((resolve) => provider?.close(resolve));
});

describe("settl client", () => {
  it("lists services with their pesos prices", async () => {
    const { services } = await client.listServices();
    expect(services.map((service) => service.id).sort()).toEqual(["geoph_lookup", "resibo_parse", "resibo_pro"]);
    expect(services.find((service) => service.id === "resibo_parse")?.displayPrice).toEqual({ currency: "PHP", amount: "2.00" });
  });

  it("reads the budget and policy", async () => {
    const budget = await client.getBudget();
    expect(BigInt(budget.balanceStroops)).toBeGreaterThan(0n);
    expect(budget.policy.allowlist).toContain("resibo");
    expect(budget.openApprovals).toBe(0);
  });

  it("quotes without charging", async () => {
    const before = (await client.getBudget()).balanceStroops;
    const quote = await client.quote("resibo_parse");
    expect(quote.displayPrice.amount).toBe("2.00");
    expect((await client.getBudget()).balanceStroops).toBe(before);
  });

  it("buys a service and returns the provider's data with a receipt", async () => {
    const result = await client.call("resibo_parse", { input: { fixture: "clean" }, maxPricePhp: "10.00" });
    expect(result.status).toBe("paid");
    if (result.status !== "paid") return;
    expect(result.receipt.txHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.data).toMatchObject({ ok: true, endpointId: "resibo_parse" });
    const { receipts } = await client.receipts(5);
    expect(receipts[0]).toMatchObject({ status: "paid", txHash: result.receipt.txHash, serviceId: "resibo_parse" });
  });

  it("returns a decline for a price above the agent's cap, without paying", async () => {
    const before = (await client.getBudget()).balanceStroops;
    const result = await client.call("resibo_pro", { maxPricePhp: "10.00" });
    expect(result).toMatchObject({ status: "declined", reason: "over_max_price" });
    expect((await client.getBudget()).balanceStroops).toBe(before);
  });

  it("callAndWait waits for a human to approve, then pays once", async () => {
    const human = decideNextApproval("approved");
    const result = await client.callAndWait("geoph_lookup", { maxPricePhp: "10.00", pollMs: 50, approvalTimeoutMs: 10_000 });
    await human;
    expect(result.status).toBe("paid");
  });

  it("callAndWait reports a declined approval without paying", async () => {
    const before = (await client.getBudget()).balanceStroops;
    const human = decideNextApproval("declined");
    const result = await client.callAndWait("geoph_lookup", { maxPricePhp: "10.00", pollMs: 50, approvalTimeoutMs: 10_000 });
    await human;
    expect(result).toMatchObject({ status: "declined", reason: "approval_declined" });
    expect((await client.getBudget()).balanceStroops).toBe(before);
  });

  it("callAndWait stops waiting after the timeout and hands back the approval to resume later", async () => {
    const result = await client.callAndWait("geoph_lookup", { maxPricePhp: "10.00", pollMs: 25, approvalTimeoutMs: 150 });
    expect(result).toMatchObject({ status: "approval_required", reason: "approval_pending" });
    if (result.status !== "approval_required") return;
    // The human decides later; resuming with the id pays exactly once.
    expect((await resolveApproval(result.approvalId, "approved")).status).toBe(200);
    expect((await client.call("geoph_lookup", { maxPricePhp: "10.00", approvalId: result.approvalId })).status).toBe("paid");
  });

  it("lists what each demo service does and the input it takes", async () => {
    const { services } = await client.listServices();
    const lookup = services.find((service) => service.id === "geoph_lookup");
    expect(lookup?.description).toMatch(/city/i);
    expect(lookup?.inputSchema).toMatchObject({ type: "object" });
    expect(lookup?.example).toEqual({ city: "Makati" });
  });

  it("refuses input that breaks a service's schema without charging, and says why", async () => {
    const before = (await client.getBudget()).balanceStroops;
    const result = await client.call("resibo_parse", { input: { fixture: "torn" }, maxPricePhp: "10.00" });
    expect(result).toMatchObject({ status: "declined", reason: "invalid_input" });
    if (result.status !== "declined") return;
    expect(result.next).toMatch(/inputSchema/);
    expect(result.issues?.length).toBeGreaterThan(0);
    expect((await client.getBudget()).balanceStroops).toBe(before);
  });

  it("waits for a human decision on the server", async () => {
    const first = await client.call("geoph_lookup", { maxPricePhp: "10.00" });
    expect(first.status).toBe("approval_required");
    if (first.status !== "approval_required") return;
    setTimeout(() => { void resolveApproval(first.approvalId, "approved"); }, 200);
    const waited = await client.waitForApproval(first.approvalId, { timeoutSeconds: 10 });
    expect(waited).toMatchObject({ decided: true, approval: { status: "approved" } });
    expect((await client.call("geoph_lookup", { maxPricePhp: "10.00", approvalId: first.approvalId })).status).toBe("paid");
  });

  it("raises gateway errors with their code and next step", async () => {
    await expect(client.checkApproval("missing-approval")).rejects.toMatchObject({ code: "APPROVAL_NOT_FOUND", next: expect.any(String) });
  });

  it("refuses a wrong agent key at connect time", async () => {
    await expect(connectSettl({ mcpUrl: sandbox.mcpUrl, apiKey: "stl_agent_wrong" })).rejects.toThrow(/agent key/i);
  });
});
