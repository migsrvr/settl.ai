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
    await expect(requireBuyerOrg(request())).rejects.toMatchObject({ status: 401, code: "buyer_auth_required" });
  });
  it("gives buyer sign-in guidance without a bearer challenge", async () => {
    const error = await requireBuyerOrg(request("")).catch((e: unknown) => e);
    const response = apiErrorResponse(error);
    expect(response.headers.has("www-authenticate")).toBe(false);
    expect(await response.json()).toMatchObject({ error: "buyer_auth_required", message: "Sign in to the buyer workspace to continue." });
  });
  it.each([
    ["geoph@example.com", "geoph@example.com", "provider", "org_geoph"],
    ["geoph%40example.com", "geoph@example.com", "provider", "org_geoph"],
    ["provider:geoph@example.com", "geoph@example.com", "provider", "org_geoph"],
    ["acme@example.com", "acme@example.com", "buyer", "org_acme"],
    ["buyer%3Acustom%40example.com", "custom@example.com", "buyer", "org_custom"],
    ["provider:custom@example.com", "custom@example.com", "provider", "org_custom"],
  ])("resolves session %s to its own stored organization", async (cookie, email, role, id) => {
    org.mockResolvedValue({ id, role });
    const authorize = role === "buyer" ? requireBuyerOrg : requireProviderOrg;
    expect(await authorize(request(`settl_demo=${cookie}`))).toEqual({ orgId: id });
    expect(org).toHaveBeenCalledWith({ where: { email }, select: { id: true, role: true } });
  });
  it.each(["settl_demo=geoph@example.com", "settl_demo=provider:juan@example.com", "settl_demo=acme@example.com; settl_demo=buyer", "settl_demo=%ZZ"])("rejects invalid or cross-role sessions before loading org data: %s", async (cookie) => {
    await expect(requireBuyerOrg(request(cookie))).rejects.toMatchObject({ status: 401, code: "buyer_auth_required" });
    expect(org).not.toHaveBeenCalled();
  });
  it("trusts the stored role over a custom session's role hint", async () => {
    org.mockResolvedValue({ id: "org_custom", role: "provider" });
    await expect(requireBuyerOrg(request("settl_demo=buyer:custom@example.com"))).rejects.toMatchObject({ status: 401, code: "buyer_auth_required" });
    org.mockResolvedValue({ id: "org_custom", role: "buyer" });
    await expect(requireProviderOrg(request("settl_demo=provider:custom@example.com"))).rejects.toMatchObject({ status: 401, code: "provider_auth_required" });
  });
  it("keeps origin protection for account-specific sessions", async () => {
    await expect(requireBuyerOrg(request("settl_demo=acme@example.com", { origin: "https://attacker.test" }))).rejects.toMatchObject({ status: 403, code: "buyer_origin_forbidden" });
    expect(org).not.toHaveBeenCalled();
  });
});
