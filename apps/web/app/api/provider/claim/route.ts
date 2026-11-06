import { ApiError, apiErrorResponse, jsonResponse, readObjectBody, requireProviderOrg } from "@/lib/server/api-auth";
import { getDb } from "@/lib/server/db";
import { claimProvider } from "@/lib/server/claims";
export async function POST(request: Request): Promise<Response> {
  try {
    const { orgId } = await requireProviderOrg(request);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) throw new ApiError(400, "invalid_body");
    await readObjectBody(request);
    const provider = await getDb().provider.findUnique({ where: { orgId }, select: { id: true } });
    if (!provider) throw new ApiError(404, "provider_not_found");
    const result = await claimProvider(provider.id, { manual: true });
    return jsonResponse(result, result.status === "pending" ? 202 : result.status === "failed" ? 502 : 200);
  } catch (error) { return apiErrorResponse(error); }
}
