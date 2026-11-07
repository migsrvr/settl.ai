import { requireProviderOrg, apiErrorResponse } from '@/lib/server/api-auth';
import { observeProviderBalance } from '@/lib/server/balances';

export async function GET(request: Request) {
  try {
    const { orgId } = await requireProviderOrg(request);
    const balance = await observeProviderBalance(orgId);
    return Response.json(balance, { headers: { 'cache-control': 'private, no-store' } });
  } catch (error) {
    const response = apiErrorResponse(error);
    response.headers.set('cache-control', 'private, no-store');
    return response;
  }
}
