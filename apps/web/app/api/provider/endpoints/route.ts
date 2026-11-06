import { ApiError, apiErrorResponse, isNonEmptyString, jsonResponse, readObjectBody, requireProviderOrg } from "@/lib/server/api-auth";
import { getDb } from "@/lib/server/db";
export async function POST(request: Request): Promise<Response> {
  try {
    const { orgId } = await requireProviderOrg(request);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) throw new ApiError(400, "invalid_body");
    const body = await readObjectBody(request);
    if (!isNonEmptyString(body.name) || body.name.length > 120 || body.method !== "POST" || !isNonEmptyString(body.route) || !/^\/[A-Za-z0-9_/-]*$/.test(body.route)
      || typeof body.priceStroops !== "string" || !/^[1-9]\d{0,18}$/.test(body.priceStroops) || BigInt(body.priceStroops) > (1n << 63n) - 1n || (body.mode !== "per_call" && body.mode !== "outcome") || !isNonEmptyString(body.url)) throw new ApiError(400, "invalid_endpoint");
    let url: URL;
    try { url = new URL(body.url); } catch { throw new ApiError(400, "invalid_endpoint_url"); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) throw new ApiError(400, "invalid_endpoint_url");
    const origins = (process.env.SETTL_PROVIDER_ALLOWED_ORIGINS?.trim() || "http://localhost:3001,http://127.0.0.1:3001").split(",").map((value) => value.trim()).filter(Boolean);
    if (!origins.includes(url.origin)) throw new ApiError(400, "provider_origin_not_allowed");
    if (body.mode === "outcome" && body.criteriaId !== "receipt_v1" && body.criteriaId !== "resibo.receipt.v1") throw new ApiError(400, "invalid_criteria");
    const provider = await getDb().provider.findUnique({ where: { orgId }, select: { id: true } });
    if (!provider) throw new ApiError(404, "provider_not_found");
    const endpoint = await getDb().endpoint.create({ data: {
      providerId: provider.id, name: body.name.trim(), method: "POST", route: body.route, url: url.toString(), price: BigInt(body.priceStroops), mode: body.mode as "per_call" | "outcome",
      ...(body.mode === "outcome" ? { criteriaId: "resibo.receipt.v1", criteria: { schema: "resibo.receipt.v1", required: ["merchant_name", "date", "total", "line_items"], minConfidence: .85, lineItemsSumToTotal: { tolerance: .01 } } } : {}),
    } });
    return jsonResponse({ endpointId: endpoint.id }, 201);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") return apiErrorResponse(new ApiError(409, "endpoint_already_registered"));
    return apiErrorResponse(error);
  }
}
