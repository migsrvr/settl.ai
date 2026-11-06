import { inspectOutcome, verifyOutcome } from "@/lib/server/broker";
import { ApiError, apiErrorResponse, isNonEmptyString, jsonResponse, readObjectBody, requireProviderAuth } from "@/lib/server/api-auth";

export async function POST(request: Request): Promise<Response> {
  try {
    requireProviderAuth(request);
    const body = await readObjectBody(request);
    if (!isNonEmptyString(body.quoteId) || !isNonEmptyString(body.endpointId)) throw new ApiError(400, "invalid_body");
    if (body.reservationId !== undefined && !isNonEmptyString(body.reservationId)) throw new ApiError(400, "invalid_body");
    if (body.checkOnly !== undefined && typeof body.checkOnly !== "boolean") throw new ApiError(400, "invalid_body");
    const identity = { quoteId: body.quoteId, endpointId: body.endpointId, ...(body.reservationId === undefined ? {} : { reservationId: body.reservationId }) };
    if (body.checkOnly === true) return jsonResponse(await inspectOutcome(identity));
    if (!Object.hasOwn(body, "result")) throw new ApiError(400, "invalid_body");
    const result = await verifyOutcome({ ...identity, result: body.result });
    return jsonResponse(result, result.verification === "pending" ? 202 : 200);
  } catch (error) { return apiErrorResponse(error); }
}
