// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MetadataError, validateInput, validateServiceMetadata } from "./service-metadata";

const schema = {
  type: "object",
  properties: { fixture: { type: "string", enum: ["clean", "blurry"] } },
  required: ["fixture"],
  additionalProperties: false,
};

async function rejection(value: Parameters<typeof validateServiceMetadata>[0]) {
  try {
    await validateServiceMetadata(value);
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

describe("validateServiceMetadata", () => {
  it("accepts nothing at all, so metadata stays optional", async () => {
    await expect(validateServiceMetadata({})).resolves.toEqual({});
    await expect(validateServiceMetadata({ description: null, inputSchema: null, example: null })).resolves.toEqual({});
  });

  it("keeps a trimmed description, an object schema and a matching example", async () => {
    await expect(validateServiceMetadata({ description: "  Reads a receipt.  ", inputSchema: schema, example: { fixture: "clean" } }))
      .resolves.toEqual({ description: "Reads a receipt.", inputSchema: schema, example: { fixture: "clean" } });
  });

  it.each([
    ["an empty description", { description: "   " }, "description"],
    ["a description over 500 characters", { description: "x".repeat(501) }, "description"],
    ["a non-string description", { description: 5 }, "description"],
    ["a schema that is not an object", { inputSchema: [1, 2] }, "inputSchema"],
    ["a schema whose root is not an object type", { inputSchema: { type: "string" } }, "inputSchema"],
    ["a schema that does not compile", { inputSchema: { type: "object", properties: { a: { $ref: "#/nowhere" } } } }, "inputSchema"],
    ["a schema over 16 KB", { inputSchema: { type: "object", description: "x".repeat(17_000) } }, "inputSchema"],
    ["an example over 4 KB", { example: { blob: "x".repeat(5_000) } }, "example"],
    ["an example that does not match the schema", { inputSchema: schema, example: { fixture: "torn" } }, "example"],
  ])("rejects %s and names the field", async (_label, value, field) => {
    const error = await rejection(value as never);
    expect(error).toBeInstanceOf(MetadataError);
    expect((error as MetadataError).field).toBe(field);
  });
});

describe("validateInput", () => {
  it("accepts matching input and treats missing input as an empty object", async () => {
    await expect(validateInput(schema, { fixture: "clean" })).resolves.toEqual({ ok: true });
    await expect(validateInput({ type: "object" }, undefined)).resolves.toEqual({ ok: true });
  });

  it("explains what is wrong with input that does not match", async () => {
    const result = await validateInput(schema, { fixture: "torn", extra: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.join(" ")).toMatch(/fixture|extra|additional|allowed/i);
  });

  it("does not block a call when a stored schema cannot be compiled", async () => {
    await expect(validateInput({ type: "object", properties: { a: { $ref: "#/nowhere" } } }, {})).resolves.toEqual({ ok: true });
  });
});
