import { createHash, timingSafeEqual } from "node:crypto";
import { getDb } from "./db";
import { resolveSession, SESSION_COOKIE } from "../auth";
import type { Role } from "../auth";

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(code);
    this.name = "ApiError";
  }
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function bearerToken(request: Request): string | undefined {
  return /^Bearer ([^\s,]+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
}

/** Shared demo provider service credential; compare fixed-length digests. */
export function requireProviderAuth(request: Request): void {
  const configuredKey = process.env.SETTL_PROVIDER_KEY;
  if (!configuredKey?.trim()) throw new ApiError(503, "provider_auth_unavailable");
  const token = bearerToken(request);
  if (!token) throw new ApiError(401, "unauthorized");
  const suppliedDigest = createHash("sha256").update(token).digest();
  const configuredDigest = createHash("sha256").update(configuredKey).digest();
  if (!timingSafeEqual(suppliedDigest, configuredDigest)) throw new ApiError(401, "unauthorized");
}

/** Only the stored key determines which agent is allowed to spend. */
export async function requireAgentAuth(request: Request): Promise<{ agentId: string }> {
  const token = bearerToken(request);
  if (!token?.startsWith("stl_agent_") || token.length <= "stl_agent_".length) {
    throw new ApiError(401, "unauthorized");
  }
  const keyHash = createHash("sha256").update(token).digest("hex");
  const key = await getDb().agentApiKey.findUnique({ where: { keyHash }, include: { agent: true } });
  if (!key || key.revokedAt || !key.agent) throw new ApiError(401, "unauthorized");
  if (key.agent.status !== "active") throw new ApiError(403, "agent_inactive");
  return { agentId: key.agentId };
}

/** Existing testnet demo session; ownership still comes from the stored org. */
export async function requireBuyerOrg(request: Request): Promise<{ orgId: string }> {
  return requireWorkspaceOrg(request, "buyer");
}
export async function requireProviderOrg(request: Request): Promise<{ orgId: string }> {
  return requireWorkspaceOrg(request, "provider");
}
async function requireWorkspaceOrg(request: Request, role: Role): Promise<{ orgId: string }> {
  const values = (request.headers.get("cookie") ?? "").split(";").map((value) => value.trim())
    .filter((value) => value.startsWith(`${SESSION_COOKIE}=`)).map((value) => value.slice(SESSION_COOKIE.length + 1));
  const session = values.length === 1 ? resolveSession(values[0]) : null;
  if (!session || session.role !== role) throw new ApiError(401, `${role}_auth_required`);
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") throw new ApiError(403, `${role}_origin_forbidden`);
  const org = await getDb().org.findUnique({ where: { email: session.email }, select: { id: true, role: true } });
  if (!org || org.role !== role) throw new ApiError(401, `${role}_auth_required`);
  return { orgId: org.id };
}

export async function readObjectBody(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiError(400, "invalid_body");
  }
  if (!isObject(body)) throw new ApiError(400, "invalid_body");
  return body;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

/** Accept only an HTTP error status and a safe public code; never echo messages. */
export function apiErrorResponse(error: unknown): Response {
  let status = 500;
  let code = "internal_error";
  if (isObject(error)
    && typeof error.status === "number" && Number.isInteger(error.status) && error.status >= 400 && error.status <= 599
    && typeof error.code === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(error.code)) {
    status = error.status;
    code = error.code;
  }
  const message = code === "buyer_auth_required" ? "Sign in to the buyer workspace to continue."
    : code === "provider_auth_required" ? "Sign in to the provider workspace to continue."
    : status === 400 ? "The request body is invalid."
    : status === 401 ? "A valid bearer credential is required."
      : status === 403 ? "This request is not permitted."
        : status === 404 ? "The requested resource was not found."
          : status === 409 ? "The request conflicts with the current payment state."
            : status === 503 ? "The service is temporarily unavailable."
              : "The request could not be completed.";
  const response = jsonResponse({ error: code, message }, status);
  if (status === 401 && code !== "buyer_auth_required" && code !== "provider_auth_required") response.headers.set("www-authenticate", "Bearer");
  return response;
}
