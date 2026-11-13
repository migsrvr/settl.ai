import { describe, expect, it } from "vitest";
import { startSandboxDatabase } from "../src/database";

describe("sandbox database", () => {
  it("boots an embedded Postgres with the Settl schema and supports row locks and concurrent transactions", async () => {
    const database = await startSandboxDatabase();
    try {
      expect(await database.prisma.org.count()).toBe(0);
      const run = (n: number) => database.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT * FROM "agents" WHERE id = ${"missing"} FOR UPDATE`;
        const count = await tx.org.count();
        await new Promise((resolve) => setTimeout(resolve, 10));
        return `${n}:${count}`;
      });
      expect(await Promise.all([run(1), run(2), run(3)])).toEqual(["1:0", "2:0", "3:0"]);
    } finally {
      await database.close();
    }
  }, 60_000);
});
