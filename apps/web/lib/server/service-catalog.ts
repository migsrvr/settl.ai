import { getDb } from "./db";

export interface CatalogEntry {
  id: string;
  name: string;
  providerId: string;
  providerName: string;
  price: bigint;
  mode: string;
  description: string | null;
  inputSchema: unknown;
  example: unknown;
}

const TTL_MS = 30_000;
let cached: { at: number; entries: CatalogEntry[] } | undefined;

/**
 * Active services, cached per process for 30 seconds. Used to build one MCP tool per service on every
 * request without a database read each time. settl_list_services stays uncached and authoritative.
 */
export async function loadCatalog(now: () => number = Date.now): Promise<CatalogEntry[]> {
  if (cached && now() - cached.at < TTL_MS) return cached.entries;
  const rows = await getDb().endpoint.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: {
      id: true, name: true, providerId: true, price: true, mode: true, description: true, inputSchema: true, example: true,
      provider: { select: { displayName: true } },
    },
  });
  const entries = rows.map(({ provider, ...row }) => ({ ...row, providerName: provider.displayName }));
  cached = { at: now(), entries };
  return entries;
}

/** Forget the cached catalog, for example right after an endpoint is registered in this process. */
export function invalidateCatalog(): void {
  cached = undefined;
}

function slug(value: string): string {
  return value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/** Readable, unique MCP tool names: `<provider>_<service>`, never colliding with the settl_ tools. */
export function toolNames(entries: Array<Pick<CatalogEntry, "id" | "name" | "providerId">>): Map<string, string> {
  const names = new Map<string, string>();
  const used = new Set<string>();
  for (const entry of entries) {
    const provider = slug(entry.providerId) || "service";
    const service = slug(entry.name) || slug(entry.id) || "call";
    let name = service === provider || service.startsWith(`${provider}_`) ? service : `${provider}_${service}`;
    if (name.startsWith("settl_") || name === "settl") name = `svc_${name}`;
    name = name.slice(0, 64).replace(/_+$/, "");
    if (used.has(name)) {
      const suffix = `_${(slug(entry.id) || "x").slice(-6)}`;
      name = `${name.slice(0, 64 - suffix.length).replace(/_+$/, "")}${suffix}`;
      for (let n = 2; used.has(name); n += 1) name = `${name.slice(0, 60)}_${n}`;
    }
    used.add(name);
    names.set(entry.id, name);
  }
  return names;
}
