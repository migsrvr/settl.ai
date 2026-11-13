import { fromJsonSchema, type StandardSchemaWithJSON } from "@modelcontextprotocol/server";

/** What a provider tells agents about a service, so they do not have to guess its input. */
export interface ServiceMetadata {
  description?: string;
  inputSchema?: Record<string, unknown>;
  example?: unknown;
}

export class MetadataError extends Error {
  constructor(public readonly field: keyof ServiceMetadata, message: string) {
    super(message);
    this.name = "MetadataError";
  }
}

const MAX_DESCRIPTION = 500;
const MAX_SCHEMA_BYTES = 16 * 1024;
const MAX_EXAMPLE_BYTES = 4 * 1024;

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Compiling a JSON Schema is costly; the same few provider schemas are reused on every call.
const compiled = new Map<string, StandardSchemaWithJSON<unknown, unknown>>();

function compile(schema: Record<string, unknown>): StandardSchemaWithJSON<unknown, unknown> {
  const key = JSON.stringify(schema);
  const cached = compiled.get(key);
  if (cached) return cached;
  const result = fromJsonSchema(schema as never);
  if (compiled.size >= 200) compiled.clear();
  compiled.set(key, result);
  return result;
}

async function issuesFor(schema: StandardSchemaWithJSON<unknown, unknown>, value: unknown): Promise<string[]> {
  const result = await schema["~standard"].validate(value);
  if (!("issues" in result) || !result.issues) return [];
  return result.issues.slice(0, 5).map((issue) => {
    const path = issue.path?.map((part) => (typeof part === "object" ? String(part.key) : String(part))).join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

/** Check optional metadata from a provider. Throws MetadataError naming the field at fault. */
export async function validateServiceMetadata(raw: { description?: unknown; inputSchema?: unknown; example?: unknown }): Promise<ServiceMetadata> {
  const metadata: ServiceMetadata = {};

  if (raw.description !== undefined && raw.description !== null) {
    if (typeof raw.description !== "string" || !raw.description.trim() || raw.description.trim().length > MAX_DESCRIPTION) {
      throw new MetadataError("description", `description must be 1 to ${MAX_DESCRIPTION} characters`);
    }
    metadata.description = raw.description.trim();
  }

  let schema: StandardSchemaWithJSON<unknown, unknown> | undefined;
  if (raw.inputSchema !== undefined && raw.inputSchema !== null) {
    if (!isPlainObject(raw.inputSchema) || (raw.inputSchema.type !== undefined && raw.inputSchema.type !== "object")) {
      throw new MetadataError("inputSchema", 'inputSchema must be a JSON Schema object with "type": "object"');
    }
    if (bytes(raw.inputSchema) > MAX_SCHEMA_BYTES) throw new MetadataError("inputSchema", "inputSchema must be at most 16 KB");
    try {
      schema = compile(raw.inputSchema);
    } catch {
      throw new MetadataError("inputSchema", "inputSchema is not a valid JSON Schema (draft 2020-12)");
    }
    metadata.inputSchema = raw.inputSchema;
  }

  if (raw.example !== undefined && raw.example !== null) {
    if (bytes(raw.example) > MAX_EXAMPLE_BYTES) throw new MetadataError("example", "example must be at most 4 KB of JSON");
    if (schema && (await issuesFor(schema, raw.example)).length > 0) {
      throw new MetadataError("example", "example does not match inputSchema");
    }
    metadata.example = raw.example;
  }

  return metadata;
}

/**
 * Check a call's input against a service's stored schema before any money moves.
 * A stored schema that no longer compiles never blocks a call; the provider still validates its own input.
 */
export async function validateInput(inputSchema: unknown, input: unknown): Promise<{ ok: true } | { ok: false; issues: string[] }> {
  if (!isPlainObject(inputSchema)) return { ok: true };
  let schema: StandardSchemaWithJSON<unknown, unknown>;
  try {
    schema = compile(inputSchema);
  } catch {
    return { ok: true };
  }
  const issues = await issuesFor(schema, input === undefined ? {} : input);
  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}
