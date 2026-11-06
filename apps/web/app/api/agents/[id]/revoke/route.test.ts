// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
const { revokeAgent, org } = vi.hoisted(() => ({ revokeAgent: vi.fn(), org: vi.fn() }));
vi.mock("@/lib/server/agents", () => ({ revokeAgent }));
vi.mock("@/lib/server/db", () => ({ getDb: () => ({ org: { findUnique: org } }) }));
const context = { params: Promise.resolve({ id: "agent" }) };
const request = (headers: Record<string, string> = {}) => new Request("https://settl.test/api/agents/agent/revoke", { method: "POST", headers: { cookie: "settl_demo=buyer", ...headers } });
beforeEach(() => { vi.resetAllMocks(); org.mockResolvedValue({ id: "buyer", role: "buyer" }); revokeAgent.mockResolvedValue({ status: "revoked", txHash: "a".repeat(64) }); });

describe("buyer agent revocation route", () => {
  it("awaits route parameters and scopes revocation to the stored buyer organization", async () => {
    const response = await POST(request(), { params: Promise.resolve({ id: "owned-agent" }) });
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "revoked", txHash: "a".repeat(64) }); expect(revokeAgent).toHaveBeenCalledExactlyOnceWith("buyer", "owned-agent");
  });
  it.each([["revoked", 200], ["pending", 202], ["failed", 502]] as const)("maps %s to HTTP %s without changing the outcome", async (status, httpStatus) => {
    const result = { status, txHash: "a".repeat(64) }; revokeAgent.mockResolvedValueOnce(result);
    const response = await POST(request(), context); expect(response.status).toBe(httpStatus); expect(await response.json()).toEqual(result);
  });
  it.each(["", "settl_demo=provider", "settl_demo=buyer; settl_demo=provider"])("rejects unauthorized sessions without revocation: %s", async (cookie) => {
    expect((await POST(request({ cookie, authorization: "Bearer stl_agent_example" }), context)).status).toBe(401); expect(revokeAgent).not.toHaveBeenCalled();
  });
  it("rejects cross-origin writes and empty agent identifiers without revocation", async () => {
    expect((await POST(request({ origin: "https://evil.test" }), context)).status).toBe(403);
    expect((await POST(request({ "sec-fetch-site": "cross-site" }), context)).status).toBe(403);
    expect((await POST(request(), { params: Promise.resolve({ id: " " }) })).status).toBe(404); expect(revokeAgent).not.toHaveBeenCalled();
  });
  it("preserves ownership and pending-operation errors while sanitizing unexpected errors", async () => {
    revokeAgent.mockRejectedValueOnce({ status: 404, code: "agent_not_found", message: "private" });
    expect((await POST(request(), context)).status).toBe(404);
    revokeAgent.mockRejectedValueOnce({ status: 409, code: "agent_operation_pending", message: "private" });
    const pending = await POST(request(), context); expect(pending.status).toBe(409); expect(await pending.json()).toMatchObject({ error: "agent_operation_pending" });
    revokeAgent.mockRejectedValueOnce(new Error("wallet secret password"));
    const failed = await POST(request(), context); expect(failed.status).toBe(500); expect(await failed.text()).not.toMatch(/secret|password|private/);
  });
});
