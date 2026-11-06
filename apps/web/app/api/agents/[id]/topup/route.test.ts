// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
const { createTopup, org } = vi.hoisted(() => ({ createTopup: vi.fn(), org: vi.fn() }));
vi.mock("@/lib/server/velo", () => ({ createTopup }));
vi.mock("@/lib/server/db", () => ({ getDb: () => ({ org: { findUnique: org } }) }));
const context = { params: Promise.resolve({ id: "agent" }) };
const request = (body: unknown = { amountStroops: "10000000" }, headers: Record<string, string> = {}) => new Request("https://settl.test/api/agents/agent/topup", { method: "POST", headers: { cookie: "settl_demo=buyer", "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); org.mockResolvedValue({ id: "buyer", role: "buyer" }); createTopup.mockResolvedValue({ checkoutUrl: "https://checkout.test/pi", sessionId: "pi" }); });
describe("buyer top-up route", () => {
  it("uses stored buyer identity, a trusted origin, and the route agent", async () => {
    const response = await POST(request({ amountStroops: "10000000", orgId: "attacker", agentId: "other", successUrl: "https://evil.test" }), context);
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ checkoutUrl: "https://checkout.test/pi", sessionId: "pi" });
    expect(createTopup).toHaveBeenCalledWith({ orgId: "buyer", agentId: "agent", amountStroops: "10000000", origin: "https://settl.test" });
  });
  it.each(["", "settl_demo=provider"])("rejects unauthorized cookies %s", async (cookie) => {
    expect((await POST(request(undefined, { cookie }), context)).status).toBe(401); expect(createTopup).not.toHaveBeenCalled();
  });
  it("rejects cross-origin and non-JSON writes", async () => {
    expect((await POST(request(undefined, { origin: "https://evil.test" }), context)).status).toBe(403);
    expect((await POST(request(undefined, { "content-type": "text/plain" }), context)).status).toBe(400); expect(createTopup).not.toHaveBeenCalled();
  });
  it("rejects malformed JSON and hides service error details", async () => {
    expect((await POST(new Request("https://settl.test", { method: "POST", headers: { cookie: "settl_demo=buyer", "content-type": "application/json" }, body: "{" }), context)).status).toBe(400);
    createTopup.mockRejectedValueOnce(new Error("secret credential")); const response = await POST(request(), context);
    expect(response.status).toBe(500); expect(await response.text()).not.toContain("secret");
  });
});
