// @vitest-environment node

import { Server } from "node:http";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { receiptFixtures } from "../src/fixtures.js";
import hostedApp, { createApp } from "../src/server.js";

const quoteId = "00000000-0000-4000-8000-000000000001";
const reservationId = "00000000-0000-4000-8000-000000000002";
const txHash = "a".repeat(64);
const apiUrl = "http://settl.test";
const apiKey = "provider-test-key";

function paymentHeader(proof: object): string {
  return Buffer.from(JSON.stringify(proof)).toString("base64");
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function paidReceipt() {
  return { quoteId, status: "paid", amountStroops: "1333334", txHash, checks: [] };
}

function quote(endpointId: string, mode: "outcome" | "per-call") {
  return {
    settl: "0.1",
    quoteId,
    mode,
    network: "stellar:testnet",
    asset: "native",
    amountStroops: "1333334",
    displayPrice: { currency: "PHP", amount: "2.00" },
    merchant: "merchant",
    escrowContract: "escrow",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    resource: endpointId === "geoph_lookup" ? "POST /lookup" : "POST /parse-receipt",
    description: "Deterministic Resibo demo",
    ...(mode === "outcome"
      ? {
          criteria: {
            schema: "resibo.receipt.v1",
            minConfidence: 0.85,
            required: ["merchant_name", "date", "total", "line_items"],
            lineItemsSumToTotal: { tolerance: 0.01 },
          },
        }
      : {}),
  };
}

describe("Resibo receipt fixtures", () => {
  it("provides a clean receipt whose line items equal its total", () => {
    const receipt = receiptFixtures.clean;

    expect(receipt.confidence).toBe(0.98);
    expect(receipt.date).toBe("2026-11-05");
    expect(receipt.total).toBe(1250.5);
    expect(receipt.line_items.map((item) => item.amount)).toEqual([1000, 250.5]);
    expect(receipt.line_items.reduce((sum, item) => sum + item.amount, 0)).toBe(
      receipt.total,
    );
  });

  it("provides a blurry receipt below the confidence threshold", () => {
    expect(receiptFixtures.blurry.confidence).toBe(0.42);
    expect(receiptFixtures.blurry.total).toBe(1250.5);
  });

  it("provides a wrong-total receipt whose items sum to 200 instead of 500", () => {
    const receipt = receiptFixtures.wrong_total;

    expect(receipt.confidence).toBe(0.98);
    expect(receipt.total).toBe(500);
    expect(receipt.line_items.reduce((sum, item) => sum + item.amount, 0)).toBe(200);
  });
});

describe("Resibo provider", () => {
  const fetchMock = vi.fn<typeof fetch>();
  const app = createApp({ apiUrl, apiKey });
  const txProof = paymentHeader({ kind: "tx", quoteId, txHash });
  const commitProof = paymentHeader({ kind: "commit", quoteId, reservationId });

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("serves a public health check from the serverless entry without payment or upstream requests", async () => {
    const response = await request(hostedApp).get("/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", service: "settl-demo-provider" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["/parse-receipt", "resibo_parse", "per-call"],
    ["/parse-receipt-pro", "resibo_pro", "per-call"],
    ["/lookup", "geoph_lookup", "per-call"],
  ] as const)("returns a payment quote for %s without proof", async (path, endpointId, mode) => {
    const paymentQuote = quote(endpointId, mode);
    fetchMock.mockResolvedValue(jsonResponse(paymentQuote));

    const response = await request(app).post(path).send({});

    expect(response.status).toBe(402);
    expect(response.body).toEqual(paymentQuote);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${apiUrl}/api/quotes`);
    expect(JSON.parse(String(init?.body))).toEqual({ endpointId });
    expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${apiKey}`);
  });

  it("rejects malformed payment proof before contacting Settl", async () => {
    const response = await request(app)
      .post("/parse-receipt")
      .set("X-PAYMENT", "not-a-base64-proof")
      .send({});

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.body).not.toHaveProperty("stack");
  });

  it.each([
    ["/parse-receipt", "resibo_parse"],
    ["/parse-receipt-pro", "resibo_pro"],
  ] as const)("bills %s per call for every mock receipt quality", async (path, endpointId) => {
    for (const fixture of ["clean", "blurry", "wrong_total"] as const) {
      fetchMock.mockClear();
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, receipt: paidReceipt() }));

      const response = await request(app)
        .post(path)
        .set("X-PAYMENT", txProof)
        .send({ fixture });

      expect(response.status).toBe(200);
      expect(response.body).toEqual(receiptFixtures[fixture]);
      expect(response.headers["x-payment-receipt"]).toBeTruthy();
      expect(
        JSON.parse(Buffer.from(response.headers["x-payment-receipt"], "base64").toString()),
      ).toEqual(paidReceipt());
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe(`${apiUrl}/api/payments/verify`);
      expect(JSON.parse(String(init?.body))).toEqual({
        endpointId,
        proof: { kind: "tx", quoteId, txHash },
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it("defaults to the clean fixture when none is selected", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, receipt: paidReceipt() }));

    const response = await request(app)
      .post("/parse-receipt")
      .set("X-PAYMENT", txProof)
      .send({});

    expect(response.status).toBe(200);
    expect(response.body).toEqual(receiptFixtures.clean);
  });

  it("does not return provider data for an unverified transaction", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: false, error: "payment_not_verified" }));

    const response = await request(app)
      .post("/parse-receipt-pro")
      .set("X-PAYMENT", txProof)
      .send({});

    expect(response.status).toBe(402);
    expect(response.body).not.toHaveProperty("merchant_name");
  });

  it.each([
    ["clean", "pass", "paid", "1333334"],
    ["blurry", "fail", "not_charged", "0"],
    ["wrong_total", "fail", "not_charged", "0"],
  ] as const)(
    "settles the %s outcome before returning the receipt fixture",
    async (fixture, verification, status, amountStroops) => {
      const settlementReceipt = {
        quoteId,
        status,
        amountStroops,
        checks: [{ check: "demo_result", ok: verification === "pass", note: fixture }],
        ...(status === "paid" ? { txHash } : {}),
      };
      fetchMock.mockImplementation(async (input, init) => {
        expect(input).toBe(`${apiUrl}/api/verify`);
        const body = JSON.parse(String(init?.body));
        if (body.checkOnly === true) {
          expect(body).toEqual({ quoteId, reservationId, endpointId: "resibo_parse", checkOnly: true });
          return jsonResponse({ ok: true, quoteId, reservationId });
        }
        expect(body).toEqual({
          quoteId,
          reservationId,
          endpointId: "resibo_parse",
          result: receiptFixtures[fixture],
        });
        return jsonResponse({ verification, receipt: settlementReceipt });
      });

      const response = await request(app)
        .post("/parse-receipt")
        .set("X-PAYMENT", commitProof)
        .send({ fixture });

      expect(response.status).toBe(200);
      expect(response.body).toEqual(receiptFixtures[fixture]);
      expect(response.headers["x-payment-receipt"]).toBeTruthy();
      expect(
        JSON.parse(Buffer.from(response.headers["x-payment-receipt"], "base64").toString()),
      ).toEqual(settlementReceipt);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it("refuses an invalid reservation without exposing the outcome", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: false, error: "reservation_not_held" }));

    const response = await request(app)
      .post("/parse-receipt")
      .set("X-PAYMENT", commitProof)
      .send({});

    expect(response.status).toBe(402);
    expect(response.body).not.toHaveProperty("merchant_name");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not return an outcome while settlement is pending", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: true, quoteId, reservationId }))
      .mockResolvedValueOnce(jsonResponse({ verification: "pending" }, 202));

    const response = await request(app)
      .post("/parse-receipt")
      .set("X-PAYMENT", commitProof)
      .send({});

    expect(response.status).toBe(502);
    expect(response.body).not.toHaveProperty("merchant_name");
    expect(response.body).not.toHaveProperty("stack");
  });

  it("returns a deterministic geography sample after payment verification", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, receipt: paidReceipt() }));

    const response = await request(app)
      .post("/lookup")
      .set("X-PAYMENT", txProof)
      .send({});

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      country: "Philippines",
      region: "National Capital Region",
      city: "Makati",
      postal_code: "1226",
      latitude: 14.5547,
      longitude: 121.0244,
    });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String(init?.body)).endpointId).toBe("geoph_lookup");
  });

  it.each([null, [], "receipt", 42, { fixture: "missing" }, { fixture: null }])(
    "rejects invalid receipt input %j before contacting Settl",
    async (body) => {
      const response = await request(app)
        .post("/parse-receipt")
        .set("Content-Type", "application/json")
        .send(JSON.stringify(body));

      expect(response.status).toBe(400);
      expect(response.body).not.toHaveProperty("stack");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("returns a safe 400 response for malformed JSON", async () => {
    const response = await request(app)
      .post("/parse-receipt")
      .set("Content-Type", "application/json")
      .send('{"fixture":');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "invalid_json" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("bounds request bodies before contacting Settl", async () => {
    const response = await request(app)
      .post("/parse-receipt")
      .send({ extra: "x".repeat(70 * 1024) });

    expect(response.status).toBe(413);
    expect(response.body).toEqual({ error: "request_too_large" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a safe gateway error when the payment service is unavailable", async () => {
    fetchMock.mockRejectedValue(new Error("sensitive upstream detail"));

    const response = await request(app).post("/parse-receipt").send({});

    expect(response.status).toBe(502);
    expect(JSON.stringify(response.body)).not.toContain("sensitive upstream detail");
    expect(response.body).not.toHaveProperty("stack");
  });

  it("does not start an HTTP listener when its module is imported", async () => {
    vi.resetModules();
    const listen = vi.spyOn(Server.prototype, "listen");

    const provider = await import("../src/server.js");

    expect(provider.createApp).toBeTypeOf("function");
    expect(listen).not.toHaveBeenCalled();
  });
});
