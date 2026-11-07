import { requireBuyerOrg, apiErrorResponse } from '@/lib/server/api-auth';
import { observeAgentBalance } from '@/lib/server/balances';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { orgId } = await requireBuyerOrg(request);
    const balance = await observeAgentBalance(orgId, (await context.params).id);
    return Response.json(balance, { headers: { 'cache-control': 'private, no-store' } });
  } catch (error) {
    const response = apiErrorResponse(error);
    response.headers.set('cache-control', 'private, no-store');
    return response;
  }
}
