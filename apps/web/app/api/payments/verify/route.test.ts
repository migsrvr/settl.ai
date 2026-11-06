// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const { verifyPayment } = vi.hoisted(() => ({ verifyPayment: vi.fn() }));
vi.mock("@/lib/server/broker", () => ({ verifyPayment }));
vi.mock("@/lib/server/db", () => ({ getDb: vi.fn() }));

const proof = { quoteId: "quote-1", kind: "tx", txHash: "a".repeat(64) };
const result = { ok: true, receipt: { quoteId: "quote-1", status: "paid", amountStroops: "2000000", txHash: proof.txHash } };
const request = (body: unknown, authorization = "Bearer provider-test-secret") => new Request("https://settl.test/api/payments/verify", {
  method: "POST", headers: { authorization, "content-type": "application/json" }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SETTL_PROVIDER_KEY", "provider-test-secret");
  verifyPayment.mockResolvedValue(result);
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/payments/verify", () => {
  it("returns verification JSON", async () => {
    const response = await POST(request({ proof }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(result);
    expect(verifyPayment).toHaveBeenCalledWith({ proof });
  });

  it("forwards endpoint binding for SDK verification", async () => {
    await POST(request({ proof, endpointId: "endpoint-1" }));
    expect(verifyPayment).toHaveBeenCalledWith({ proof, endpointId: "endpoint-1" });
  });

  it.each([{}, { proof: null }, { proof: [] }, { proof: { ...proof, quoteId: "" } },
    { proof: { ...proof, txHash: "abc" } }, { proof: { ...proof, txHash: "A".repeat(64) } },
    { proof: { ...proof, kind: "commit", reservationId: "reservation-1" } },
    { proof, endpointId: 4 }, { proof, endpointId: " " }, null, []])("rejects invalid proof bodies: %s", async (body) => {
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    expect(verifyPayment).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", async () => {
    const response = await POST(new Request("https://settl.test/api/payments/verify", { method: "POST", headers: { authorization: "Bearer provider-test-secret" }, body: "{" }));
    expect(response.status).toBe(400);
    expect(verifyPayment).not.toHaveBeenCalled();
  });

  it.each(["", "Bearer incorrect"])("requires the provider credential", async (authorization) => {
    expect((await POST(request({ proof }, authorization))).status).toBe(401);
    expect(verifyPayment).not.toHaveBeenCalled();
  });

  it("fails closed without a configured service key", async () => {
    vi.stubEnv("SETTL_PROVIDER_KEY", "");
    expect((await POST(request({ proof }))).status).toBe(503);
    expect(verifyPayment).not.toHaveBeenCalled();
  });

  it("returns a safe broker verification error", async () => {
    verifyPayment.mockRejectedValueOnce(Object.assign(new Error("chain details"), { status: 409, code: "payment_mismatch" }));
    const response = await POST(request({ proof }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "payment_mismatch" });
  });

  it("hides unexpected broker errors", async () => {
    verifyPayment.mockRejectedValueOnce(new Error("provider-test-secret"));
    const response = await POST(request({ proof }));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("provider-test-secret");
  });
});
