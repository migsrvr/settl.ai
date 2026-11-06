// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const { createQuote } = vi.hoisted(() => ({ createQuote: vi.fn() }));
vi.mock("@/lib/server/broker", () => ({ createQuote }));
vi.mock("@/lib/server/db", () => ({ getDb: vi.fn() }));

const quote = {
  settl: "0.1", quoteId: "quote-1", mode: "per-call", network: "stellar:testnet", asset: "native",
  amountStroops: "2000000", displayPrice: { currency: "PHP", amount: "2.00" }, merchant: "merchant",
  escrowContract: "escrow", expiresAt: "2026-11-06T00:00:00Z", resource: "https://provider.test/parse", description: "Parse receipt",
};
const request = (body: unknown, authorization = "Bearer provider-test-secret") => new Request("https://settl.test/api/quotes", {
  method: "POST", headers: { authorization, "content-type": "application/json" }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SETTL_PROVIDER_KEY", "provider-test-secret");
  createQuote.mockResolvedValue(quote);
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/quotes", () => {
  it("returns the broker quote", async () => {
    const response = await POST(request({ endpointId: "endpoint-1" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(quote);
    expect(createQuote).toHaveBeenCalledWith({ endpointId: "endpoint-1" });
  });

  it("forwards the optional validated agent hints", async () => {
    const agentHint = { agentId: "agent-1", agent: "GAGENT", deviceHash: "device-1" };
    await POST(request({ endpointId: "endpoint-1", agentHint }));
    expect(createQuote).toHaveBeenCalledWith({ endpointId: "endpoint-1", agentHint });
  });

  it.each([{}, { endpointId: 4 }, { endpointId: " " }, { endpointId: "endpoint-1", agentHint: null },
    { endpointId: "endpoint-1", agentHint: [] }, { endpointId: "endpoint-1", agentHint: { agent: 4 } },
    { endpointId: "endpoint-1", agentHint: { deviceHash: "" } }, { endpointId: "endpoint-1", agentHint: { agentId: false } }, null, []])("rejects invalid input %s", async (body) => {
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    expect(createQuote).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", async () => {
    const response = await POST(new Request("https://settl.test/api/quotes", { method: "POST", headers: { authorization: "Bearer provider-test-secret" }, body: "{" }));
    expect(response.status).toBe(400);
    expect(createQuote).not.toHaveBeenCalled();
  });

  it.each(["", "Basic provider-test-secret", "Bearer wrong"])("rejects unauthorized callers", async (authorization) => {
    const response = await POST(request({ endpointId: "endpoint-1" }, authorization));
    expect(response.status).toBe(401);
    expect(createQuote).not.toHaveBeenCalled();
  });

  it("returns 503 when the provider key is missing", async () => {
    vi.stubEnv("SETTL_PROVIDER_KEY", "");
    const response = await POST(request({ endpointId: "endpoint-1" }));
    expect(response.status).toBe(503);
    expect(createQuote).not.toHaveBeenCalled();
  });

  it("preserves safe broker statuses", async () => {
    createQuote.mockRejectedValueOnce(Object.assign(new Error("internal details"), { status: 404, code: "endpoint_not_found" }));
    const response = await POST(request({ endpointId: "missing" }));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "endpoint_not_found" });
  });

  it("hides unexpected errors and invalid broker output", async () => {
    createQuote.mockRejectedValueOnce(new Error("provider-test-secret"));
    const response = await POST(request({ endpointId: "endpoint-1" }));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("provider-test-secret");
    createQuote.mockResolvedValueOnce({ ...quote, amountStroops: "invalid" });
    expect((await POST(request({ endpointId: "endpoint-1" }))).status).toBe(500);
  });
});
