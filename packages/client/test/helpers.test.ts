import { describe, expect, it } from "vitest";
import { connectSettl, decodeToolResult, parseMcpUrl, SettlToolError } from "../src/index";

describe("parseMcpUrl", () => {
  it("accepts https endpoints and plain http on localhost only", () => {
    expect(parseMcpUrl("https://settl.example/mcp").href).toBe("https://settl.example/mcp");
    expect(parseMcpUrl("http://localhost:4000/mcp").hostname).toBe("localhost");
    expect(parseMcpUrl("http://127.0.0.1:4000/mcp").hostname).toBe("127.0.0.1");
  });

  it("rejects insecure remote URLs, credentials, queries and fragments with a message that says what to fix", () => {
    expect(() => parseMcpUrl("http://settl.example/mcp")).toThrow(/https/i);
    expect(() => parseMcpUrl("https://user:pw@settl.example/mcp")).toThrow(/credentials/i);
    expect(() => parseMcpUrl("https://settl.example/mcp?key=1")).toThrow(/query/i);
    expect(() => parseMcpUrl("not a url")).toThrow(/mcpUrl/);
  });
});

describe("decodeToolResult", () => {
  it("prefers structured content", () => {
    expect(decodeToolResult({ structuredContent: { status: "paid" }, content: [] })).toEqual({ status: "paid" });
  });

  it("falls back to JSON text content", () => {
    expect(decodeToolResult({ content: [{ type: "text", text: '{"a":1}' }] })).toEqual({ a: 1 });
  });

  it("turns a tool error into a SettlToolError carrying the code", () => {
    try {
      decodeToolResult({ isError: true, structuredContent: { error: "AGENT_UNAVAILABLE" } });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SettlToolError);
      expect((error as SettlToolError).code).toBe("AGENT_UNAVAILABLE");
    }
  });

  it("carries the gateway's message, next step and retry hint", () => {
    try {
      decodeToolResult({ isError: true, structuredContent: { error: "invalid_max_price", message: "maxPricePhp is not valid.", next: "Send pesos.", retryable: false } });
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ code: "invalid_max_price", next: "Send pesos.", retryable: false });
      expect((error as Error).message).toMatch(/maxPricePhp is not valid/);
    }
  });

  it("rejects results that are not a JSON object", () => {
    expect(() => decodeToolResult(null)).toThrow();
    expect(() => decodeToolResult({ content: [] })).toThrow();
    expect(() => decodeToolResult({ structuredContent: [1] })).toThrow();
  });
});

describe("connectSettl", () => {
  it("explains how to supply the agent key when none is configured", async () => {
    const saved = process.env.SETTL_AGENT_API_KEY;
    delete process.env.SETTL_AGENT_API_KEY;
    try {
      await expect(connectSettl({ mcpUrl: "http://localhost:4000/mcp" })).rejects.toThrow(/SETTL_AGENT_API_KEY/);
    } finally {
      if (saved !== undefined) process.env.SETTL_AGENT_API_KEY = saved;
    }
  });
});
