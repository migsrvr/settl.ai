// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiErrorResponse, ApiError, jsonResponse, readObjectBody, requireAgentAuth, requireProviderAuth } from "./api-auth";

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock("./db", () => ({ getDb: () => ({ agentApiKey: { findUnique } }) }));

const token = "stl_agent_example_token";
const request = (authorization?: string) => new Request("https://settl.test/api", {
  headers: authorization === undefined ? {} : { authorization },
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SETTL_PROVIDER_KEY", "provider-test-secret");
  findUnique.mockResolvedValue({ agentId: "agent-real", revokedAt: null, agent: { id: "agent-real", status: "active" } });
});
afterEach(() => vi.unstubAllEnvs());

describe("provider service authentication", () => {
  it("accepts the configured bearer credential", () => {
    expect(() => requireProviderAuth(request("Bearer provider-test-secret"))).not.toThrow();
    expect(() => requireProviderAuth(request("bearer provider-test-secret"))).not.toThrow();
  });

  it.each([undefined, "", "Basic provider-test-secret", "Bearer incorrect", "Bearer provider-test-secret extra", "Bearer provider-test-secret,Bearer other"])("rejects invalid authorization %s", (header) => {
    expect(() => requireProviderAuth(request(header))).toThrow(expect.objectContaining({ status: 401, code: "unauthorized" }));
  });

  it.each(["", "   "])("fails closed when the provider credential is unconfigured", (value) => {
    vi.stubEnv("SETTL_PROVIDER_KEY", value);
    expect(() => requireProviderAuth(request("Bearer provider-test-secret"))).toThrow(expect.objectContaining({ status: 503, code: "provider_auth_unavailable" }));
  });

  it("fails closed for an absent provider credential", () => {
    delete process.env.SETTL_PROVIDER_KEY;
    expect(() => requireProviderAuth(request())).toThrow(expect.objectContaining({ status: 503 }));
  });
});

describe("agent API key authentication", () => {
  it("looks up only the SHA-256 digest and returns the stored agent identity", async () => {
    await expect(requireAgentAuth(request(`Bearer ${token}`))).resolves.toEqual({ agentId: "agent-real" });
    expect(findUnique).toHaveBeenCalledWith({
      where: { keyHash: createHash("sha256").update(token).digest("hex") },
      include: { agent: true },
    });
    expect(JSON.stringify(findUnique.mock.calls)).not.toContain(token);
  });

  it.each([undefined, "Basic stl_agent_example_token", "Bearer provider-test-secret", "Bearer stl_agent_", "Bearer stl_agent_example_token extra"])("rejects malformed credentials before querying the database: %s", async (header) => {
    await expect(requireAgentAuth(request(header))).rejects.toMatchObject({ status: 401, code: "unauthorized" });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("rejects unknown and revoked keys", async () => {
    findUnique.mockResolvedValueOnce(null);
    await expect(requireAgentAuth(request(`Bearer ${token}`))).rejects.toMatchObject({ status: 401 });
    findUnique.mockResolvedValueOnce({ agentId: "agent-real", revokedAt: new Date(), agent: { status: "active" } });
    await expect(requireAgentAuth(request(`Bearer ${token}`))).rejects.toMatchObject({ status: 401 });
  });

  it.each(["provisioning", "revoked", "error"])("rejects an agent with status %s", async (status) => {
    findUnique.mockResolvedValueOnce({ agentId: "agent-real", revokedAt: null, agent: { id: "agent-real", status } });
    await expect(requireAgentAuth(request(`Bearer ${token}`))).rejects.toMatchObject({ status: 403, code: "agent_inactive" });
  });
});

describe("API response and input boundaries", () => {
  it.each(["{", "null", "[]", '"body"', "4"])("rejects malformed or non-object JSON: %s", async (body) => {
    await expect(readObjectBody(new Request("https://settl.test", { method: "POST", body }))).rejects.toMatchObject({ status: 400, code: "invalid_body" });
  });

  it("accepts an object body", async () => {
    await expect(readObjectBody(new Request("https://settl.test", { method: "POST", body: '{"input":null}' }))).resolves.toEqual({ input: null });
  });

  it("returns noncached JSON for successful responses", async () => {
    const response = jsonResponse({ status: "paid" });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ status: "paid" });
  });

  it("returns safe typed errors and a bearer challenge for unauthorized requests", async () => {
    const response = apiErrorResponse(new ApiError(401, "unauthorized"));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ error: "unauthorized" });
  });

  it("supports safe broker error codes without echoing messages", async () => {
    const response = apiErrorResponse(Object.assign(new Error("database password=secret"), { status: 409, code: "payment_pending" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "payment_pending" });
  });

  it.each([
    new Error("secret-token"),
    { status: 200, code: "invalid" },
    { status: 600, code: "invalid" },
    { status: 400.5, code: "invalid" },
    { status: 400, code: "credential secret-token" },
    { status: 400 },
    null,
  ])("hides unexpected errors: %s", async (error) => {
    const response = apiErrorResponse(error);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "internal_error", message: "The request could not be completed." });
  });
});
