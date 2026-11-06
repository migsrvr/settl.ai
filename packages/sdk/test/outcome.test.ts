// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response as ExpressResponse } from "express";
import { encodePaymentHeader } from "@settl/core";
import { settl } from "../src/index";

const proof = { kind: "commit" as const, quoteId: "q1", reservationId: "r1" };
const result = { merchant_name: "Demo", date: "2026-11-05", total: 200, confidence: 0.98, line_items: [{ description: "Service", amount: 200 }] };
const paid = { quoteId: "q1", status: "paid", amountStroops: "1333334", txHash: "ab".repeat(32), checks: [{ check: "confidence", ok: true, note: "Passed" }] };

function context() {
  const req = { headers: { "x-payment": encodePaymentHeader(proof) } } as unknown as Request;
  const res = { json: vi.fn(), status: vi.fn(), setHeader: vi.fn() };
  res.json.mockReturnValue(res); res.status.mockReturnValue(res);
  return { req, res, next: vi.fn(() => (res as unknown as ExpressResponse).json(result)) as unknown as NextFunction };
}
beforeEach(() => { vi.stubEnv("SETTL_API_URL", "http://localhost:3000"); vi.stubEnv("SETTL_PROVIDER_KEY", ""); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("SDK outcome commitments", () => {
  it("checks the hold, verifies actual output, then returns the original JSON and paid receipt", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ ok: true, quoteId: "q1", reservationId: "r1" }))
      .mockResolvedValueOnce(Response.json({ verification: "pass", receipt: paid }));
    vi.stubGlobal("fetch", fetcher);
    const c = context(); const send = c.res.json;
    await settl({ endpointId: "resibo_parse", apiKey: "key" })(c.req, c.res as unknown as ExpressResponse, c.next);
    expect(fetcher).toHaveBeenNthCalledWith(1, "http://localhost:3000/api/verify", expect.objectContaining({ body: JSON.stringify({ quoteId: "q1", reservationId: "r1", endpointId: "resibo_parse", checkOnly: true }) }));
    expect(fetcher).toHaveBeenNthCalledWith(2, "http://localhost:3000/api/verify", expect.objectContaining({ body: JSON.stringify({ quoteId: "q1", reservationId: "r1", endpointId: "resibo_parse", result }) }));
    expect(send).toHaveBeenCalledWith(result);
    expect(c.res.setHeader).toHaveBeenCalledWith("X-PAYMENT-RECEIPT", Buffer.from(JSON.stringify(paid)).toString("base64"));
  });
  it("returns failed output with a not-charged receipt", async () => {
    const receipt = { quoteId: "q1", status: "not_charged", amountStroops: "0", checks: [{ check: "confidence", ok: false, note: "Too blurry" }] };
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ ok: true, quoteId: "q1", reservationId: "r1" })).mockResolvedValueOnce(Response.json({ verification: "fail", receipt })));
    const c = context(); const send = c.res.json;
    await settl({ endpointId: "resibo_parse", apiKey: "key" })(c.req, c.res as unknown as ExpressResponse, c.next);
    expect(send).toHaveBeenCalledWith(result);
    expect(c.req.settlReceipt).toEqual(receipt);
  });
  it("does not execute the provider when the reservation is refused", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: false, error: "reservation_expired" })));
    const c = context();
    await settl({ endpointId: "resibo_parse", apiKey: "key" })(c.req, c.res as unknown as ExpressResponse, c.next);
    expect(c.res.status).toHaveBeenCalledWith(402);
    expect(c.next).not.toHaveBeenCalled();
  });
  it.each([
    { verification: "pending", quoteId: "q1" },
    { verification: "pass", receipt: { ...paid, quoteId: "other" } },
    { verification: "pass", receipt: { ...paid, status: "not_charged" } },
  ])("does not deliver output for unknown or mismatched settlement", async (body) => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ ok: true, quoteId: "q1", reservationId: "r1" })).mockResolvedValueOnce(Response.json(body)));
    const c = context(); const send = c.res.json;
    await settl({ endpointId: "resibo_parse", apiKey: "key" })(c.req, c.res as unknown as ExpressResponse, c.next);
    expect(c.res.status).toHaveBeenCalledWith(502);
    expect(send).not.toHaveBeenCalledWith(result);
  });
});
