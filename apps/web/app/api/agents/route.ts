import { ApiError, apiErrorResponse, jsonResponse, readObjectBody, requireBuyerOrg } from "@/lib/server/api-auth";
import { createAgent } from "@/lib/server/agents";

export async function POST(request: Request): Promise<Response> {
  try {
    const { orgId } = await requireBuyerOrg(request);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) throw new ApiError(400, "invalid_body");
    const body = await readObjectBody(request);
    const result = await createAgent(orgId, body);
    // Every persisted creation outcome carries the key shown only this once,
    // including provisioning and account/chain setup failures.
    return jsonResponse(result, result.status === "active" ? 201 : result.status === "provisioning" ? 202 : 200);
  } catch (error) { return apiErrorResponse(error); }
}
