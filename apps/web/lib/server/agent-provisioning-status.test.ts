// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ org: vi.fn(), agent: vi.fn() }));
vi.mock('./db', () => ({ getDb: () => ({ org: { findUnique: m.org }, agent: { findFirst: m.agent } }) }));
import { GET } from '../../app/api/agents/[id]/provisioning/route';
const at = new Date('2026-11-07T12:00:00Z');
const request = (cookie = 'buyer') => new Request('https://settl.test/api/agents/a/provisioning', { headers: { cookie: `settl_demo=${cookie}` } });
const context = { params: Promise.resolve({ id: 'a' }) };
beforeEach(() => { vi.resetAllMocks(); m.org.mockResolvedValue({ id: 'buyer', role: 'buyer' }); m.agent.mockResolvedValue(null); });
describe('read-only agent provisioning progress', () => {
  it('requires a buyer session and scopes status to its stored organization', async () => {
    expect((await GET(request('provider'), context)).status).toBe(401); expect(m.agent).not.toHaveBeenCalled();
    expect((await GET(request(), context)).status).toBe(404);
    expect(m.agent).toHaveBeenCalledWith({ where: { id: 'a', orgId: 'buyer' }, select: { id: true, status: true, updatedAt: true, lifecycleRecovery: true } });
  });
  it('projects only safe progress and public hashes from a checkpoint', async () => {
    m.agent.mockResolvedValue({ id: 'a', status: 'provisioning', updatedAt: at, agentSecretEnc: 'custody-secret', lifecycleRecovery: {
      version: 1, operation: 'create', stage: 'register_device', state: 'pending', updatedAt: at.toISOString(),
      lease: { token: 'lease-secret' }, apiKey: 'stl_agent_secret', errorCode: 'untrusted-private-code',
      transactions: [{ stage: 'register_device', hash: 'a'.repeat(64), innerHash: 'b'.repeat(64), recovery: { requestId: 'private-recovery' } }],
    } });
    const res = await GET(request(), context); expect(res.headers.get('cache-control')).toBe('private, no-store');
    const body = await res.json(); expect(body).toMatchObject({ agentId: 'a', status: 'provisioning', stage: 'register_device', state: 'pending', transactions: [{ stage: 'register_device', hash: 'a'.repeat(64) }] });
    expect(JSON.stringify(body)).not.toMatch(/custody|lease-secret|stl_agent|private-recovery|innerHash|untrusted-private-code/);
  });
  it('treats legacy provisioning as reviewable and never starts a worker', async () => {
    m.agent.mockResolvedValue({ id: 'a', status: 'provisioning', updatedAt: at, lifecycleRecovery: { operation: 'create', stage: 'register_device', state: 'working' } });
    expect(await (await GET(request(), context)).json()).toMatchObject({ needsReview: true, errorCode: 'reconciliation_required' });
  });
  it('reports ready only for an active stored agent', async () => {
    m.agent.mockResolvedValue({ id: 'a', status: 'active', updatedAt: at, lifecycleRecovery: null });
    expect(await (await GET(request(), context)).json()).toMatchObject({ status: 'active', stage: 'complete', state: 'complete', needsReview: false });
    m.agent.mockResolvedValue({ id: 'a', status: 'provisioning', updatedAt: at, lifecycleRecovery: { version: 1, operation: 'create', stage: 'complete', state: 'complete' } });
    expect(await (await GET(request(), context)).json()).toMatchObject({ status: 'provisioning', needsReview: true });
  });
  it('does not present an inconsistent versioned checkpoint as progressing normally', async () => {
    m.agent.mockResolvedValue({ id: 'a', status: 'provisioning', updatedAt: at, lifecycleRecovery: { version: 1, operation: 'create', stage: 'register_policy', state: 'working', transactions: [] } });
    expect(await (await GET(request(), context)).json()).toMatchObject({ needsReview: true, state: 'pending', errorCode: 'reconciliation_required' });
  });
});
