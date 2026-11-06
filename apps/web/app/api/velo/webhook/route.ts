import { apiErrorResponse, jsonResponse } from "@/lib/server/api-auth";
import { handleVeloWebhook } from "@/lib/server/velo";

export async function POST(request: Request): Promise<Response> {
  try {
    return jsonResponse(await handleVeloWebhook({ payload: await request.text(), signature: request.headers.get("x-velo-signature"), deliveryId: request.headers.get("x-velo-delivery") }));
  } catch (error) {
    const response = apiErrorResponse(error);
    const body = await response.clone().json() as { error: string };
    console.warn("velo_webhook_rejected", { status: response.status, code: body.error });
    return response;
  }
}
