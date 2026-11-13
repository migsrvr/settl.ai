// @vitest-environment node
import { describe, expect, it } from "vitest";
import { BUY_GUIDE, handleAiCatalog, handleLlmsTxt, handleServerCard } from "./discovery";

const get = (path: string, headers: Record<string, string> = {}) => new Request(`https://settl.example${path}`, { headers });

describe("MCP server card (SEP-2127)", () => {
  it("describes the gateway with the required fields and no credentials", async () => {
    const response = await handleServerCard(get("/mcp/server-card"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/mcp-server-card+json");
    const card = await response.json();
    expect(card.$schema).toBe("https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json");
    expect(card.name).toMatch(/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/);
    expect(card.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(card.description.length).toBeGreaterThan(0);
    expect(card.description.length).toBeLessThanOrEqual(100);
    expect(card.remotes).toEqual([expect.objectContaining({ type: "streamable-http", url: "https://settl.example/mcp" })]);
    expect(card.remotes[0].headers).toEqual([expect.objectContaining({ name: "Authorization", isRequired: true, isSecret: true })]);
    expect(JSON.stringify(card)).not.toMatch(/stl_agent_[A-Za-z0-9]/);
    expect(card).not.toHaveProperty("tools");
  });

  it("can be fetched from any origin and cached", async () => {
    const response = await handleServerCard(get("/mcp/server-card"));
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-methods")).toBe("GET");
    expect(response.headers.get("access-control-expose-headers")).toBe("ETag");
    expect(response.headers.get("cache-control")).toBe("public, max-age=3600");
    const etag = response.headers.get("etag");
    expect(etag).toMatch(/^".+"$/);
    const again = await handleServerCard(get("/mcp/server-card", { "if-none-match": etag! }));
    expect(again.status).toBe(304);
  });
});

describe("AI catalog", () => {
  it("points at the server card", async () => {
    const response = await handleAiCatalog(get("/.well-known/ai-catalog.json"));
    expect(response.headers.get("content-type")).toBe("application/ai-catalog+json");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(await response.json()).toEqual({
      specVersion: "1.0",
      entries: [{ identifier: expect.any(String), type: "application/mcp-server-card+json", url: "https://settl.example/mcp/server-card" }],
    });
  });
});

describe("llms.txt", () => {
  it("tells a model how to connect and buy safely, using this deployment's URL", async () => {
    const response = await handleLlmsTxt(get("/llms.txt"));
    expect(response.headers.get("content-type")).toMatch(/^text\/plain/);
    const text = await response.text();
    expect(text).toMatch(/^# Settl/);
    expect(text).toContain("https://settl.example/mcp");
    expect(text).toContain("Authorization: Bearer");
    expect(text).toContain(BUY_GUIDE.trim().split("\n")[0]);
  });
});
