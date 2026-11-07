// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import * as timing from '@/lib/server/timing';
const { createAgent, org, after, provisionAgent } = vi.hoisted(() => ({ createAgent: vi.fn(), org: vi.fn(), after: vi.fn(), provisionAgent: vi.fn() }));
vi.mock('next/server', () => ({ after }));
vi.mock('@/lib/server/agent-provisioning', () => ({ provisionAgent }));
vi.mock("@/lib/server/agents", () => ({ createAgent }));
vi.mock("@/lib/server/db", () => ({ getDb: () => ({ org: { findUnique: org } }) }));
const policy = { name: "Bookkeeper", maxAmountStroops: "10000000", dailyBudgetStroops: "50000000", autoApproveUpToStroops: "1000000", expiresAt: "2027-01-01T00:00:00Z", allowlist: ["provider"] };
const request = (body: unknown = policy, headers: Record<string, string> = {}) => new Request("https://settl.test/api/agents", { method: "POST", headers: { cookie: "settl_demo=buyer", "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); org.mockResolvedValue({ id: "buyer", role: "buyer" }); createAgent.mockResolvedValue({ agentId: "new-agent", status: "provisioning", apiKey: "stl_agent_once" }); });

describe("buyer agent creation route", () => {
  it('measures preparation without including background blockchain wait or credentials', async () => {
    const tracker = { correlationId: 'safe', measure: vi.fn(async (_phase: string, run: () => Promise<unknown>) => run()), finish: vi.fn() };
    const spy = vi.spyOn(timing, 'createTimingTracker').mockReturnValue(tracker as ReturnType<typeof timing.createTimingTracker>);
    createAgent.mockResolvedValueOnce({ agentId: 'new-agent', status: 'provisioning', apiKey: 'stl_agent_once' });
    try { await POST(request()); expect(tracker.measure.mock.calls.map(c => c[0])).toEqual(['auth', 'db']); expect(tracker.finish).toHaveBeenCalledWith('queued'); expect(JSON.stringify(tracker.finish.mock.calls)).not.toContain('stl_agent'); }
    finally { spy.mockRestore(); }
  });
  it('returns the committed key before background registration starts', async () => {
    createAgent.mockResolvedValueOnce({ agentId: 'new-agent', status: 'provisioning', apiKey: 'stl_agent_once' });
    provisionAgent.mockReturnValue(new Promise(() => {}));
    const response = await POST(request());
    expect(response.status).toBe(202); expect(await response.json()).toMatchObject({ apiKey: 'stl_agent_once' });
    expect(after).toHaveBeenCalledOnce(); expect(provisionAgent).not.toHaveBeenCalled();
    void after.mock.calls[0][0](); expect(provisionAgent).toHaveBeenCalledWith('new-agent');
  });
  it('preserves the only plaintext key if scheduling throws after commit', async () => {
    createAgent.mockResolvedValueOnce({ agentId: 'new-agent', status: 'provisioning', apiKey: 'stl_agent_once' });
    after.mockImplementationOnce(() => { throw new Error('private scheduler failure'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try { const response = await POST(request()); expect(response.status).toBe(202); expect(await response.json()).toMatchObject({ apiKey: 'stl_agent_once' }); }
    finally { warn.mockRestore(); }
  });
  it("passes the stored buyer organization and object body, returning the one-time key without caching", async () => {
    const body = { ...policy, orgId: "untrusted" };
    const response = await POST(request(body, { "content-type": "application/json; charset=utf-8" }));
    expect(response.status).toBe(202); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ agentId: "new-agent", status: "provisioning", apiKey: "stl_agent_once" });
    expect(createAgent).toHaveBeenCalledExactlyOnceWith("buyer", body);
  });
  it.each([["provisioning", 202]] as const)("preserves the key and %s result at HTTP %s", async (status, httpStatus) => {
    const result = { agentId: "new-agent", status, apiKey: "stl_agent_once" };
    createAgent.mockResolvedValueOnce(result);
    const response = await POST(request()); expect(response.status).toBe(httpStatus); expect(await response.json()).toEqual(result);
  });
  it.each(["", "settl_demo=provider", "settl_demo=buyer; settl_demo=provider"])("rejects unauthorized sessions without creation: %s", async (cookie) => {
    expect((await POST(request(policy, { cookie, authorization: "Bearer stl_agent_example" }))).status).toBe(401); expect(createAgent).not.toHaveBeenCalled();
  });
  it("rejects cross-origin browser requests", async () => {
    expect((await POST(request(policy, { origin: "https://evil.test" }))).status).toBe(403);
    expect((await POST(request(policy, { "sec-fetch-site": "cross-site" }))).status).toBe(403); expect(createAgent).not.toHaveBeenCalled();
  });
  it.each([null, [], "invalid", 12])("rejects non-object JSON %s before creation", async (body) => {
    expect((await POST(request(body))).status).toBe(400); expect(createAgent).not.toHaveBeenCalled();
  });
  it("rejects form submissions and malformed JSON before creation", async () => {
    expect((await POST(request(policy, { "content-type": "text/plain" }))).status).toBe(400);
    const malformed = new Request("https://settl.test/api/agents", { method: "POST", headers: { cookie: "settl_demo=buyer", "content-type": "application/json" }, body: "{" });
    expect((await POST(malformed)).status).toBe(400); expect(createAgent).not.toHaveBeenCalled();
  });
  it("preserves safe validation errors and sanitizes unexpected exceptions", async () => {
    createAgent.mockRejectedValueOnce({ status: 400, code: "invalid_agent_name", message: "private" });
    const invalid = await POST(request()); expect(invalid.status).toBe(400); expect(await invalid.json()).toMatchObject({ error: "invalid_agent_name" });
    createAgent.mockRejectedValueOnce(new Error("database password secret"));
    const failed = await POST(request()); expect(failed.status).toBe(500); expect(await failed.text()).not.toMatch(/secret|password|private/);
  });
});
