import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("sandbox schema.sql", () => {
  it("was generated from the current Prisma schema", () => {
    const prisma = read("../../../apps/web/prisma/schema.prisma").replace(/\r\n/g, "\n");
    const expected = createHash("sha256").update(prisma).digest("hex");
    const header = /^-- settl-schema-sha256: ([0-9a-f]{64})\r?$/m.exec(read("../src/schema.sql"));
    expect(header, "schema.sql is missing its hash header").not.toBeNull();
    // If this fails, apps/web/prisma/schema.prisma changed: run `npm run schema -w @settl/dev`.
    expect(header?.[1]).toBe(expected);
  });

  it("creates the tables the broker and MCP tools use", () => {
    const sql = read("../src/schema.sql");
    for (const table of ["agents", "endpoints", "quotes", "payments", "reservations", "approvals", "agent_api_keys"]) {
      expect(sql).toContain(`CREATE TABLE "${table}"`);
    }
  });
});
