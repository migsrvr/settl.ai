// @vitest-environment node
import { describe, expect, it } from "vitest";
import { accountFor, accountForEmail, DEMO_ACCOUNTS, resolveSession } from "./auth";

describe("demo workspace identities", () => {
  it("includes two independent providers and buyers while retaining the role defaults", () => {
    expect(DEMO_ACCOUNTS.map(({ email, role }) => ({ email, role }))).toEqual([
      { email: "mara@example.com", role: "provider" },
      { email: "geoph@example.com", role: "provider" },
      { email: "juan@example.com", role: "buyer" },
      { email: "acme@example.com", role: "buyer" },
    ]);
    expect(accountFor("provider").email).toBe("mara@example.com");
    expect(accountFor("buyer").email).toBe("juan@example.com");
    expect(accountForEmail(" GEOPH@EXAMPLE.COM ")?.org).toBe("GeoPH");
  });

  it.each([
    ["buyer", "juan@example.com", "buyer"],
    ["provider", "mara@example.com", "provider"],
    ["mara@example.com", "mara@example.com", "provider"],
    ["geoph@example.com", "geoph@example.com", "provider"],
    ["acme@example.com", "acme@example.com", "buyer"],
    ["buyer:acme@example.com", "acme@example.com", "buyer"],
    ["provider:geoph@example.com", "geoph@example.com", "provider"],
    ["geoph%40example.com", "geoph@example.com", "provider"],
    ["buyer%3Acustom%40example.com", "custom@example.com", "buyer"],
    ["provider:custom@example.com", "custom@example.com", "provider"],
  ])("resolves %s without collapsing the account to a default org", (cookie, email, role) => {
    expect(resolveSession(cookie)).toEqual({ email, role });
  });

  it.each([undefined, "", "unknown", "custom@example.com", "admin:geoph@example.com", "buyer:geoph@example.com", "provider:juan@example.com", "buyer:", "buyer:bad email@example.com", "%ZZ", "buyer:custom@example.com:provider"])("rejects invalid or contradictory session %s", (cookie) => {
    expect(resolveSession(cookie)).toBeNull();
  });
});
