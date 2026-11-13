// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
const { org, provider, create } = vi.hoisted(() => ({ org: vi.fn(), provider: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/server/db", () => ({ getDb: () => ({ org: { findUnique: org }, provider: { findUnique: provider }, endpoint: { create } }) }));
const body = { name: "Receipt OCR", method: "POST", route: "/parse", url: "https://provider.test/parse", priceStroops: "1333334", mode: "outcome", criteriaId: "receipt_v1" };
const req = (value: unknown, cookie = "settl_demo=provider") => new Request("https://settl.test/api/provider/endpoints", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(value) });
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("SETTL_PROVIDER_ALLOWED_ORIGINS", "https://provider.test"); org.mockResolvedValue({ id: "seller", role: "provider" }); provider.mockResolvedValue({ id: "resibo" }); create.mockResolvedValue({ id: "ep" }); });
afterEach(() => vi.unstubAllEnvs());
describe("register provider endpoint", () => {
  it("binds an endpoint and canonical receipt criteria to the stored provider", async () => { expect((await POST(req({ ...body, providerId: "attacker" }))).status).toBe(201); expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ providerId: "resibo", price: 1333334n, criteriaId: "resibo.receipt.v1" }) })); });
  it.each([{ ...body, priceStroops: "-1" }, { ...body, url: "file:///secret" }, { ...body, mode: "other" }, { ...body, mode: ["per_call"] }, { ...body, mode: {} }, { ...body, criteriaId: "unknown" }, { ...body, criteriaId: ["receipt_v1"] }])("rejects invalid endpoint input", async (value) => { expect((await POST(req(value))).status).toBe(400); expect(create).not.toHaveBeenCalled(); });
  it("rejects buyer roles", async () => { expect((await POST(req(body, "settl_demo=buyer"))).status).toBe(401); });
  it("rejects server fetch destinations outside the configured provider origins", async () => { expect((await POST(req({ ...body, url: "http://169.254.169.254/metadata" }))).status).toBe(400); expect(create).not.toHaveBeenCalled(); });
});
describe("agent-facing metadata", () => {
  const metadata = { description: "Reads receipts.", inputSchema: { type: "object", properties: { image: { type: "string" } } }, example: { image: "r.jpg" } };
  it("stores a description, input schema and example", async () => {
    expect((await POST(req({ ...body, ...metadata }))).status).toBe(201);
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining(metadata) });
  });
  it.each([
    [{ description: "" }, "invalid_description"],
    [{ inputSchema: "not an object" }, "invalid_input_schema"],
    [{ inputSchema: metadata.inputSchema, example: { image: 5 } }, "invalid_example"],
  ])("rejects bad metadata with a code that names the field", async (change, code) => {
    const response = await POST(req({ ...body, ...change }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: code });
    expect(create).not.toHaveBeenCalled();
  });
});
