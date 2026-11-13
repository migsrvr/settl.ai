import { describe, expect, it } from "vitest";
import { formatBanner } from "../src/banner";
import { describeStartupError, parseCliArgs } from "../src/cli-args";

const info = {
  url: "http://127.0.0.1:4000",
  mcpUrl: "http://127.0.0.1:4000/mcp",
  providerKey: "sandbox_provider_key",
  agentKey: "stl_agent_sandbox_demo",
  providerUrl: "http://localhost:3001",
  autoApprove: false,
  balancePhp: 100,
};

describe("sandbox banner", () => {
  const text = formatBanner(info);

  it("says plainly that the money is fake", () => {
    expect(text).toMatch(/fake money/i);
  });

  it("prints the values a provider and an agent need", () => {
    expect(text).toContain("SETTL_API_URL=http://127.0.0.1:4000");
    expect(text).toContain("SETTL_PROVIDER_KEY=sandbox_provider_key");
    expect(text).toContain("stl_agent_sandbox_demo");
    expect(text).toContain("http://127.0.0.1:4000/mcp");
  });

  it("includes paste-ready Claude Code and Codex MCP configuration", () => {
    expect(text).toContain('claude mcp add --transport http settl http://127.0.0.1:4000/mcp --header "Authorization: Bearer stl_agent_sandbox_demo"');
    expect(text).toContain("[mcp_servers.settl]");
    expect(text).toContain('url = "http://127.0.0.1:4000/mcp"');
    expect(text).toContain('bearer_token_env_var = "SETTL_AGENT_API_KEY"');
  });

  it("explains how to approve a purchase unless auto-approve is on", () => {
    expect(text).toContain("/api/approvals/");
    expect(formatBanner({ ...info, autoApprove: true })).toMatch(/auto-approve/i);
  });
});

describe("sandbox startup errors", () => {
  it("tells the developer what to do when the port is taken", () => {
    const message = describeStartupError(new Error("listen EADDRINUSE: address already in use 127.0.0.1:4000"));
    expect(message).toMatch(/--port/);
    expect(message).toMatch(/already in use/i);
  });

  it("shows the real reason for any other failure instead of hiding it", () => {
    const message = describeStartupError(new Error("Cannot find module '../generated/prisma/client'\n    at stack line"));
    expect(message).toContain("Cannot find module '../generated/prisma/client'");
    expect(message).not.toContain("at stack line");
    expect(message).toMatch(/db:generate/);
  });

  it("copes with values that are not errors", () => {
    expect(describeStartupError("boom")).toMatch(/could not start/i);
  });
});

describe("sandbox CLI arguments", () => {
  it("uses sensible defaults", () => {
    expect(parseCliArgs([])).toMatchObject({ port: 4000, providerUrl: "http://localhost:3001", balancePhp: 100, autoApprove: false, help: false });
  });

  it("reads flags", () => {
    expect(parseCliArgs(["--port", "5000", "--provider-url", "http://localhost:9000/", "--balance", "250", "--auto-approve"]))
      .toMatchObject({ port: 5000, providerUrl: "http://localhost:9000", balancePhp: 250, autoApprove: true });
  });

  it("rejects bad values with a message that says what to do", () => {
    expect(() => parseCliArgs(["--port", "abc"])).toThrow(/--port/);
    expect(() => parseCliArgs(["--balance", "-5"])).toThrow(/--balance/);
    expect(() => parseCliArgs(["--provider-url", "not a url"])).toThrow(/--provider-url/);
    expect(() => parseCliArgs(["--agent-key", "nope"])).toThrow(/stl_agent_/);
  });
});
