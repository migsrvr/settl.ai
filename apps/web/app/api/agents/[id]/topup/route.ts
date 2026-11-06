import { ApiError, apiErrorResponse, jsonResponse, readObjectBody, requireBuyerOrg } from "@/lib/server/api-auth";
import { createTopup } from "@/lib/server/velo";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { orgId } = await requireBuyerOrg(request);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) throw new ApiError(400, "invalid_body");
    const body = await readObjectBody(request);
    const { id } = await context.params;
    if (!id?.trim()) throw new ApiError(404, "agent_not_found");
    return jsonResponse(await createTopup({ orgId, agentId: id, amountStroops: body.amountStroops, origin: new URL(request.url).origin }));
  } catch (error) { return apiErrorResponse(error); }
}
