// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  provider: { findUnique: vi.fn(), create: vi.fn() },
  endpoint: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  org: { create: vi.fn() },
  providerSettings: { create: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("../db", () => ({ getDb: () => db }));

import { handleRegister } from "./register";

const body = {
  providerId: "acme", name: "Receipt OCR", route: "/v1/ocr", url: "https://acme.test/v1/ocr", pricePhp: "2.00", mode: "per_call",
};
const request = (payload: unknown = body, authorization: string | null = "Bearer provider-test-secret") => new Request("https://settl.test/api/provider/register", {
  method: "POST",
  headers: { "content-type": "application/json", ...(authorization === null ? {} : { authorization }) },
  body: JSON.stringify(payload),
});
const stored = { id: "ep_1", name: "Receipt OCR", url: "https://acme.test/v1/ocr", price: 1_333_334n };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SETTL_PROVIDER_KEY", "provider-test-secret");
  vi.stubEnv("PHP_PER_XLM", "15");
  vi.stubEnv("SETTL_PROVIDER_ALLOWED_ORIGINS", "https://acme.test");
  vi.stubEnv("WALLET_ENC_KEY", "a".repeat(64));
  db.provider.findUnique.mockResolvedValue({ id: "acme" });
  db.endpoint.findUnique.mockResolvedValue(null);
  db.endpoint.create.mockResolvedValue({ id: "ep_new" });
  db.$transaction.mockImplementation(async (run: (tx: typeof db) => unknown) => run(db));
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/provider/register", () => {
  it("requires the provider credential", async () => {
    expect((await handleRegister(request(body, null))).status).toBe(401);
    expect((await handleRegister(request(body, "Bearer wrong"))).status).toBe(401);
    expect(db.endpoint.create).not.toHaveBeenCalled();
  });

  it("creates a per-call endpoint priced in stroops from the peso price", async () => {
    const response = await handleRegister(request());
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ endpointId: "ep_new", created: true, drift: [] });
    expect(db.endpoint.create).toHaveBeenCalledWith({ data: {
      providerId: "acme", name: "Receipt OCR", method: "POST", route: "/v1/ocr", url: "https://acme.test/v1/ocr", price: 1_333_334n, mode: "per_call",
    } });
  });

  it.each([
    ["a non-per-call mode", { mode: "outcome" }],
    ["a zero price", { pricePhp: "0.00" }],
    ["a price with too many decimals", { pricePhp: "1.234" }],
    ["a malformed provider id", { providerId: "../etc" }],
    ["a route with a query", { route: "/v1/ocr?x=1" }],
    ["a non-http URL", { url: "ftp://acme.test/v1/ocr" }],
    ["a URL with credentials", { url: "https://u:p@acme.test/v1/ocr" }],
    ["an empty name", { name: " " }],
  ])("rejects %s", async (_label, change) => {
    const response = await handleRegister(request({ ...body, ...change }));
    expect(response.status).toBe(400);
    expect(db.endpoint.create).not.toHaveBeenCalled();
  });

  it("only registers origins the operator allows", async () => {
    const response = await handleRegister(request({ ...body, url: "https://evil.test/v1/ocr" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "provider_origin_not_allowed" });
  });

  it("does not create providers on a real gateway", async () => {
    db.provider.findUnique.mockResolvedValue(null);
    const response = await handleRegister(request());
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "provider_not_found" });
    expect(db.org.create).not.toHaveBeenCalled();
  });

  it("returns the existing endpoint unchanged when the same route is registered again", async () => {
    db.endpoint.findUnique.mockResolvedValue(stored);
    const response = await handleRegister(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ endpointId: "ep_1", created: false, drift: [] });
    expect(db.endpoint.create).not.toHaveBeenCalled();
  });

  it("reports drift instead of changing an existing endpoint", async () => {
    db.endpoint.findUnique.mockResolvedValue({ ...stored, name: "Old name", price: 2_000_000n, url: "https://acme.test/other" });
    const response = await handleRegister(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ endpointId: "ep_1", created: false, drift: ["name", "price", "url"] });
  });

  it("recovers when two instances register the same route at once", async () => {
    db.endpoint.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(stored);
    db.endpoint.create.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));
    const response = await handleRegister(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ endpointId: "ep_1", created: false, drift: [] });
  });

  describe("service metadata", () => {
    const metadata = {
      description: "Reads a receipt and returns the total.",
      inputSchema: { type: "object", properties: { image: { type: "string" } }, required: ["image"] },
      example: { image: "receipt.jpg" },
    };

    it("stores a description, input schema and example with a new endpoint", async () => {
      const response = await handleRegister(request({ ...body, ...metadata }));
      expect(response.status).toBe(201);
      expect(db.endpoint.create).toHaveBeenCalledWith({ data: expect.objectContaining(metadata) });
    });

    it.each([
      ["description", { description: "x".repeat(501) }, "invalid_description"],
      ["inputSchema", { inputSchema: { type: "array" } }, "invalid_input_schema"],
      ["example", { inputSchema: metadata.inputSchema, example: { image: 7 } }, "invalid_example"],
    ])("rejects invalid %s with a code that names it", async (_field, change, code) => {
      const response = await handleRegister(request({ ...body, ...change }));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: code });
      expect(db.endpoint.create).not.toHaveBeenCalled();
    });

    it("fills metadata an existing endpoint does not have yet, without touching price or URL", async () => {
      db.endpoint.findUnique.mockResolvedValue({ ...stored, description: null, inputSchema: null, example: null });
      const response = await handleRegister(request({ ...body, ...metadata }));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ endpointId: "ep_1", created: false, drift: [], filled: ["description", "inputSchema", "example"] });
      expect(db.endpoint.update).toHaveBeenCalledWith({ where: { id: "ep_1" }, data: metadata });
    });

    it("reports different metadata as drift and never overwrites it", async () => {
      db.endpoint.findUnique.mockResolvedValue({ ...stored, description: "Older text", inputSchema: metadata.inputSchema, example: null });
      const response = await handleRegister(request({ ...body, description: metadata.description, inputSchema: metadata.inputSchema }));
      expect(await response.json()).toEqual({ endpointId: "ep_1", created: false, drift: ["description"] });
      expect(db.endpoint.update).not.toHaveBeenCalled();
    });

    it("treats the same schema with keys in another order as unchanged, as Postgres jsonb stores it", async () => {
      db.endpoint.findUnique.mockResolvedValue({ ...stored, description: null, example: null,
        inputSchema: { required: ["image"], type: "object", properties: { image: { type: "string" } } } });
      expect(await (await handleRegister(request({ ...body, inputSchema: metadata.inputSchema }))).json())
        .toEqual({ endpointId: "ep_1", created: false, drift: [] });
    });

    it("does not report drift for metadata the caller did not send", async () => {
      db.endpoint.findUnique.mockResolvedValue({ ...stored, description: "Set in the dashboard", inputSchema: null, example: null });
      expect(await (await handleRegister(request())).json()).toEqual({ endpointId: "ep_1", created: false, drift: [] });
    });
  });

  describe("in the sandbox", () => {
    it("creates the provider on first use and accepts any origin", async () => {
      db.provider.findUnique.mockResolvedValue(null);
      db.org.create.mockResolvedValue({ id: "org_provider_acme", walletPublic: "GACME" });
      const response = await handleRegister(request({ ...body, url: "http://localhost:9000/v1/ocr" }), { sandbox: true });
      expect(response.status).toBe(201);
      expect(db.org.create).toHaveBeenCalledWith({ data: expect.objectContaining({ id: "org_provider_acme", name: "acme", role: "provider", email: "acme@sandbox.invalid" }) });
      expect(db.provider.create).toHaveBeenCalledWith({ data: expect.objectContaining({ id: "acme", orgId: "org_provider_acme", displayName: "acme", merchantWallet: "GACME" }) });
      expect(db.providerSettings.create).toHaveBeenCalled();
      expect(db.endpoint.create).toHaveBeenCalledWith({ data: expect.objectContaining({ url: "http://localhost:9000/v1/ocr" }) });
    });
  });
});
