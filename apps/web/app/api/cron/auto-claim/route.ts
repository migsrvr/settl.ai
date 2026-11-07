import { createHash, timingSafeEqual } from "node:crypto";
import { ApiError, apiErrorResponse, jsonResponse } from "@/lib/server/api-auth";
import { autoClaimProviders } from "@/lib/server/claims";
import { flushAutomationEvents, flushDueDeliveries } from "@/lib/server/dispatcher";
import { processPaidTopups } from "@/lib/server/velo";

// Vercel Cron invokes GET; external POST schedulers retain the same handler.
export async function GET(request: Request): Promise<Response> {
  return POST(request);
}

export async function POST(request: Request): Promise<Response> {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret?.trim()) throw new ApiError(503, "cron_auth_unavailable");
    const token = /^Bearer ([^\s,]+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
    if (!token || !timingSafeEqual(createHash("sha256").update(token).digest(), createHash("sha256").update(secret).digest())) throw new ApiError(401, "unauthorized");
    let automations: Awaited<ReturnType<typeof flushAutomationEvents>> | undefined;
    let error: unknown;
    try { automations = await flushAutomationEvents(); } catch (cause) { error = cause; }
    const [deliveries, claims, topups] = await Promise.allSettled([flushDueDeliveries(), autoClaimProviders(), processPaidTopups()]);
    if (error || deliveries.status === "rejected" || claims.status === "rejected" || topups.status === "rejected") throw new ApiError(500, "automation_failed");
    if ((automations?.errors ?? 0) > 0 || claims.value.failed > 0 || topups.value.failed > 0 || topups.value.pending > 0 || topups.value.blocked) throw new ApiError(500, "automation_incomplete");
    return jsonResponse({ automations, deliveries: deliveries.value, claims: claims.value, topups: topups.value });
  } catch (error) { return apiErrorResponse(error); }
}
