// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
const { org, provider, claim } = vi.hoisted(() => ({ org: vi.fn(), provider: vi.fn(), claim: vi.fn() }));
vi.mock("@/lib/server/db", () => ({ getDb: () => ({ org: { findUnique: org }, provider: { findUnique: provider } }) }));
vi.mock("@/lib/server/claims", () => ({ claimProvider: claim }));
const req = (cookie = "settl_demo=provider") => new Request("https://settl.test/api/provider/claim", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: "{}" });
beforeEach(() => { vi.resetAllMocks(); org.mockResolvedValue({ id: "seller", role: "provider" }); provider.mockResolvedValue({ id: "resibo" }); claim.mockResolvedValue({ status: "completed", providerId: "resibo", txHash: "ab".repeat(32) }); });
afterEach(() => vi.restoreAllMocks());
describe("provider manual claim", () => {
  it("uses only the signed-in provider organization and requests a manual claim", async () => {
    expect((await POST(req())).status).toBe(200);
    expect(provider).toHaveBeenCalledWith({ where: { orgId: "seller" }, select: { id: true } });
    expect(claim).toHaveBeenCalledWith("resibo", { manual: true });
  });
  it("returns pending without initiating a replacement claim", async () => { claim.mockResolvedValue({ status: "pending", providerId: "resibo" }); expect((await POST(req())).status).toBe(202); });
  it("rejects buyer sessions and does not disclose database failures", async () => { expect((await POST(req("settl_demo=buyer"))).status).toBe(401); provider.mockRejectedValue(new Error("private secret")); const response = await POST(req()); expect(response.status).toBe(500); expect(await response.text()).not.toContain("private"); });
});
