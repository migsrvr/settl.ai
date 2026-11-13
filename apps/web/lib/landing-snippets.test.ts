// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AGENT_CODE, PROVIDER_CODE } from "./landing-snippets";

/** The code between `// snippet:<name>` and `// snippet:end`, without its indentation. */
function region(file: string, name: string): string {
  const text = readFileSync(new URL(`../../../examples/${file}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const start = text.indexOf(`// snippet:${name}\n`);
  expect(start, `${file} has no snippet:${name} marker`).toBeGreaterThanOrEqual(0);
  const body = text.slice(start).split("\n").slice(1);
  const lines = body.slice(0, body.findIndex((line) => line.trim() === "// snippet:end"));
  const indent = Math.min(...lines.filter((line) => line.trim()).map((line) => line.length - line.trimStart().length));
  return lines.map((line) => line.slice(indent)).join("\n");
}

// The landing page promises developers exactly this code. The examples run against the sandbox in
// packages/dev/test/examples.test.ts, so a snippet that matches them is a snippet that works.
describe("landing page code samples", () => {
  it("show the provider example that is tested against the sandbox", () => {
    expect(PROVIDER_CODE).toBe(`import { settl } from "@settl/sdk";\n\n${region("express-provider/server.ts", "provider")}`);
  });

  it("show the agent example that is tested against the sandbox", () => {
    expect(AGENT_CODE).toBe(`import { connectSettl } from "@settl/client";\n\n${region("agent/buy.ts", "agent")}`);
  });

  it("name only packages that exist in this repository", () => {
    for (const code of [PROVIDER_CODE, AGENT_CODE]) {
      expect(code).not.toMatch(/settl-sdk|settl-client|settlFetch/);
    }
  });
});
