// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodePaymentHeader, type Quote, type Receipt } from "@settl/core";
import { withSettl } from "../src/index";

const txHash = "a".repeat(64);
const quote: Quote = {
  settl: "0.1", quoteId: "q_1", mode: "per-call", network: "stellar:testnet",
  asset: "native", amountStroops: "1333334", displayPrice: { currency: "PHP", amount: "2.00" },
  merchant: "merchant", escrowContract: "escrow", expiresAt: "2026-11-06T00:00:00Z",
  resource: "POST /parse-receipt", description: "Parse one receipt",
};
const paid: Receipt = { quoteId: "q_1", status: "paid", amountStroops: "1333334", txHash };
const notCharged: Receipt = { quoteId: "q_1", status: "not_charged", amountStroops: "0" };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const withPayment = (value?: string) => new Request("https://provider.test/parse-receipt", {
  method: "POST", headers: value === undefined ? {} : { "x-payment": value }, body: "{}",
});
const txHeader = encodePaymentHeader({ kind: "tx", quoteId: "q_1", txHash });
const commitHeader = encodePaymentHeader({ kind: "commit", quoteId: "q_1", reservationId: "r_1" });
const decodeReceipt = (response: Response) =>
  JSON.parse(Buffer.from(response.headers.get("x-payment-receipt") ?? "", "base64").toString("utf8"));

