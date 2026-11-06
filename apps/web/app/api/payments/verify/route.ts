import { PaymentHeaderSchema } from "@settl/core";
import { verifyPayment } from "@/lib/server/broker";
import { ApiError, apiErrorResponse, isNonEmptyString, jsonResponse, readObjectBody, requireProviderAuth } from "@/lib/server/api-auth";

export async function POST(request: Request): Promise<Response> {
  try {
    requireProviderAuth(request);
    const body = await readObjectBody(request);
    const proof = PaymentHeaderSchema.safeParse(body.proof);
    if (!proof.success || proof.data.kind !== "tx" || !isNonEmptyString(proof.data.quoteId)) {
      throw new ApiError(400, "invalid_body");
    }
    if (body.endpointId !== undefined && !isNonEmptyString(body.endpointId)) throw new ApiError(400, "invalid_body");
    const result = await verifyPayment({ proof: proof.data, ...(body.endpointId === undefined ? {} : { endpointId: body.endpointId }) });
    return jsonResponse(result);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
