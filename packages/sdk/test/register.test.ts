// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import type { Quote } from "@settl/core";
import { registerEndpoint, settl, withSettl } from "../src/index";

const quote: Quote = {
  settl: "0.1", quoteId: "q_9", mode: "per-call", network: "stellar:testnet",
  asset: "native", amountStroops: "1333334", displayPrice: { currency: "PHP", amount: "2.00" },
  merchant: "merchant", escrowContract: "escrow", expiresAt: "2026-11-06T00:00:00Z",
  resource: "POST /v1/ocr", description: "Receipt OCR",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const bodyOf = (call: Parameters<typeof fetch> | undefined) => JSON.parse(String(call?.[1]?.body));
const unpaid = () => new Request("https://acme.test/v1/ocr", { method: "POST", body: "{}" });

const registration = {
  provider: "acme", name: "Receipt OCR", price: "2.00", url: "https://acme.test/v1/ocr",
  apiUrl: "https://settl.test", apiKey: "provider-key",
};

describe("endpoint auto-registration", () => {
  const gateway = vi.fn<typeof fetch>();
  beforeEach(() => { vi.stubGlobal("fetch", gateway); });
  afterEach(() => { gateway.mockReset(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("registers the endpoint once, then quotes with the returned id", async () => {
    gateway
      .mockResolvedValueOnce(json({ endpointId: "ep_auto", created: true }, 201))
      .mockImplementation(async () => json(quote));
    const guarded = withSettl(vi.fn(), registration);
    expect((await guarded(unpaid())).status).toBe(402);
    expect((await guarded(unpaid())).status).toBe(402);

    expect(gateway.mock.calls[0][0]).toBe("https://settl.test/api/provider/register");
    expect(bodyOf(gateway.mock.calls[0])).toEqual({
      providerId: "acme", name: "Receipt OCR", route: "/v1/ocr", url: "https://acme.test/v1/ocr", pricePhp: "2.00", mode: "per_call",
    });
    expect(gateway.mock.calls[0][1]?.headers).toMatchObject({ Authorization: "Bearer provider-key" });
    expect(gateway.mock.calls.filter((call) => String(call[0]).endsWith("/api/provider/register"))).toHaveLength(1);
    expect(bodyOf(gateway.mock.calls[1])).toEqual({ endpointId: "ep_auto" });
    expect(bodyOf(gateway.mock.calls[2])).toEqual({ endpointId: "ep_auto" });
  });

  it("answers 502 when registration fails and tries again on the next request", async () => {
    gateway
      .mockRejectedValueOnce(new Error("gateway down"))
      .mockResolvedValueOnce(json({ endpointId: "ep_auto", created: false }))
      .mockImplementation(async () => json(quote));
    const guarded = withSettl(vi.fn(), registration);
    const failed = await guarded(unpaid());
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ error: "Payment service unavailable" });
    expect((await guarded(unpaid())).status).toBe(402);
  });

  it("warns when the registered terms differ from this code, and keeps the registered terms", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    gateway
      .mockResolvedValueOnce(json({ endpointId: "ep_auto", created: false, drift: ["price"] }))
      .mockImplementation(async () => json(quote));
    const guarded = withSettl(vi.fn(), registration);
    await guarded(unpaid());
    await guarded(unpaid());
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/price/);
    expect(String(warn.mock.calls[0][0])).toMatch(/dashboard/i);
  });

  it("can register at boot and returns the endpoint id", async () => {
    gateway.mockResolvedValueOnce(json({ endpointId: "ep_boot", created: true }, 201));
    await expect(registerEndpoint(registration)).resolves.toBe("ep_boot");
  });

  it("lets either adapter register on demand without a second registration on the first request", async () => {
    gateway
      .mockResolvedValueOnce(json({ endpointId: "ep_ready", created: true }, 201))
      .mockImplementation(async () => json(quote));
    const fetchStyle = withSettl(vi.fn(), registration);
    await expect(fetchStyle.register()).resolves.toBe("ep_ready");
    await fetchStyle(unpaid());
    expect(gateway.mock.calls.filter((call) => String(call[0]).endsWith("/api/provider/register"))).toHaveLength(1);

    gateway.mockReset();
    gateway.mockResolvedValueOnce(json({ endpointId: "ep_express_ready", created: false }));
    await expect(settl(registration).register()).resolves.toBe("ep_express_ready");
  });

  it("resolves register() to a known endpoint id without calling the gateway", async () => {
    await expect(settl({ endpointId: "ep_known", apiUrl: "https://settl.test" }).register()).resolves.toBe("ep_known");
    await expect(withSettl(vi.fn(), { endpointId: "ep_known", apiUrl: "https://settl.test" }).register()).resolves.toBe("ep_known");
    expect(gateway).not.toHaveBeenCalled();
  });

  it("does not register when the middleware is only created, so importing a route never touches the network", () => {
    settl(registration);
    withSettl(vi.fn(), registration);
    expect(gateway).not.toHaveBeenCalled();
  });

  it("works through the Express middleware too", async () => {
    gateway
      .mockResolvedValueOnce(json({ endpointId: "ep_express", created: true }, 201))
      .mockImplementation(async () => json(quote));
    const response = { status: vi.fn(), json: vi.fn(), setHeader: vi.fn() };
    response.status.mockReturnValue(response);
    response.json.mockReturnValue(response);
    const next = vi.fn();
    await settl(registration)({ headers: {} } as Request, response as unknown as Response, next as unknown as NextFunction);
    expect(response.status).toHaveBeenCalledWith(402);
    expect(bodyOf(gateway.mock.calls[1])).toEqual({ endpointId: "ep_express" });
  });

  it("sends the description, input schema and example agents will see", async () => {
    gateway.mockResolvedValueOnce(json({ endpointId: "ep_meta", created: true }, 201));
    const metadata = {
      description: "Reads a receipt.",
      inputSchema: { type: "object", properties: { image: { type: "string" } }, required: ["image"] },
      example: { image: "receipt.jpg" },
    };
    await registerEndpoint({ ...registration, ...metadata });
    expect(bodyOf(gateway.mock.calls[0])).toEqual({
      providerId: "acme", name: "Receipt OCR", route: "/v1/ocr", url: "https://acme.test/v1/ocr", pricePhp: "2.00", mode: "per_call", ...metadata,
    });
  });

  it("rejects metadata the gateway would refuse, when the middleware is created", () => {
    expect(() => withSettl(vi.fn(), { ...registration, description: "x".repeat(501) })).toThrow(/description/);
    expect(() => withSettl(vi.fn(), { ...registration, inputSchema: { type: "array" } })).toThrow(/inputSchema/);
    expect(() => withSettl(vi.fn(), { ...registration, inputSchema: [] as never })).toThrow(/inputSchema/);
  });

  it("rejects incomplete or unsafe registration details when the middleware is created", () => {
    expect(() => withSettl(vi.fn(), { ...registration, provider: " " })).toThrow(/provider/);
    expect(() => withSettl(vi.fn(), { ...registration, name: "" })).toThrow(/name/);
    expect(() => withSettl(vi.fn(), { ...registration, price: "two pesos" })).toThrow(/price/);
    expect(() => withSettl(vi.fn(), { ...registration, price: "0" })).toThrow(/price/);
    expect(() => withSettl(vi.fn(), { ...registration, url: "ftp://acme.test/x" })).toThrow(/url/);
    expect(() => withSettl(vi.fn(), { ...registration, url: "https://user:pw@acme.test/x" })).toThrow(/url/);
    expect(() => withSettl(vi.fn(), { ...registration, url: "https://acme.test/bad path?x=1" })).toThrow(/url/);
  });
});
