import { phpToStroops } from "@settl/core";
import { Keypair } from "@stellar/stellar-sdk";
import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { ApiError, apiErrorResponse, isNonEmptyString, jsonResponse, readObjectBody, requireProviderAuth } from "../api-auth";
import { getDb } from "../db";
import { invalidateCatalog } from "../service-catalog";
import { MetadataError, validateServiceMetadata, type ServiceMetadata } from "../service-metadata";
import { encryptWalletSecret } from "../wallets";

export interface RegisterOptions {
  /**
   * Local development gateway: create the provider on first use and accept any endpoint origin.
   * Never set on a deployed gateway, where providers are real organizations with wallets.
   */
  sandbox?: boolean;
}

const PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const ROUTE = /^\/[A-Za-z0-9_/-]*$/;
const PRICE = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;
const MAX_STROOPS = (1n << 63n) - 1n;

/** JSON with sorted keys: Postgres jsonb does not keep the caller's key order. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    : item);
}

function allowedOrigins(): string[] {
  return (process.env.SETTL_PROVIDER_ALLOWED_ORIGINS?.trim() || "http://localhost:3001,http://127.0.0.1:3001")
    .split(",").map((value) => value.trim()).filter(Boolean);
}

async function ensureSandboxProvider(db: PrismaClient, providerId: string): Promise<void> {
  const keypair = Keypair.random();
  await db.$transaction(async (tx) => {
    const org = await tx.org.create({ data: {
      // Namespaced so a provider named like a seeded organization (for example "acme") cannot collide with it.
      id: `org_provider_${providerId}`, name: providerId, contactName: providerId, email: `${providerId}@sandbox.invalid`, role: "provider",
      walletPublic: keypair.publicKey(), walletSecretEnc: encryptWalletSecret(keypair.secret()),
    } });
    await tx.provider.create({ data: { id: providerId, orgId: org.id, displayName: providerId, merchantWallet: org.walletPublic } });
    await tx.providerSettings.create({ data: { providerId, autoClaimEnabled: false, autoClaimThreshold: 0n } });
  });
}

/**
 * Register a per-call endpoint described in code. Safe to repeat: an existing route is returned
 * as it is, with the fields that differ from the caller's code listed under `drift`. Prices, names and
 * URLs are never changed through this credential; the dashboard owns them. Metadata the endpoint does
 * not have yet (description, inputSchema, example) is filled in and listed under `filled`.
 */
export async function handleRegister(request: Request, options: RegisterOptions = {}): Promise<Response> {
  try {
    requireProviderAuth(request);
    const body = await readObjectBody(request);
    if (!isNonEmptyString(body.providerId) || !PROVIDER_ID.test(body.providerId)
      || !isNonEmptyString(body.name) || body.name.trim().length > 120
      || !isNonEmptyString(body.route) || !ROUTE.test(body.route)
      || typeof body.pricePhp !== "string" || !PRICE.test(body.pricePhp) || Number(body.pricePhp) <= 0
      || body.mode !== "per_call" || !isNonEmptyString(body.url)) throw new ApiError(400, "invalid_endpoint");

    let url: URL;
    try { url = new URL(body.url); } catch { throw new ApiError(400, "invalid_endpoint_url"); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) throw new ApiError(400, "invalid_endpoint_url");
    if (!options.sandbox && !allowedOrigins().includes(url.origin)) throw new ApiError(400, "provider_origin_not_allowed");

    const METADATA_CODES = { description: "invalid_description", inputSchema: "invalid_input_schema", example: "invalid_example" } as const;
    let metadata: ServiceMetadata;
    try {
      metadata = await validateServiceMetadata({ description: body.description, inputSchema: body.inputSchema, example: body.example });
    } catch (error) {
      if (error instanceof MetadataError) throw new ApiError(400, METADATA_CODES[error.field]);
      throw error;
    }

    const price = phpToStroops(Number(body.pricePhp), Number(process.env.PHP_PER_XLM ?? "15"));
    if (price < 1n || price > MAX_STROOPS) throw new ApiError(400, "invalid_endpoint");

    const providerId = body.providerId;
    const name = body.name.trim();
    const route = body.route;
    const db = getDb();
    if (!(await db.provider.findUnique({ where: { id: providerId }, select: { id: true } }))) {
      if (!options.sandbox) throw new ApiError(404, "provider_not_found");
      await ensureSandboxProvider(db, providerId);
    }

    const find = () => db.endpoint.findUnique({
      where: { providerId_method_route: { providerId, method: "POST", route } },
      select: { id: true, name: true, url: true, price: true, description: true, inputSchema: true, example: true },
    });
    type Existing = NonNullable<Awaited<ReturnType<typeof find>>>;
    const metadataKeys = (Object.keys(metadata) as Array<keyof ServiceMetadata>);
    const isEmpty = (value: unknown) => value === null || value === undefined;
    const drift = (existing: Existing) => [
      ...(existing.name !== name ? ["name"] : []),
      ...(existing.price !== price ? ["price"] : []),
      ...(existing.url !== url.toString() ? ["url"] : []),
      // Only metadata the caller sent can drift; absent fields say nothing about the caller's intent.
      ...metadataKeys.filter((key) => !isEmpty(existing[key]) && canonical(existing[key]) !== canonical(metadata[key])),
    ];
    const answer = async (existing: Existing) => {
      const filled = metadataKeys.filter((key) => isEmpty(existing[key]));
      if (filled.length > 0) {
        await db.endpoint.update({
          where: { id: existing.id },
          data: Object.fromEntries(filled.map((key) => [key, metadata[key]])) as Prisma.EndpointUpdateInput,
        });
        invalidateCatalog();
      }
      return jsonResponse({ endpointId: existing.id, created: false, drift: drift(existing), ...(filled.length > 0 ? { filled } : {}) });
    };

    const existing = await find();
    if (existing) return answer(existing);
    try {
      const endpoint = await db.endpoint.create({ data: {
        providerId, name, method: "POST", route, url: url.toString(), price, mode: "per_call",
        ...(metadata as Pick<Prisma.EndpointUncheckedCreateInput, "description" | "inputSchema" | "example">),
      } });
      invalidateCatalog();
      return jsonResponse({ endpointId: endpoint.id, created: true, drift: [] }, 201);
    } catch (error) {
      // Another instance registered the same route between our read and write.
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
        const raced = await find();
        if (raced) return answer(raced);
      }
      throw error;
    }
  } catch (error) {
    return apiErrorResponse(error);
  }
}
