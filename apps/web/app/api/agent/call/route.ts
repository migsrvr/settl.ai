import { executeCall } from "@/lib/server/broker";
import { ApiError, apiErrorResponse, isNonEmptyString, jsonResponse, readObjectBody, requireAgentAuth } from "@/lib/server/api-auth";

export async function POST(request: Request): Promise<Response> {
  try {
    const { agentId } = await requireAgentAuth(request);
    const body = await readObjectBody(request);
    if (!isNonEmptyString(body.endpointId)) throw new ApiError(400, "invalid_body");
    if (body.maxPricePhp !== undefined
      && (typeof body.maxPricePhp !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(body.maxPricePhp))) {
      throw new ApiError(400, "invalid_body");
    }
    if (body.approvalId !== undefined && !isNonEmptyString(body.approvalId)) throw new ApiError(400, "invalid_body");
    const result = await executeCall({
      agentId,
      endpointId: body.endpointId,
      ...(body.input === undefined ? {} : { input: body.input }),
      ...(body.maxPricePhp === undefined ? {} : { maxPricePhp: body.maxPricePhp }),
      ...(body.approvalId === undefined ? {} : { approvalId: body.approvalId }),
    });
    return jsonResponse(result, result.status === "pending" ? 202 : 200);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
