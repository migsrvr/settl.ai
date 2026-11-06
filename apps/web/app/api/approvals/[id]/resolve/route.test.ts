// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
const { db, flush } = vi.hoisted(() => ({ db: { org: { findUnique: vi.fn() }, approval: { findUnique: vi.fn(), updateMany: vi.fn() }, webhookEvent: { upsert: vi.fn() }, $queryRaw: vi.fn(), $transaction: vi.fn() }, flush: vi.fn() }));
vi.mock("@/lib/server/db", () => ({ getDb: () => db }));
vi.mock("@/lib/server/dispatcher", () => ({ flushAutomationEvents: flush }));
const NOW = new Date("2026-11-06T00:00:00Z");
let row: { id: string; status: string; expiresAt: Date; resolvedAt: Date | null; agentId: string; providerId: string; quoteId: string; amount: bigint; agent: { orgId: string }; provider: { orgId: string } };
const request = (decision: unknown = "approved", cookie = "settl_demo=buyer", origin?: string) => new Request("https://settl.test/api/approvals/a/resolve", { method: "POST", headers: { cookie, "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify({ decision }) });
const context = { params: Promise.resolve({ id: "a" }) };
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(NOW);
  row = { id: "a", status: "pending", expiresAt: new Date(NOW.getTime() + 60_000), resolvedAt: null, agentId: "agent", providerId: "provider", quoteId: "quote", amount: 8n, agent: { orgId: "buyer" }, provider: { orgId: "seller" } };
  db.org.findUnique.mockResolvedValue({ id: "buyer", role: "buyer" }); db.approval.findUnique.mockImplementation(async () => row);
  db.$queryRaw.mockResolvedValue([]); db.webhookEvent.upsert.mockResolvedValue({}); flush.mockResolvedValue({ processed: 1, errors: 0 });
  db.approval.updateMany.mockImplementation(async ({ where, data }: { where: { status: string }; data: object }) => { if (row.status !== where.status) return { count: 0 }; Object.assign(row, data); return { count: 1 }; });
  let queue = Promise.resolve(); db.$transaction.mockImplementation((work: (tx: typeof db) => Promise<unknown>) => { const result = queue.then(() => work(db)); queue = result.then(() => {}, () => {}); return result; });
});
afterEach(() => vi.useRealTimers());
describe("buyer approval resolution", () => {
  it.each(["approved", "declined"])("resolves %s atomically and queues both organizations after authenticating", async (decision) => {
    const response = await POST(request(decision), context); expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: "a", status: decision, resolvedAt: NOW.toISOString() });
    expect(db.$queryRaw).toHaveBeenCalled();
    expect(db.webhookEvent.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ source: "settl", eventId: "approval:a:resolved", verified: true, payload: expect.objectContaining({ event: "approval.resolved", orgIds: ["buyer", "seller"] }) }) }));
    expect(flush).not.toHaveBeenCalled();
  });
  it.each(["", "settl_demo=provider"])("rejects missing or provider sessions: %s", async (cookie) => {
    expect((await POST(request("approved", cookie), context)).status).toBe(401); expect(db.approval.updateMany).not.toHaveBeenCalled();
  });
  it("rejects agent bearer access, cross-site origins, and form submissions", async () => {
    const bearer = new Request("https://settl.test/api/approvals/a/resolve", { method: "POST", headers: { authorization: "Bearer stl_agent_example", "content-type": "application/json" }, body: JSON.stringify({ decision: "approved" }) });
    expect((await POST(bearer, context)).status).toBe(401);
    expect((await POST(request("approved", "settl_demo=buyer", "https://evil.test"), context)).status).toBe(403);
    const form = new Request("https://settl.test/api/approvals/a/resolve", { method: "POST", headers: { cookie: "settl_demo=buyer", "content-type": "text/plain" }, body: '{"decision":"approved"}' });
    expect((await POST(form, context)).status).toBe(400);
    expect(db.approval.updateMany).not.toHaveBeenCalled();
  });
  it("hides approvals belonging to another buyer and missing approvals", async () => {
    row.agent.orgId = "other"; expect((await POST(request(), context)).status).toBe(404);
    db.approval.findUnique.mockResolvedValue(null); expect((await POST(request(), context)).status).toBe(404);
    expect(db.approval.updateMany).not.toHaveBeenCalled();
  });
  it.each(["approve", "deny", "", null, 1])("rejects an invalid decision: %s", async (decision) => {
    expect((await POST(request(decision), context)).status).toBe(400); expect(db.approval.updateMany).not.toHaveBeenCalled();
  });
  it("rejects expiration including exact expiry, without authorizing a payment", async () => {
    row.expiresAt = NOW; expect((await POST(request(), context)).status).toBe(409);
    expect(db.webhookEvent.upsert).not.toHaveBeenCalled();
  });
  it("keeps terminal decisions immutable and serializes conflicting concurrent decisions", async () => {
    const responses = await Promise.all([POST(request("approved"), context), POST(request("declined"), context)]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(db.webhookEvent.upsert).toHaveBeenCalledOnce();
    expect((await POST(request("declined"), context)).status).toBe(409); expect(row.status).toBe("approved");
  });
  it("returns after a committed resolution without making network dispatch part of the request", async () => {
    flush.mockRejectedValueOnce(new Error("database password"));
    expect((await POST(request(), context)).status).toBe(200); expect(row.status).toBe("approved"); expect(flush).not.toHaveBeenCalled();
  });
  it("does not expose database errors", async () => {
    db.approval.findUnique.mockRejectedValueOnce(new Error("password=secret")); const response = await POST(request(), context);
    expect(response.status).toBe(500); expect(await response.text()).not.toContain("secret");
  });
});
