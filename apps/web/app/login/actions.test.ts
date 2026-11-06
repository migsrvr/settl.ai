// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ cookie: "buyer" as string | undefined, set: vi.fn(), remove: vi.fn(), org: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => mocks.cookie ? { value: mocks.cookie } : undefined, set: mocks.set, delete: mocks.remove }) }));
vi.mock("next/navigation", () => ({ redirect: (path: string): never => { throw new Error(`redirect:${path}`); } }));
vi.mock("@/lib/server/db", () => ({ getDb: () => ({ org: { findUnique: mocks.org } }) }));
import { signIn, signOut, switchWorkspace } from "./actions";

function form(email: string, next = "") {
  const data = new FormData();
  data.set("email", email); data.set("password", "demo"); data.set("next", next);
  return data;
}

beforeEach(() => { vi.clearAllMocks(); mocks.cookie = "buyer"; mocks.org.mockResolvedValue(null); });

describe("account-specific demo sign-in and switching", () => {
  it.each([["geoph@example.com", "/provider"], ["acme@example.com", "/buyer"]])("signs %s in with its own email", async (email, home) => {
    await expect(signIn({}, form(email))).rejects.toThrow(`redirect:${home}`);
    expect(mocks.set).toHaveBeenCalledWith("settl_demo", email, expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }));
  });
  it.each(["https://attacker.test/provider", "//attacker.test/provider", "/provider-other", "/provider/../buyer", "/buyer"])("ignores unsafe or cross-role return destination %s", async (next) => {
    await expect(signIn({}, form("geoph@example.com", next))).rejects.toThrow("redirect:/provider");
  });
  it("preserves a return location inside the selected workspace", async () => {
    await expect(signIn({}, form("acme@example.com", "/buyer/agents/new?from=login"))).rejects.toThrow("redirect:/buyer/agents/new?from=login");
  });
  it("loads custom demo organizations with a public projection and a stored role", async () => {
    mocks.org.mockResolvedValue({ email: "custom@example.com", role: "provider", name: "Custom Maps", contactName: "Sam Demo" });
    await expect(signIn({}, form(" Custom@example.com "))).rejects.toThrow("redirect:/provider");
    expect(mocks.org).toHaveBeenCalledWith({ where: { email: "custom@example.com" }, select: { email: true, role: true, name: true, contactName: true } });
    expect(mocks.set).toHaveBeenCalledWith("settl_demo", "provider:custom@example.com", expect.any(Object));
  });
  it("rejects unknown accounts, missing passwords and unavailable account lookup without a session write", async () => {
    expect(await signIn({}, form("missing@example.com"))).toMatchObject({ error: { field: "email" } });
    const emptyPassword = form("geoph@example.com"); emptyPassword.set("password", "");
    expect(await signIn({}, emptyPassword)).toMatchObject({ error: { field: "password" } });
    mocks.org.mockRejectedValue(new Error("private database details"));
    const failure = await signIn({}, form("custom@example.com"));
    expect(failure).toMatchObject({ error: { field: "email" } });
    expect(JSON.stringify(failure)).not.toContain("private database");
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it("switches roles and accounts by changing the session before redirecting", async () => {
    await expect(switchWorkspace("geoph@example.com")).rejects.toThrow("redirect:/provider");
    expect(mocks.set).toHaveBeenLastCalledWith("settl_demo", "geoph@example.com", expect.any(Object));
    mocks.cookie = "geoph@example.com";
    await expect(switchWorkspace("acme@example.com")).rejects.toThrow("redirect:/buyer");
    expect(mocks.set).toHaveBeenLastCalledWith("settl_demo", "acme@example.com", expect.any(Object));
  });
  it("requires a valid current session and rejects unknown workspace targets", async () => {
    mocks.cookie = undefined;
    await expect(switchWorkspace("geoph@example.com")).rejects.toThrow("redirect:/login");
    expect(mocks.set).not.toHaveBeenCalled();
    mocks.cookie = "buyer";
    await expect(switchWorkspace("missing@example.com")).rejects.toThrow("redirect:/login");
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it("still deletes the demo session on sign-out", async () => {
    await expect(signOut()).rejects.toThrow("redirect:/login");
    expect(mocks.remove).toHaveBeenCalledWith("settl_demo");
  });
});
