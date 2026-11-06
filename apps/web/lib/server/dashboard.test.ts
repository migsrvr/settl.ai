// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ cookie: 'buyer', connection: vi.fn(), org: vi.fn(), agents: vi.fn(), payments: vi.fn(), approvals: vi.fn(), providers: vi.fn(), provider: vi.fn(), balance: vi.fn(), pending: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: mocks.cookie }) }) }));
vi.mock('next/server', () => ({ connection: mocks.connection }));
vi.mock('./db', () => ({ getDb: () => ({ org: { findUnique: mocks.org }, agent: { findMany: mocks.agents }, payment: { findMany: mocks.payments }, approval: { findMany: mocks.approvals }, provider: { findMany: mocks.providers, findUnique: mocks.provider } }) }));
vi.mock('@settl/stellar', () => ({ loadStellarConfig: () => ({}), createStellarClient: () => ({ balanceOf: mocks.balance, pendingBalance: mocks.pending }) }));
import { loadBuyerDashboard, loadProviderDashboard } from './dashboard';
describe('live dashboard ownership and safe DTOs', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.cookie = 'buyer'; mocks.org.mockResolvedValue({ id: 'juan', role: 'buyer', name: 'Juan', walletPublic: 'GJUAN' }); mocks.agents.mockResolvedValue([]); mocks.payments.mockResolvedValue([]); mocks.approvals.mockResolvedValue([]); mocks.providers.mockResolvedValue([]); });
  it.each(['buyer', 'provider'] as const)('waits for a request before reading %s dashboard data or the current time', async (role) => {
    mocks.cookie = role;
    let allowRequest!: () => void;
    mocks.connection.mockReturnValueOnce(new Promise<void>(resolve => { allowRequest = resolve; }));
    const clock = vi.spyOn(globalThis, 'Date');
    try {
      const loading = role === 'buyer' ? loadBuyerDashboard() : loadProviderDashboard();
      await Promise.resolve();
      expect(mocks.connection).toHaveBeenCalledOnce();
      expect(mocks.org).not.toHaveBeenCalled();
      expect(mocks.approvals).not.toHaveBeenCalled();
      expect(clock).not.toHaveBeenCalled();
      allowRequest();
      await loading;
    } finally { allowRequest(); clock.mockRestore(); }
  });
  it.each(['buyer', 'provider'] as const)('does not swallow the %s prerender suspension signal', async (role) => {
    mocks.cookie = role;
    const suspension = new Error('prerender interrupted');
    mocks.connection.mockRejectedValueOnce(suspension);
    await expect(role === 'buyer' ? loadBuyerDashboard() : loadProviderDashboard()).rejects.toBe(suspension);
    expect(mocks.org).not.toHaveBeenCalled();
  });
  it('rejects a provider cookie before querying buyer data', async () => { mocks.cookie = 'provider'; expect(await loadBuyerDashboard()).toBeNull(); expect(mocks.org).not.toHaveBeenCalled(); });
  it('requires the stored organization role and scopes every buyer query', async () => {
    const data = await loadBuyerDashboard(); expect(data?.agents).toEqual([]);
    expect(mocks.org).toHaveBeenCalledWith(expect.objectContaining({ where: { email: 'juan@example.com' } }));
    expect(mocks.agents).toHaveBeenCalledWith(expect.objectContaining({ where: { orgId: 'juan' } }));
    expect(mocks.payments).toHaveBeenCalledWith(expect.objectContaining({ where: { quote: { agent: { orgId: 'juan' } } } }));
    mocks.org.mockResolvedValue({ id: 'juan', role: 'provider' }); expect(await loadBuyerDashboard()).toBeNull();
  });
  it('keeps unknown balances unavailable and strips wallet secrets', async () => {
    mocks.agents.mockResolvedValue([{ id: 'owned', name: 'Agent', status: 'active', agentPublic: 'GAGENT', deviceHash: 'hash', policy: null, topups: [], reservations: [], agentSecretEnc: 'SECRET', apiKeys: [{ keyHash: 'HASH' }] }]); mocks.balance.mockRejectedValue(new Error('chain down'));
    const data = await loadBuyerDashboard(); expect(data?.agents[0].balance.amountStroops).toBeNull(); expect(JSON.stringify(data)).not.toMatch(/SECRET|keyHash|agentSecretEnc/);
  });
  it('uses a dated cache only when the fresh chain read fails', async () => {
    mocks.agents.mockResolvedValue([{ id: 'owned', name: 'Agent', status: 'active', agentPublic: 'GAGENT', deviceHash: 'hash', policy: null, topups: [], reservations: [], cachedBalance: 99n, balanceUpdatedAt: new Date('2026-11-05T12:00:00Z') }]); mocks.balance.mockRejectedValue(new Error('chain down'));
    expect((await loadBuyerDashboard())?.agents[0].balance).toEqual({ amountStroops: '99', source: 'cache', asOf: '2026-11-05T12:00:00.000Z' });
    mocks.balance.mockResolvedValue(123n); expect((await loadBuyerDashboard())?.agents[0].balance).toMatchObject({ amountStroops: '123', source: 'chain' });
  });
  it('scopes provider earnings to owned endpoints and reads the actual merchant balance', async () => {
    mocks.cookie = 'provider'; mocks.org.mockResolvedValue({ id: 'mara', role: 'provider', name: 'Mara', walletPublic: 'GMARA' }); mocks.provider.mockResolvedValue({ id: 'resibo', displayName: 'Resibo', merchantWallet: 'GMERCHANT', endpoints: [], claims: [], settings: null }); mocks.pending.mockResolvedValue(42n);
    mocks.payments.mockResolvedValue([{ id: 'call', status: 'not_charged', submittedAt: new Date('2026-11-06T00:00:00Z'), confirmedAt: null, txHash: null, quote: { amount: 10n, agentId: 'agent', agent: { name: 'Agent', org: { name: 'Customer' } }, endpoint: { route: '/ocr', provider: { displayName: 'Resibo' } }, verification: { result: 'fail', reasons: [{ check: 'confidence', ok: false, note: 'Too low' }] } } }]);
    const data = await loadProviderDashboard(); expect(data?.pending.amountStroops).toBe('42'); expect(mocks.pending).toHaveBeenCalledWith('GMERCHANT'); expect(mocks.payments).toHaveBeenCalledWith(expect.objectContaining({ where: { quote: { endpoint: { provider: { orgId: 'mara' } } } } })); expect(data?.calls[0]).toMatchObject({ amountStroops: '0', quotedStroops: '10', verification: 'fail', checks: [{ check: 'confidence', ok: false, note: 'Too low' }] }); expect(() => JSON.stringify(data)).not.toThrow();
  });
  it('loads Acme independently of Juan and scopes its agents, payments and approvals', async () => {
    mocks.cookie = 'acme@example.com';
    mocks.org.mockResolvedValue({ id: 'org_acme', role: 'buyer', name: 'Acme AI Corp', walletPublic: 'GACME' });
    expect(await loadBuyerDashboard()).toMatchObject({ orgName: 'Acme AI Corp', agents: [] });
    expect(mocks.org).toHaveBeenCalledWith(expect.objectContaining({ where: { email: 'acme@example.com' } }));
    expect(mocks.agents).toHaveBeenCalledWith(expect.objectContaining({ where: { orgId: 'org_acme' } }));
    expect(mocks.payments).toHaveBeenCalledWith(expect.objectContaining({ where: { quote: { agent: { orgId: 'org_acme' } } } }));
    expect(mocks.approvals).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ agent: { orgId: 'org_acme' } }) }));
  });
  it('loads GeoPH independently of ResiboAI and scopes provider records and activity', async () => {
    mocks.cookie = 'geoph@example.com';
    mocks.org.mockResolvedValue({ id: 'org_geoph', role: 'provider', name: 'GeoPH', walletPublic: 'GGEOPH' });
    mocks.provider.mockResolvedValue({ id: 'geoph', displayName: 'GeoPH', merchantWallet: 'GGEOPH', endpoints: [], claims: [], settings: null });
    mocks.pending.mockResolvedValue(0n);
    expect(await loadProviderDashboard()).toMatchObject({ orgName: 'GeoPH', id: 'geoph' });
    expect(mocks.org).toHaveBeenCalledWith(expect.objectContaining({ where: { email: 'geoph@example.com' } }));
    expect(mocks.provider).toHaveBeenCalledWith(expect.objectContaining({ where: { orgId: 'org_geoph' } }));
    expect(mocks.payments).toHaveBeenCalledWith(expect.objectContaining({ where: { quote: { endpoint: { provider: { orgId: 'org_geoph' } } } } }));
    expect(mocks.pending).toHaveBeenCalledWith('GGEOPH');
  });
  it('rejects cross-role email sessions before reading organization data', async () => {
    mocks.cookie = 'geoph@example.com';
    expect(await loadBuyerDashboard()).toBeNull();
    mocks.cookie = 'acme@example.com';
    expect(await loadProviderDashboard()).toBeNull();
    expect(mocks.org).not.toHaveBeenCalled();
  });
  it('uses custom session identity but verifies the database role before loading records', async () => {
    mocks.cookie = 'buyer:custom@example.com';
    mocks.org.mockResolvedValue({ id: 'org_custom', role: 'provider' });
    expect(await loadBuyerDashboard()).toBeNull();
    expect(mocks.agents).not.toHaveBeenCalled();
    expect(mocks.org).toHaveBeenCalledWith(expect.objectContaining({ where: { email: 'custom@example.com' } }));
    mocks.org.mockResolvedValue({ id: 'org_custom', role: 'buyer', name: 'Custom', walletPublic: 'GCUSTOM' });
    expect(await loadBuyerDashboard()).toMatchObject({ orgName: 'Custom' });
    expect(mocks.agents).toHaveBeenCalledWith(expect.objectContaining({ where: { orgId: 'org_custom' } }));
  });
});
