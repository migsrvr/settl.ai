import { requireBuyerOrg, apiErrorResponse } from '@/lib/server/api-auth';
import { loadCallHistory } from '@/lib/server/dashboard';

export async function GET(request: Request) {
  try {
    const { orgId } = await requireBuyerOrg(request);
    const query = new URL(request.url).searchParams;
    const data = await loadCallHistory(orgId, 'buyer', { cursor: query.get('cursor') ?? undefined, q: query.get('q') ?? undefined, status: query.get('status') ?? undefined }, query.get('agentId') || undefined);
    return Response.json(data, { headers: { 'cache-control': 'private, no-store' } });
  } catch (error) {
    const response = apiErrorResponse(error); response.headers.set('cache-control', 'private, no-store'); return response;
  }
}
