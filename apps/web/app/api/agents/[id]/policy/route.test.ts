// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "./route";
const { updateAgentPolicy, org } = vi.hoisted(() => ({ updateAgentPolicy: vi.fn(), org: vi.fn() }));
vi.mock("@/lib/server/agents", () => ({ updateAgentPolicy }));
vi.mock("@/lib/server/db", () => ({ getDb: () => ({ org: { findUnique: org } }) }));
const context = { params: Promise.resolve({ id: "agent" }) };
const policy = { maxAmountStroops: "10000000", dailyBudgetStroops: "50000000", autoApproveUpToStroops: "1000000", expiresAt: "2027-01-01T00:00:00Z", allowlist: ["provider"] };
const request = (body: unknown = policy, headers: Record<string, string> = {}) => new Request("https://settl.test/api/agents/agent/policy", { method: "PATCH", headers: { cookie: "settl_demo=buyer", "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); org.mockResolvedValue({ id: "buyer", role: "buyer" }); updateAgentPolicy.mockResolvedValue({ status: "active" }); });

describe("buyer agent policy route", () => {
  it("passes the stored buyer organization, awaited route agent, and object body to the policy service", async () => {
    const body = { ...policy, orgId: "untrusted", agentId: "untrusted-agent" };
    const response = await PATCH(request(body, { "content-type": "application/json; charset=utf-8" }), { params: Promise.resolve({ id: "owned-agent" }) });
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store"); expect(await response.json()).toEqual({ status: "active" });
    expect(updateAgentPolicy).toHaveBeenCalledExactlyOnceWith("buyer", "owned-agent", body);
  });
  it.each([["active", 200], ["pending", 202], ["failed", 502]] as const)("maps %s to HTTP %s without changing the outcome", async (status, httpStatus) => {
    updateAgentPolicy.mockResolvedValueOnce({ status });
    const response = await PATCH(request(), context); expect(response.status).toBe(httpStatus); expect(await response.json()).toEqual({ status });
  });
  it.each(["", "settl_demo=provider", "settl_demo=buyer; settl_demo=provider"])("rejects unauthorized sessions without updating policy: %s", async (cookie) => {
    expect((await PATCH(request(policy, { cookie, authorization: "Bearer stl_agent_example" }), context)).status).toBe(401); expect(updateAgentPolicy).not.toHaveBeenCalled();
  });
  it("rejects cross-origin requests and empty route identifiers", async () => {
    expect((await PATCH(request(policy, { origin: "https://evil.test" }), context)).status).toBe(403);
    expect((await PATCH(request(policy, { "sec-fetch-site": "cross-site" }), context)).status).toBe(403);
    expect((await PATCH(request(), { params: Promise.resolve({ id: " " }) })).status).toBe(404); expect(updateAgentPolicy).not.toHaveBeenCalled();
  });
  it.each([null, [], "invalid", 12])("rejects non-object JSON %s before changing policy", async (body) => {
    expect((await PATCH(request(body), context)).status).toBe(400); expect(updateAgentPolicy).not.toHaveBeenCalled();
  });
  it("rejects non-JSON content types and malformed JSON", async () => {
    expect((await PATCH(request(policy, { "content-type": "text/plain" }), context)).status).toBe(400);
    const malformed = new Request("https://settl.test/api/agents/agent/policy", { method: "PATCH", headers: { cookie: "settl_demo=buyer", "content-type": "application/json" }, body: "{" });
    expect((await PATCH(malformed, context)).status).toBe(400); expect(updateAgentPolicy).not.toHaveBeenCalled();
  });
  it("preserves safe service validation and ownership errors without exposing exception details", async () => {
    updateAgentPolicy.mockRejectedValueOnce({ status: 400, code: "invalid_policy", message: "private" });
    const invalid = await PATCH(request(), context); expect(invalid.status).toBe(400); expect(await invalid.json()).toMatchObject({ error: "invalid_policy" });
    updateAgentPolicy.mockRejectedValueOnce({ status: 404, code: "agent_not_found", message: "private" }); expect((await PATCH(request(), context)).status).toBe(404);
    updateAgentPolicy.mockRejectedValueOnce(new Error("wallet secret password"));
    const failed = await PATCH(request(), context); expect(failed.status).toBe(500); expect(await failed.text()).not.toMatch(/secret|password|private/);
  });
});
