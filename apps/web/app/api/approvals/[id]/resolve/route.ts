import { ApiError, apiErrorResponse, jsonResponse, readObjectBody, requireBuyerOrg } from "@/lib/server/api-auth";
import { resolveApproval } from "@/lib/server/approval-resolution";
import { getDb } from "@/lib/server/db";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { orgId } = await requireBuyerOrg(request);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) throw new ApiError(400, "invalid_body");
    const body = await readObjectBody(request);
    if (body.decision !== "approved" && body.decision !== "declined") throw new ApiError(400, "invalid_decision");
    const decision = body.decision;
    const { id } = await context.params;
    if (!id?.trim()) throw new ApiError(404, "approval_not_found");
    const resolution = await resolveApproval(getDb(), { id, decision, orgId });
    return jsonResponse(resolution);
  } catch (error) { return apiErrorResponse(error); }
}
