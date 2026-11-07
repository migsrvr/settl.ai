import { apiErrorResponse, requireBuyerOrg } from '@/lib/server/api-auth';
import { readAgentProvisioning } from '@/lib/server/agent-provisioning-status';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { orgId } = await requireBuyerOrg(request);
    const data = await readAgentProvisioning(orgId, (await context.params).id);
    return Response.json(data, { headers: { 'cache-control': 'private, no-store' } });
  } catch (error) {
    const response = apiErrorResponse(error); response.headers.set('cache-control', 'private, no-store'); return response;
  }
}
