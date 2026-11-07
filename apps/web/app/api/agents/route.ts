import { ApiError, apiErrorResponse, jsonResponse, readObjectBody, requireBuyerOrg } from "@/lib/server/api-auth";
import { createAgent } from "@/lib/server/agents";
import { after } from 'next/server';
import { provisionAgent } from '@/lib/server/agent-provisioning';
import { createTimingTracker } from '@/lib/server/timing';

export async function POST(request: Request): Promise<Response> {
  const timing = createTimingTracker('agents.create');
  try {
    const { orgId } = await timing.measure('auth', () => requireBuyerOrg(request));
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) throw new ApiError(400, "invalid_body");
    const body = await readObjectBody(request);
    const result = await timing.measure('db', () => createAgent(orgId, body));
    if (result.status === 'provisioning') {
      // Registration is durably queued already. Scheduling must not lose the key.
      try { after(async () => {
        try { await provisionAgent(result.agentId); }
        catch { console.warn('settl_provisioning_background_failed'); }
      }); }
      catch { console.warn('settl_provisioning_schedule_unavailable'); }
    }
    timing.finish('queued');
    return jsonResponse(result, 202);
  } catch (error) { timing.finish('rejected'); return apiErrorResponse(error); }
}
