// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
const { createAgent, org } = vi.hoisted(() => ({ createAgent: vi.fn(), org: vi.fn() }));
vi.mock("@/lib/server/agents", () => ({ createAgent }));
vi.mock("@/lib/server/db", () => ({ getDb: () => ({ org: { findUnique: org } }) }));
const policy = { name: "Bookkeeper", maxAmountStroops: "10000000", dailyBudgetStroops: "50000000", autoApproveUpToStroops: "1000000", expiresAt: "2027-01-01T00:00:00Z", allowlist: ["provider"] };
const request = (body: unknown = policy, headers: Record<string, string> = {}) => new Request("https://settl.test/api/agents", { method: "POST", headers: { cookie: "settl_demo=buyer", "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); org.mockResolvedValue({ id: "buyer", role: "buyer" }); createAgent.mockResolvedValue({ agentId: "new-agent", status: "active", apiKey: "stl_agent_once" }); });

describe("buyer agent creation route", () => {
  it("passes the stored buyer organization and object body, returning the one-time key without caching", async () => {
    const body = { ...policy, orgId: "untrusted" };
    const response = await POST(request(body, { "content-type": "application/json; charset=utf-8" }));
    expect(response.status).toBe(201); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ agentId: "new-agent", status: "active", apiKey: "stl_agent_once" });
    expect(createAgent).toHaveBeenCalledExactlyOnceWith("buyer", body);
  });
  it.each([["active", 201], ["provisioning", 202], ["error", 200]] as const)("preserves the key and %s result at HTTP %s", async (status, httpStatus) => {
    const result = { agentId: "new-agent", status, apiKey: "stl_agent_once", ...(status === "error" ? { error: "account_setup_failed" } : {}) };
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
