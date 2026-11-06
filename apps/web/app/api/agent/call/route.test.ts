// @vitest-environment node
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const { executeCall, findUnique } = vi.hoisted(() => ({ executeCall: vi.fn(), findUnique: vi.fn() }));
vi.mock("@/lib/server/broker", () => ({ executeCall }));
vi.mock("@/lib/server/db", () => ({ getDb: () => ({ agentApiKey: { findUnique } }) }));

const token = "stl_agent_example_token";
const request = (body: unknown, authorization = `Bearer ${token}`) => new Request("https://settl.test/api/agent/call", {
  method: "POST", headers: { authorization, "content-type": "application/json" }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.resetAllMocks();
  findUnique.mockResolvedValue({ agentId: "stored-agent", revokedAt: null, agent: { id: "stored-agent", status: "active" } });
  executeCall.mockResolvedValue({ status: "paid", receipt: { txHash: "a".repeat(64) } });
});

describe("POST /api/agent/call", () => {
  it("derives agent identity from the stored token", async () => {
    const response = await POST(request({ endpointId: "endpoint-1", agentId: "attacker-chosen-agent", input: { receipt: "clean" }, maxPricePhp: "2.00", approvalId: "approval-1" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "paid", receipt: { txHash: "a".repeat(64) } });
    expect(executeCall).toHaveBeenCalledWith({ agentId: "stored-agent", endpointId: "endpoint-1", input: { receipt: "clean" }, maxPricePhp: "2.00", approvalId: "approval-1" });
    expect(findUnique).toHaveBeenCalledWith({ where: { keyHash: createHash("sha256").update(token).digest("hex") }, include: { agent: true } });
  });

  it("accepts omitted optional fields and JSON null input", async () => {
    await POST(request({ endpointId: "endpoint-1" }));
    expect(executeCall).toHaveBeenLastCalledWith({ agentId: "stored-agent", endpointId: "endpoint-1" });
    await POST(request({ endpointId: "endpoint-1", input: null }));
    expect(executeCall).toHaveBeenLastCalledWith({ agentId: "stored-agent", endpointId: "endpoint-1", input: null });
  });

  it.each(["0", "0.00", "2", "2.5", "2.50"])("accepts nonnegative decimal prices: %s", async (maxPricePhp) => {
    expect((await POST(request({ endpointId: "endpoint-1", maxPricePhp }))).status).toBe(200);
  });

  it.each([{}, null, [], { endpointId: 7 }, { endpointId: " " },
    ...[2, null, "", "-1", "1.001", "1e2", "+2", "NaN", "Infinity", " 2.00", ".50"].map((maxPricePhp) => ({ endpointId: "endpoint-1", maxPricePhp })),
    { endpointId: "endpoint-1", approvalId: 7 }, { endpointId: "endpoint-1", approvalId: "" }])("rejects malformed call input: %s", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(executeCall).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", async () => {
    const response = await POST(new Request("https://settl.test/api/agent/call", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: "{" }));
    expect(response.status).toBe(400);
    expect(executeCall).not.toHaveBeenCalled();
  });

  it.each(["", "Bearer provider-key", "Basic stl_agent_example_token", "Bearer stl_agent_"])("rejects invalid authorization before database and broker work", async (authorization) => {
    expect((await POST(request({ endpointId: "endpoint-1" }, authorization))).status).toBe(401);
    expect(findUnique).not.toHaveBeenCalled();
    expect(executeCall).not.toHaveBeenCalled();
  });

  it("rejects missing and revoked API keys", async () => {
    findUnique.mockResolvedValueOnce(null);
    expect((await POST(request({ endpointId: "endpoint-1" }))).status).toBe(401);
    findUnique.mockResolvedValueOnce({ agentId: "stored-agent", revokedAt: new Date(), agent: { status: "active" } });
    expect((await POST(request({ endpointId: "endpoint-1" }))).status).toBe(401);
    expect(executeCall).not.toHaveBeenCalled();
  });

  it.each(["revoked", "provisioning", "error"])("rejects inactive agent status: %s", async (status) => {
    findUnique.mockResolvedValueOnce({ agentId: "stored-agent", revokedAt: null, agent: { id: "stored-agent", status } });
    expect((await POST(request({ endpointId: "endpoint-1" }))).status).toBe(403);
    expect(executeCall).not.toHaveBeenCalled();
  });

  it.each(["paid", "blocked", "declined", "approval_required", "not_charged"])("returns HTTP200 for broker outcome %s", async (status) => {
    executeCall.mockResolvedValueOnce({ status });
    const response = await POST(request({ endpointId: "endpoint-1" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status });
  });

  it("returns HTTP202 when the payment is pending", async () => {
    executeCall.mockResolvedValueOnce({ status: "pending", quoteId: "quote-1" });
    const response = await POST(request({ endpointId: "endpoint-1" }));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "pending", quoteId: "quote-1" });
  });

  it("preserves safe broker failures", async () => {
    executeCall.mockRejectedValueOnce(Object.assign(new Error("upstream secret"), { status: 409, code: "agent_busy" }));
    const response = await POST(request({ endpointId: "endpoint-1" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "agent_busy" });
  });

  it("hides database and unexpected broker errors", async () => {
    findUnique.mockRejectedValueOnce(new Error(`database password=secret token=${token}`));
    const databaseResponse = await POST(request({ endpointId: "endpoint-1" }));
    expect(databaseResponse.status).toBe(500);
    expect(await databaseResponse.text()).not.toContain("secret");
    executeCall.mockRejectedValueOnce(new Error(token));
    const brokerResponse = await POST(request({ endpointId: "endpoint-1" }));
    expect(brokerResponse.status).toBe(500);
    expect(await brokerResponse.text()).not.toContain(token);
  });
});
