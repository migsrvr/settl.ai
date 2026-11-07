// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ org: vi.fn(), agent: vi.fn(), provider: vi.fn(), updateAgent: vi.fn(), updateProvider: vi.fn(), balance: vi.fn(), pending: vi.fn() }));
vi.mock('./db', () => ({ getDb: () => ({ org: { findUnique: m.org }, agent: { findFirst: m.agent, updateMany: m.updateAgent }, provider: { findUnique: m.provider, updateMany: m.updateProvider } }) }));
vi.mock('@settl/stellar', () => ({ loadStellarConfig: () => ({}), createStellarClient: () => ({ balanceOf: m.balance, pendingBalance: m.pending }) }));
import { GET as agentGet } from '../../app/api/agents/[id]/balance/route';
import { GET as providerGet } from '../../app/api/provider/balance/route';
const ctx = { params: Promise.resolve({ id: 'a' }) };
const request = (cookie = 'buyer') => new Request('https://settl.test/api/balance', { headers: { cookie: `settl_demo=${cookie}` } });
beforeEach(() => { vi.resetAllMocks(); m.org.mockResolvedValue({ id: 'org', role: 'buyer' }); m.agent.mockResolvedValue(null); });
describe('private dashboard balance routes', () => {
  it('rejects unauthenticated and cross-role requests before observing balances', async () => {
    expect((await agentGet(request(''), ctx)).status).toBe(401); expect((await agentGet(request('provider'), ctx)).status).toBe(401);
    expect((await providerGet(request('buyer'))).status).toBe(401); expect(m.agent).not.toHaveBeenCalled();
  });
  it('rejects cross-organization agent access without an RPC', async () => {
    const res = await agentGet(request(), ctx); expect(res.status).toBe(404);
    expect(m.agent).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'a', orgId: 'org' } })); expect(m.balance).not.toHaveBeenCalled();
  });
  it('returns private fresh snapshots without chain reads', async () => {
    m.agent.mockResolvedValue({ id: 'a', deviceHash: 'h', cachedBalance: 2n, balanceUpdatedAt: new Date() });
    const res = await agentGet(request(), ctx); expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.json()).toMatchObject({ amountStroops: '2', source: 'cache' }); expect(m.balance).not.toHaveBeenCalled();
  });
  it('persists provider observations scoped to the authenticated provider', async () => {
    m.org.mockResolvedValue({ id: 'mara', role: 'provider' }); m.provider.mockResolvedValue({ id: 'resibo', merchantWallet: 'GM', cachedPendingBalance: null }); m.pending.mockResolvedValue(9n);
    const res = await providerGet(request('provider')); expect(res.status).toBe(200); expect(await res.json()).toMatchObject({ amountStroops: '9', source: 'chain' });
    expect(m.provider).toHaveBeenCalledWith(expect.objectContaining({ where: { orgId: 'mara' } }));
    expect(m.updateProvider).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'resibo', orgId: 'mara' }) }));
  });
});
