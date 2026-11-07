// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ org: vi.fn(), payments: vi.fn() }));
vi.mock('./db', () => ({ getDb: () => ({ org: { findUnique: m.org }, payment: { findMany: m.payments } }) }));
import { GET as buyer } from '../../app/api/buyer/calls/route';
import { GET as provider } from '../../app/api/provider/calls/route';
beforeEach(() => { vi.resetAllMocks(); m.org.mockResolvedValue({ id: 'o', role: 'buyer' }); m.payments.mockResolvedValue([]); });
it('keeps cursor, search, and status filters inside the buyer organization', async () => {
  const cursor = Buffer.from(JSON.stringify({ id: 'end', at: '2026-11-07T00:00:00Z' })).toString('base64url');
  const res = await buyer(new Request(`https://settl.test/api/buyer/calls?agentId=a&status=paid&q=receipt&cursor=${cursor}`, { headers: { cookie: 'settl_demo=buyer' } }));
  expect(res.status).toBe(200); expect(res.headers.get('cache-control')).toBe('private, no-store');
  expect(await res.json()).toEqual({ calls: [], nextCursor: null });
  expect(m.payments).toHaveBeenCalledWith(expect.objectContaining({ take: 26, where: expect.objectContaining({ status: 'paid', quote: { agent: { orgId: 'o' }, agentId: 'a' }, AND: expect.any(Array), OR: expect.any(Array) }) }));
});
it('rejects wrong roles before history access', async () => {
  expect((await provider(new Request('https://settl.test/api/provider/calls', { headers: { cookie: 'settl_demo=buyer' } }))).status).toBe(401);
  expect(m.payments).not.toHaveBeenCalled();
});
it('provider history always scopes by stored provider organization', async () => {
  m.org.mockResolvedValue({ id: 'mara', role: 'provider' });
  expect((await provider(new Request('https://settl.test/api/provider/calls', { headers: { cookie: 'settl_demo=provider' } }))).status).toBe(200);
  expect(m.payments).toHaveBeenCalledWith(expect.objectContaining({ where: { quote: { endpoint: { provider: { orgId: 'mara' } } } } }));
});
