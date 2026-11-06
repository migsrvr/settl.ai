// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { encodePaymentHeader, type Quote, type Receipt } from "@settl/core";
import { settl } from "../src/index";

const txHash = "a".repeat(64);
const proof = { kind: "tx" as const, quoteId: "q_1", txHash };
const receipt: Receipt = { quoteId: "q_1", status: "paid", amountStroops: "1333334", txHash };
const quote: Quote = {
  settl: "0.1", quoteId: "q_1", mode: "per-call", network: "stellar:testnet",
  asset: "native", amountStroops: "1333334", displayPrice: { currency: "PHP", amount: "2.00" },
  merchant: "merchant", escrowContract: "escrow", expiresAt: "2026-11-06T00:00:00Z",
  resource: "POST /parse-receipt", description: "Parse one receipt",
};

function context(payment?: string | string[]) {
  // These are the only Express members consumed by the middleware.
  const request: Pick<Request, "headers" | "settlReceipt"> = {
    headers: payment === undefined ? {} : { "x-payment": payment },
  };
  const response = {
    status: vi.fn<Response["status"]>(),
    json: vi.fn<Response["json"]>(),
    setHeader: vi.fn<Response["setHeader"]>(),
  } satisfies Pick<Response, "status" | "json" | "setHeader">;
  response.status.mockReturnValue(response as unknown as Response);
  response.json.mockReturnValue(response as unknown as Response);
  response.setHeader.mockReturnValue(response as unknown as Response);
  return { req: request as Request, res: response as unknown as Response, response, next: vi.fn() as unknown as NextFunction };
}

