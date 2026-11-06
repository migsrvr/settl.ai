import { QuoteSchema } from "@settl/core";
import { createQuote } from "@/lib/server/broker";
import { ApiError, apiErrorResponse, isNonEmptyString, isObject, jsonResponse, readObjectBody, requireProviderAuth } from "@/lib/server/api-auth";

export async function POST(request: Request): Promise<Response> {
  try {
    requireProviderAuth(request);
    const body = await readObjectBody(request);
    if (!isNonEmptyString(body.endpointId)) throw new ApiError(400, "invalid_body");
    let agentHint: { agentId?: string; agent?: string; deviceHash?: string } | undefined;
    if (body.agentHint !== undefined) {
      if (!isObject(body.agentHint)) throw new ApiError(400, "invalid_body");
      agentHint = {};
      for (const field of ["agentId", "agent", "deviceHash"] as const) {
        const value = body.agentHint[field];
        if (value !== undefined) {
          if (!isNonEmptyString(value)) throw new ApiError(400, "invalid_body");
          agentHint[field] = value;
        }
      }
    }
    const quote = await createQuote({ endpointId: body.endpointId, ...(agentHint === undefined ? {} : { agentHint }) });
    return jsonResponse(QuoteSchema.parse(quote));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
