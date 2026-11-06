// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const { inspectOutcome, verifyOutcome } = vi.hoisted(() => ({ inspectOutcome: vi.fn(), verifyOutcome: vi.fn() }));
vi.mock("@/lib/server/broker", () => ({ inspectOutcome, verifyOutcome }));
vi.mock("@/lib/server/db", () => ({ getDb: vi.fn() }));
const request = (body: unknown, auth = "Bearer provider-key") => new Request("http://localhost/api/verify", {
  method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SETTL_PROVIDER_KEY", "provider-key");
  inspectOutcome.mockResolvedValue({ ok: true, quoteId: "q1", reservationId: "r1" });
  verifyOutcome.mockResolvedValue({ verification: "pass", receipt: { quoteId: "q1", status: "paid", amountStroops: "1333334", txHash: "ab".repeat(32), checks: [] } });
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/verify outcome settlement", () => {
  it("authenticates and settles the exact quote, endpoint and result", async () => {
    const result = { confidence: 0.98 };
    const response = await POST(request({ quoteId: "q1", endpointId: "resibo_parse", reservationId: "r1", result }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ verification: "pass", receipt: { status: "paid" } });
    expect(verifyOutcome).toHaveBeenCalledWith({ quoteId: "q1", endpointId: "resibo_parse", reservationId: "r1", result });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("validates the commitment before a provider handler runs", async () => {
    const response = await POST(request({ quoteId: "q1", endpointId: "resibo_parse", reservationId: "r1", checkOnly: true }));
    expect(await response.json()).toEqual({ ok: true, quoteId: "q1", reservationId: "r1" });
    expect(inspectOutcome).toHaveBeenCalledWith({ quoteId: "q1", endpointId: "resibo_parse", reservationId: "r1" });
    expect(verifyOutcome).not.toHaveBeenCalled();
  });
  it("returns verifier failure with a not-charged receipt", async () => {
    verifyOutcome.mockResolvedValue({ verification: "fail", receipt: { quoteId: "q1", status: "not_charged", amountStroops: "0", checks: [{ check: "confidence", ok: false, note: "Too blurry" }] } });
    const response = await POST(request({ quoteId: "q1", endpointId: "resibo_parse", result: null }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ verification: "fail", receipt: { status: "not_charged" } });
  });
  it("preserves uncertainty as HTTP 202", async () => {
    verifyOutcome.mockResolvedValue({ verification: "pending", quoteId: "q1", error: "submission_unknown" });
    const response = await POST(request({ quoteId: "q1", endpointId: "resibo_parse", result: {} }));
    expect(response.status).toBe(202);
  });
  it.each([{}, null, [], { quoteId: "q1", endpointId: "resibo_parse" }, { quoteId: "", endpointId: "ep", result: {} }, { quoteId: "q1", endpointId: 7, result: {} }, { quoteId: "q1", endpointId: "ep", reservationId: "", result: {} }, { quoteId: "q1", endpointId: "ep", checkOnly: "true" }])("rejects malformed input", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(verifyOutcome).not.toHaveBeenCalled();
  });
  it("fails closed without valid provider authentication", async () => {
    expect((await POST(request({}, "Bearer wrong"))).status).toBe(401);
    vi.stubEnv("SETTL_PROVIDER_KEY", "");
    expect((await POST(request({}))).status).toBe(503);
    expect(inspectOutcome).not.toHaveBeenCalled();
    expect(verifyOutcome).not.toHaveBeenCalled();
  });
  it("sanitizes internal errors", async () => {
    verifyOutcome.mockRejectedValue(new Error("private connection secret"));
    const response = await POST(request({ quoteId: "q1", endpointId: "resibo_parse", result: {} }));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("private");
  });
});
