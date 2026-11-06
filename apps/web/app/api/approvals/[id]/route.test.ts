// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
const { org, approval } = vi.hoisted(() => ({ org: vi.fn(), approval: vi.fn() }));
vi.mock("@/lib/server/db", () => ({ getDb: () => ({ org: { findUnique: org }, approval: { findFirst: approval } }) }));
const req = (cookie = "settl_demo=buyer") => new Request("https://settl.test/api/approvals/a1", { headers: { cookie } });
const ctx = { params: Promise.resolve({ id: "a1" }) };
beforeEach(() => {
  vi.stubEnv("PHP_PER_XLM", "15");
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-06T00:30:00Z"));
  org.mockReset().mockResolvedValue({ id: "org_juan", role: "buyer" });
  approval.mockReset().mockResolvedValue({ id: "a1", status: "pending", amount: 5_333_334n, quoteId: "q1", expiresAt: new Date("2026-11-06T00:35:00Z"), agent: { name: "Juan's Bookkeeper", policy: { maxAmount: 6_666_667n, autoApproveUpTo: 3_333_334n } }, provider: { displayName: "GeoPH" }, quote: { payment: null } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
describe("GET live buyer approval", () => {
  it("scopes lookup to the buyer organization and returns public money strings", async () => {
    const response = await GET(req(), ctx);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ id: "a1", status: "pending", amountPhp: "8.00", providerName: "GeoPH", agentName: "Juan's Bookkeeper", payment: null, capPhp: "10.00", autoApprovePhp: "5.00" });
    expect(approval.mock.calls[0][0].where).toEqual({ id: "a1", agent: { orgId: "org_juan" } });
  });
  it("reports expired pending approvals without a database write", async () => {
    const row = await approval(); row.expiresAt = new Date("2026-11-06T00:29:00Z");
    expect(await (await GET(req(), ctx)).json()).toMatchObject({ status: "expired" });
  });
  it("reports observed payment status and a real transaction hash", async () => {
    const row = await approval(); row.status = "approved"; row.quote.payment = { status: "paid", txHash: "ab".repeat(32) };
    expect(await (await GET(req(), ctx)).json()).toMatchObject({ status: "approved", payment: { status: "paid", txHash: "ab".repeat(32) } });
  });
  it("returns 404 for another organization's approval and 401 for unauthenticated callers", async () => {
    approval.mockResolvedValue(null);
    expect((await GET(req(), ctx)).status).toBe(404);
    expect((await GET(req(""), ctx)).status).toBe(401);
  });
});
