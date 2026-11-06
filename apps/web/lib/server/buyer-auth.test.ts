// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireBuyerOrg, requireProviderOrg, apiErrorResponse } from "./api-auth";

const { org } = vi.hoisted(() => ({ org: vi.fn() }));
vi.mock("./db", () => ({ getDb: () => ({ org: { findUnique: org } }) }));
const request = (cookie = "settl_demo=buyer", extra: Record<string, string> = {}) => new Request("https://settl.test/api/approvals/a1", { headers: { cookie, ...extra } });
beforeEach(() => { org.mockReset(); org.mockResolvedValue({ id: "org_juan", role: "buyer" }); });
afterEach(() => vi.restoreAllMocks());

describe("demo buyer authorization", () => {
  it("separately authenticates the provider workspace and its stored organization", async () => {
    org.mockResolvedValue({ id: "org_resibo", role: "provider" });
    expect(await requireProviderOrg(request("settl_demo=provider"))).toEqual({ orgId: "org_resibo" });
    expect(org).toHaveBeenCalledWith({ where: { email: "mara@example.com" }, select: { id: true, role: true } });
    await expect(requireProviderOrg(request("settl_demo=buyer"))).rejects.toMatchObject({ status: 401 });
  });
  it("resolves the existing demo buyer to the stored organization", async () => {
    expect(await requireBuyerOrg(request())).toEqual({ orgId: "org_juan" });
    expect(org).toHaveBeenCalledWith({ where: { email: "juan@example.com" }, select: { id: true, role: true } });
  });
  it.each(["", "settl_demo=provider", "other=buyer", "settl_demo=buyer; settl_demo=provider"])("rejects invalid sessions without querying buyer data: %s", async (cookie) => {
    await expect(requireBuyerOrg(request(cookie))).rejects.toMatchObject({ status: 401, code: "buyer_auth_required" });
    expect(org).not.toHaveBeenCalled();
  });
  it("rejects cross-origin browser writes and missing buyer organizations", async () => {
    await expect(requireBuyerOrg(request("settl_demo=buyer", { origin: "https://attacker.test" }))).rejects.toMatchObject({ status: 403 });
    await expect(requireBuyerOrg(request("settl_demo=buyer", { "sec-fetch-site": "cross-site" }))).rejects.toMatchObject({ status: 403 });
    org.mockResolvedValue(null);
    await expect(requireBuyerOrg(request())).rejects.toMatchObject({ status: 403 });
  });
  it("gives buyer sign-in guidance without a bearer challenge", async () => {
    const error = await requireBuyerOrg(request("")).catch((e: unknown) => e);
    const response = apiErrorResponse(error);
    expect(response.headers.has("www-authenticate")).toBe(false);
    expect(await response.json()).toMatchObject({ error: "buyer_auth_required", message: "Sign in to the buyer workspace to continue." });
  });
});
