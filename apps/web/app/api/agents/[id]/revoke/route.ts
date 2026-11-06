import { ApiError, apiErrorResponse, jsonResponse, requireBuyerOrg } from "@/lib/server/api-auth";
import { revokeAgent } from "@/lib/server/agents";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { orgId } = await requireBuyerOrg(request);
    const { id } = await context.params;
    if (!id?.trim()) throw new ApiError(404, "agent_not_found");
    const result = await revokeAgent(orgId, id);
    return jsonResponse(result, result.status === "revoked" ? 200 : result.status === "pending" ? 202 : 502);
  } catch (error) { return apiErrorResponse(error); }
}
