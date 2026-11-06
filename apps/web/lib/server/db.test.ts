// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: class { constructor(public options: unknown) {} } }));
vi.mock("../generated/prisma/client", () => ({ PrismaClient: class { constructor(public options: unknown) {} } }));

afterEach(() => {
  delete (globalThis as { settlPrisma?: unknown }).settlPrisma;
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("database singleton", () => {
  it("loads without database credentials and reports missing configuration on access", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const { getDb } = await import("./db");
    expect(getDb).toBeTypeOf("function");
    expect(() => getDb()).toThrow("DATABASE_URL is required");
  });

  it("reuses the same client across calls and development module reloads", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", "postgresql://user:password@localhost/settl");
    const first = await import("./db");
    const client = first.getDb();
    expect(first.getDb()).toBe(client);
    vi.resetModules();
    const reloaded = await import("./db");
    expect(reloaded.getDb()).toBe(client);
  });

  it("rejects browser access", async () => {
    vi.stubGlobal("window", {});
    try {
      const { getDb } = await import("./db");
      expect(() => getDb()).toThrow(/server/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
