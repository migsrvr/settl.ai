import { ApiError, apiErrorResponse, jsonResponse, readObjectBody, requireBuyerOrg } from "@/lib/server/api-auth";
import { updateAgentPolicy } from "@/lib/server/agents";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { orgId } = await requireBuyerOrg(request);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) throw new ApiError(400, "invalid_body");
    const body = await readObjectBody(request);
    const { id } = await context.params;
    if (!id?.trim()) throw new ApiError(404, "agent_not_found");
    const result = await updateAgentPolicy(orgId, id, body);
    return jsonResponse(result, result.status === "active" ? 200 : result.status === "pending" ? 202 : 502);
  } catch (error) { return apiErrorResponse(error); }
}