describe("settl provider middleware", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("SETTL_API_URL", "");
    vi.stubEnv("SETTL_PROVIDER_KEY", "");
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("requests and returns a validated 402 quote with no payment header", async () => {
    fetchMock.mockResolvedValue(ResponseJson(quote));
    const c = context();
    await settl({ endpointId: "ep_1" })(c.req, c.res, c.next);
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:3000/api/quotes", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpointId: "ep_1" }), signal: expect.any(AbortSignal),
      redirect: "error",
    });
    expect(c.response.status).toHaveBeenCalledWith(402);
    expect(c.response.json).toHaveBeenCalledWith(quote);
    expect(c.next).not.toHaveBeenCalled();
    expect(c.req.settlReceipt).toBeUndefined();
  });

  it("uses environment URL and provider bearer key for quotes", async () => {
    vi.stubEnv("SETTL_API_URL", "https://settl.example/");
    vi.stubEnv("SETTL_PROVIDER_KEY", "provider-env-key");
    fetchMock.mockResolvedValue(ResponseJson(quote));
    const c = context();
    await settl({ endpointId: "ep_1" })(c.req, c.res, c.next);
    expect(fetchMock).toHaveBeenCalledWith("https://settl.example/api/quotes", expect.objectContaining({
      headers: { "Content-Type": "application/json", Authorization: "Bearer provider-env-key" },
    }));
  });

  it("uses explicit configuration, binds verification to the endpoint, and exposes the paid receipt", async () => {
    vi.stubEnv("SETTL_API_URL", "https://unused.example");
    vi.stubEnv("SETTL_PROVIDER_KEY", "unused-key");
    fetchMock.mockResolvedValue(ResponseJson({ ok: true, receipt }));
    const c = context(encodePaymentHeader(proof));
    await settl({ endpointId: "ep_1", apiUrl: "https://settl.example/base/", apiKey: "explicit-key" })(c.req, c.res, c.next);
    expect(fetchMock).toHaveBeenCalledWith("https://settl.example/base/api/payments/verify", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer explicit-key" },
      body: JSON.stringify({ proof, endpointId: "ep_1" }), signal: expect.any(AbortSignal), redirect: "error",
    });
    expect(c.req.settlReceipt).toEqual(receipt);
    expect(c.response.setHeader).toHaveBeenCalledWith("X-PAYMENT-RECEIPT", Buffer.from(JSON.stringify(receipt), "utf8").toString("base64"));
    expect(c.next).toHaveBeenCalledExactlyOnceWith();
    expect(c.response.status).not.toHaveBeenCalled();
    expect(c.response.json).not.toHaveBeenCalled();
  });

  it("encodes receipt JSON as UTF-8 base64", async () => {
    const unicodeReceipt = { ...receipt, checks: [{ check: "résumé", ok: true, note: "₱2 paid" }] };
    fetchMock.mockResolvedValue(ResponseJson({ ok: true, receipt: unicodeReceipt }));
    const c = context(encodePaymentHeader(proof));
    await settl({ endpointId: "ep_1" })(c.req, c.res, c.next);
    const encoded = c.response.setHeader.mock.calls[0]?.[1];
    expect(typeof encoded).toBe("string");
    expect(JSON.parse(Buffer.from(encoded as string, "base64").toString("utf8"))).toEqual(unicodeReceipt);
  });

  it.each(["", "not base64", Buffer.from("{}").toString("base64"), [encodePaymentHeader(proof), encodePaymentHeader(proof)]].map((header) => ({ header })))(
    "rejects malformed payment headers without fetching: $header", async ({ header }) => {
      const c = context(header);
      await settl({ endpointId: "ep_1" })(c.req, c.res, c.next);
      expect(c.response.status).toHaveBeenCalledWith(400);
      expect(c.response.json).toHaveBeenCalledWith({ error: "Invalid payment header" });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(c.next).not.toHaveBeenCalled();
    },
  );

  it("rejects a commit when reservation preflight is refused", async () => {
    fetchMock.mockResolvedValue(ResponseJson({ ok: false, error: "reservation_expired" }));
    const c = context(encodePaymentHeader({ kind: "commit", quoteId: "q_1", reservationId: "r_1" }));
    await settl({ endpointId: "ep_1" })(c.req, c.res, c.next);
    expect(c.response.status).toHaveBeenCalledWith(402);
    expect(c.response.json).toHaveBeenCalledWith({ error: "reservation_expired" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:3000/api/verify", expect.objectContaining({ method: "POST" }));
    expect(c.next).not.toHaveBeenCalled();
  });

  it("returns 402 with the verification API's rejection reason", async () => {
    fetchMock.mockResolvedValue(ResponseJson({ ok: false, error: "payment_hash_mismatch" }));
    const c = context(encodePaymentHeader(proof));
    await settl({ endpointId: "ep_1" })(c.req, c.res, c.next);
    expect(c.response.status).toHaveBeenCalledWith(402);
    expect(c.response.json).toHaveBeenCalledWith({ error: "payment_hash_mismatch" });
    expect(c.next).not.toHaveBeenCalled();
    expect(c.req.settlReceipt).toBeUndefined();
    expect(c.response.setHeader).not.toHaveBeenCalled();
  });

  it.each([undefined, null, "", "   ", 402, { message: "rejected" }])(
    "uses a safe fallback when the API rejection reason is not a nonempty string (%j)", async (error) => {
      fetchMock.mockResolvedValue(ResponseJson({ ok: false, error }));
      const c = context(encodePaymentHeader(proof));
      await settl({ endpointId: "ep_1" })(c.req, c.res, c.next);
      expect(c.response.status).toHaveBeenCalledWith(402);
      expect(c.response.json).toHaveBeenCalledWith({ error: "Payment verification failed" });
      expect(c.next).not.toHaveBeenCalled();
      expect(c.req.settlReceipt).toBeUndefined();
      expect(c.response.setHeader).not.toHaveBeenCalled();
    },
  );

  it.each([
    null, {}, { ok: "true", receipt }, { ok: true }, { ok: true, receipt: null },
    { ok: true, receipt: { ...receipt, status: "unknown" } },
    { ok: true, receipt: { ...receipt, amountStroops: "1.5" } },
    { ok: true, receipt: { ...receipt, quoteId: "q_other" } },
    { ok: true, receipt: { ...receipt, txHash: "b".repeat(64) } },
    { ok: true, receipt: { ...receipt, txHash: undefined } },
    { ok: true, receipt: { ...receipt, status: "not_charged" } },
    { ok: true, receipt: { ...receipt, status: "blocked" } },
  ])("rejects malformed or unbound successful verification: %j", async (body) => {
    fetchMock.mockResolvedValue(ResponseJson(body));
    const c = context(encodePaymentHeader(proof));
    await settl({ endpointId: "ep_1" })(c.req, c.res, c.next);
    expect(c.response.status).toHaveBeenCalledWith(502);
    expect(c.response.json).toHaveBeenCalledWith({ error: "Payment service unavailable" });
    expect(c.next).not.toHaveBeenCalled();
    expect(c.req.settlReceipt).toBeUndefined();
    expect(c.response.setHeader).not.toHaveBeenCalled();
  });

  it.each([undefined, encodePaymentHeader(proof)])("handles non-2xx and invalid JSON safely (%j)", async (header) => {
    for (const upstream of [new globalThis.Response("secret", { status: 401 }), new globalThis.Response("invalid JSON")]) {
      fetchMock.mockResolvedValue(upstream);
      const c = context(header);
      await settl({ endpointId: "ep_1", apiKey: "secret" })(c.req, c.res, c.next);
      expect(c.response.status).toHaveBeenCalledWith(502);
      expect(c.response.json).toHaveBeenCalledWith({ error: "Payment service unavailable" });
      expect(c.next).not.toHaveBeenCalled();
    }
  });

  it("rejects an invalid quote body", async () => {
    fetchMock.mockResolvedValue(ResponseJson({ ...quote, amountStroops: "-1" }));
    const c = context();
    await settl({ endpointId: "ep_1" })(c.req, c.res, c.next);
    expect(c.response.status).toHaveBeenCalledWith(502);
    expect(c.response.json).toHaveBeenCalledWith({ error: "Payment service unavailable" });
  });

  it.each([undefined, encodePaymentHeader(proof)])("hides network failures (%j)", async (header) => {
    fetchMock.mockRejectedValue(new Error("secret API key in network error"));
    const c = context(header);
    await settl({ endpointId: "ep_1" })(c.req, c.res, c.next);
    expect(c.response.status).toHaveBeenCalledWith(502);
    expect(c.response.json).toHaveBeenCalledWith({ error: "Payment service unavailable" });
    expect(c.next).not.toHaveBeenCalled();
  });

  it.each(["fetch", "body"])("bounds the %s wait and aborts the request", async (stage) => {
    vi.useFakeTimers();
    if (stage === "fetch") {
      fetchMock.mockReturnValue(new Promise<globalThis.Response>(() => {}));
    } else {
      fetchMock.mockResolvedValue({
        ok: true, json: () => new Promise<unknown>(() => {}),
      } as globalThis.Response);
    }
    const c = context(encodePaymentHeader(proof));
    const pending = settl({ endpointId: "ep_1" })(c.req, c.res, c.next);
    await vi.advanceTimersByTimeAsync(10_000);
    await pending;
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(c.response.status).toHaveBeenCalledWith(502);
    expect(c.response.json).toHaveBeenCalledWith({ error: "Payment service unavailable" });
    expect(c.next).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the timeout after successful verification", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(ResponseJson({ ok: true, receipt }));
    const c = context(encodePaymentHeader(proof));
    await settl({ endpointId: "ep_1" })(c.req, c.res, c.next);
    expect(vi.getTimerCount()).toBe(0);
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
  });

  it("leaves downstream handler errors outside payment error handling", async () => {
    fetchMock.mockResolvedValue(ResponseJson({ ok: true, receipt }));
    const c = context(encodePaymentHeader(proof));
    const handlerError = new Error("provider handler failed");
    vi.mocked(c.next).mockImplementation(() => { throw handlerError; });
    await expect(settl({ endpointId: "ep_1" })(c.req, c.res, c.next)).rejects.toBe(handlerError);
    expect(c.response.status).not.toHaveBeenCalled();
    expect(c.response.json).not.toHaveBeenCalled();
  });

  it("allows an explicit empty API key to disable environment authentication", async () => {
    vi.stubEnv("SETTL_PROVIDER_KEY", "environment-key");
    fetchMock.mockResolvedValue(ResponseJson(quote));
    const c = context();
    await settl({ endpointId: "ep_1", apiKey: "" })(c.req, c.res, c.next);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({ "Content-Type": "application/json" });
  });

  it.each(["", "   "])("rejects an empty endpoint ID (%j) when configured", (endpointId) => {
    expect(() => settl({ endpointId })).toThrow("endpointId must be a non-empty string");
  });

  it.each(["invalid", "file:///tmp/payments", "https://user:password@settl.example"])(
    "rejects an invalid service URL (%j) when configured", (apiUrl) => {
      expect(() => settl({ endpointId: "ep_1", apiUrl })).toThrow("apiUrl must be an HTTP(S) URL without credentials, query, or fragment");
    },
  );
});

function ResponseJson(value: unknown): globalThis.Response {
  return new globalThis.Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
}
