// @vitest-environment node
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";

function request(path: string, cookie?: string) {
  return new NextRequest(`https://settl.test${path}`, { headers: cookie ? { cookie: `settl_demo=${cookie}` } : {} });
}

describe("workspace route isolation", () => {
  it.each([
    ["/buyer", "provider", "/provider"],
    ["/buyer/agents/new", "geoph@example.com", "/provider"],
    ["/provider/endpoints", "buyer", "/buyer"],
    ["/provider", "acme@example.com", "/buyer"],
  ])("redirects %s with %s to its own workspace", (path, cookie, home) => {
    expect(proxy(request(path, cookie)).headers.get("location")).toBe(`https://settl.test${home}`);
  });
  it.each([
    ["/buyer/agents/new", "buyer"], ["/buyer", "acme@example.com"],
    ["/provider", "provider"], ["/provider/endpoints", "geoph@example.com"],
    ["/buyer", "buyer:custom@example.com"],
  ])("allows the matching workspace %s with %s", (path, cookie) => {
    expect(proxy(request(path, cookie)).headers.get("x-middleware-next")).toBe("1");
  });
  it.each([undefined, "unknown", "buyer:geoph@example.com"])("sends an invalid session %s to sign-in with its intended page", (cookie) => {
    const location = new URL(proxy(request("/buyer/agents/new", cookie)).headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/buyer/agents/new");
  });
});