describe("withSettl (Fetch API adapter)", () => {
  const gateway = vi.fn<typeof fetch>();
  const handler = vi.fn();
  const options = { endpointId: "ep_1", apiUrl: "https://settl.test", apiKey: "provider-key" };

  beforeEach(() => {
    vi.stubGlobal("fetch", gateway);
    handler.mockResolvedValue(json({ merchant: "Mara's Store", total: 120 }));
  });
  afterEach(() => {
    gateway.mockReset();
    handler.mockReset();
    vi.unstubAllGlobals();
  });

  it("answers an unpaid request with the gateway's validated 402 quote and never runs the handler", async () => {
    gateway.mockResolvedValue(json(quote));
    const response = await withSettl(handler, options)(withPayment());
    expect(response.status).toBe(402);
    expect(await response.json()).toEqual(quote);
    expect(gateway).toHaveBeenCalledWith("https://settl.test/api/quotes", expect.objectContaining({
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer provider-key" },
      body: JSON.stringify({ endpointId: "ep_1" }),
    }));
    expect(handler).not.toHaveBeenCalled();
  });

  it("verifies a transaction proof against the endpoint, then runs the handler with the receipt and adds the receipt header", async () => {
    gateway.mockResolvedValue(json({ ok: true, receipt: paid }));
    const response = await withSettl(handler, options)(withPayment(txHeader));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ merchant: "Mara's Store", total: 120 });
    expect(decodeReceipt(response)).toEqual(paid);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][1]).toEqual({ receipt: paid });
    expect(JSON.parse(String(gateway.mock.calls[0][1]?.body))).toEqual({
      proof: { kind: "tx", quoteId: "q_1", txHash }, endpointId: "ep_1",
    });
  });

  it("hands the framework's own route context to the handler", async () => {
    gateway.mockResolvedValue(json({ ok: true, receipt: paid }));
    const routeContext = { params: Promise.resolve({ id: "7" }) };
    await withSettl(handler, options)(withPayment(txHeader), routeContext);
    expect(handler.mock.calls[0][1]).toEqual({ receipt: paid, context: routeContext });
  });

  it("returns 402 with the gateway's rejection reason and does not run the handler", async () => {
    gateway.mockResolvedValue(json({ ok: false, error: "quote_expired" }));
    const response = await withSettl(handler, options)(withPayment(txHeader));
    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({ error: "quote_expired" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects a malformed payment header with 400", async () => {
    const response = await withSettl(handler, options)(withPayment("not-a-header"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid payment header" });
    expect(gateway).not.toHaveBeenCalled();
  });

  it("returns a generic 502 when the gateway is unreachable or answers with an invalid body", async () => {
    gateway.mockRejectedValueOnce(new Error("secret network detail"));
    const unreachable = await withSettl(handler, options)(withPayment(txHeader));
    expect(unreachable.status).toBe(502);
    expect(await unreachable.json()).toEqual({ error: "Payment service unavailable" });

    gateway.mockResolvedValueOnce(json({ ok: true, receipt: { ...paid, txHash: "b".repeat(64) } }));
    const mismatch = await withSettl(handler, options)(withPayment(txHeader));
    expect(mismatch.status).toBe(502);
    expect(handler).not.toHaveBeenCalled();
  });

  it("lets handler errors propagate to the framework", async () => {
    gateway.mockResolvedValue(json({ ok: true, receipt: paid }));
    handler.mockRejectedValue(new Error("handler failed"));
    await expect(withSettl(handler, options)(withPayment(txHeader))).rejects.toThrow("handler failed");
  });

  it("keeps working when the handler returns a response with immutable headers", async () => {
    gateway.mockResolvedValue(json({ ok: true, receipt: paid }));
    handler.mockResolvedValue(await fetchLike());
    const response = await withSettl(handler, options)(withPayment(txHeader));
    expect(decodeReceipt(response)).toEqual(paid);
  });

  describe("outcome billing", () => {
    it("holds the reservation, runs the handler, settles on the exact output and returns it with a paid receipt", async () => {
      gateway
        .mockResolvedValueOnce(json({ ok: true, quoteId: "q_1", reservationId: "r_1" }))
        .mockResolvedValueOnce(json({ verification: "pass", receipt: paid }));
      const response = await withSettl(handler, options)(withPayment(commitHeader));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ merchant: "Mara's Store", total: 120 });
      expect(decodeReceipt(response)).toEqual(paid);
      const [preflight, settlement] = gateway.mock.calls.map((call) => JSON.parse(String(call[1]?.body)));
      expect(preflight).toEqual({ quoteId: "q_1", reservationId: "r_1", endpointId: "ep_1", checkOnly: true });
      expect(settlement).toEqual({ quoteId: "q_1", reservationId: "r_1", endpointId: "ep_1", result: { merchant: "Mara's Store", total: 120 } });
    });

    it("still returns the output with a not-charged receipt when checks fail", async () => {
      gateway
        .mockResolvedValueOnce(json({ ok: true, quoteId: "q_1", reservationId: "r_1" }))
        .mockResolvedValueOnce(json({ verification: "fail", receipt: notCharged }));
      const response = await withSettl(handler, options)(withPayment(commitHeader));
      expect(response.status).toBe(200);
      expect(decodeReceipt(response)).toEqual(notCharged);
    });

    it("does not run the handler when the reservation is refused", async () => {
      gateway.mockResolvedValueOnce(json({ ok: false, error: "reservation_expired" }));
      const response = await withSettl(handler, options)(withPayment(commitHeader));
      expect(response.status).toBe(402);
      expect(await response.json()).toEqual({ error: "reservation_expired" });
      expect(handler).not.toHaveBeenCalled();
    });

    it("returns 502 and withholds the output when settlement cannot be confirmed", async () => {
      gateway
        .mockResolvedValueOnce(json({ ok: true, quoteId: "q_1", reservationId: "r_1" }))
        .mockRejectedValueOnce(new Error("chain timeout"));
      const response = await withSettl(handler, options)(withPayment(commitHeader));
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: "Payment service unavailable" });
    });

    it("returns 502 when an outcome handler does not produce JSON", async () => {
      gateway.mockResolvedValueOnce(json({ ok: true, quoteId: "q_1", reservationId: "r_1" }));
      handler.mockResolvedValue(new Response("plain text", { status: 200, headers: { "content-type": "text/plain" } }));
      const response = await withSettl(handler, options)(withPayment(commitHeader));
      expect(response.status).toBe(502);
      expect(gateway).toHaveBeenCalledTimes(1);
    });
  });

  it("requires an endpointId or registration details", () => {
    expect(() => withSettl(handler, { endpointId: " " })).toThrow("endpointId must be a non-empty string");
  });
});

/** A Response whose headers are immutable, like one returned by fetch(). */
async function fetchLike(): Promise<Response> {
  const immutable = new Response("{\"ok\":true}", { status: 200, headers: { "content-type": "application/json" } });
  Object.defineProperty(immutable.headers, "set", { value: () => { throw new TypeError("immutable"); } });
  return immutable;
}
