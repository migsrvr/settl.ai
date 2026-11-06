// @vitest-environment node
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    endpoint: { findMany: vi.fn() },
    agent: { findUnique: vi.fn() },
    payment: { findMany: vi.fn() },
    reservation: { aggregate: vi.fn() },
    approval: { findMany: vi.fn(), findFirst: vi.fn() },
  },
  balanceOf: vi.fn(), createQuote: vi.fn(), executeCall: vi.fn(),
}));

vi.mock('./db', () => ({ getDb: () => mocks.db }));
vi.mock('./broker', () => ({ createQuote: mocks.createQuote, executeCall: mocks.executeCall }));
vi.mock('@settl/stellar', () => ({
  loadStellarConfig: () => ({}),
  createStellarClient: () => ({ balanceOf: mocks.balanceOf }),
}));

import { createAgentMcpServer } from './mcp-tools';

const connections: { client: Client; handler: ReturnType<typeof createMcpHandler> }[] = [];

async function connect(agentId = 'agent-one') {
  const handler = createMcpHandler(() => createAgentMcpServer(agentId), { responseMode: 'sse' });
  const client = new Client(
    { name: 'settl-tool-tests', version: '1.0.0' },
    { versionNegotiation: { mode: 'auto' } },
  );
  connections.push({ client, handler });
  await client.connect(new StreamableHTTPClientTransport(new URL('https://settl.test/mcp'), {
    fetch: (url, init) => handler.fetch(new Request(url, init)),
  }));
  return client;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('PHP_PER_XLM', '15');
});

afterEach(async () => {
  for (const { client, handler } of connections.splice(0)) {
    await client.close();
    await handler.close();
  }
  vi.unstubAllEnvs();
});

describe('agent MCP tools', () => {
  it('advertises exactly the six validated tools', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'settl_call', 'settl_check_approval', 'settl_get_budget', 'settl_list_services', 'settl_quote', 'settl_receipts',
    ]);
    expect(tools.find((tool) => tool.name === 'settl_call')?.inputSchema.required).toContain('serviceId');
    expect(JSON.stringify(tools)).not.toContain('agentId');
  });

  it('lists only active services, uses exact prices and omits provider secrets', async () => {
    mocks.db.endpoint.findMany.mockResolvedValue([{
      id: 'service-one', name: 'Search', providerId: 'provider-one', price: 1234567n, mode: 'per_call',
      provider: { displayName: 'Search Co', merchantWallet: 'secret-wallet' },
    }]);
    const result = await (await connect()).callTool({ name: 'settl_list_services', arguments: {} });
    expect(mocks.db.endpoint.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { active: true } }));
    expect(result.structuredContent).toEqual({ services: [{
      id: 'service-one', name: 'Search', providerId: 'provider-one', providerName: 'Search Co', mode: 'per_call',
      displayPrice: { currency: 'PHP', amount: '1.85' }, amountStroops: '1234567',
    }] });
    expect(JSON.stringify(result)).not.toContain('secret-wallet');
  });

  it('keeps stroop and PHP amounts exact beyond the safe integer range', async () => {
    mocks.db.endpoint.findMany.mockResolvedValue([{
      id: 'large-service', name: 'Large', providerId: 'provider-one', price: 9007199254740993n,
      mode: 'outcome', provider: { displayName: 'Provider' },
    }]);
    const result = await (await connect()).callTool({ name: 'settl_list_services', arguments: {} });
    expect(result.structuredContent).toMatchObject({ services: [{
      amountStroops: '9007199254740993', displayPrice: { currency: 'PHP', amount: '13510798882.11' },
    }] });
  });

  it('binds quotes and calls to authenticated identity and preserves broker outcomes', async () => {
    const quote = {
      settl: '0.1', quoteId: 'quote-one', mode: 'per-call', network: 'stellar:testnet', asset: 'XLM',
      amountStroops: '100', displayPrice: { currency: 'PHP', amount: '0.00' },
      merchant: 'merchant-wallet', escrowContract: 'escrow-contract', expiresAt: '2026-11-05T02:00:00.000Z',
      resource: '/search', description: 'Search service',
    };
    mocks.createQuote.mockResolvedValue(quote);
    mocks.executeCall.mockResolvedValue({ status: 'approval_required', approvalId: 'approval-one' });
    const client = await connect();
    expect((await client.callTool({ name: 'settl_quote', arguments: { serviceId: 'service-one' } })).structuredContent).toEqual(quote);
    expect(mocks.createQuote).toHaveBeenCalledWith({ endpointId: 'service-one', agentHint: { agentId: 'agent-one' } });
    const result = await client.callTool({ name: 'settl_call', arguments: {
      serviceId: 'service-one', input: { query: 'hello' }, maxPricePhp: '1.50', approvalId: 'approval-one',
    } });
    expect(mocks.executeCall).toHaveBeenCalledWith({
      agentId: 'agent-one', endpointId: 'service-one', input: { query: 'hello' }, maxPricePhp: '1.50', approvalId: 'approval-one',
    });
    expect(result.structuredContent).toEqual({ status: 'approval_required', approvalId: 'approval-one' });
  });

  it('rejects invalid broker quote output without exposing unexpected fields', async () => {
    mocks.createQuote.mockResolvedValue({ quoteId: 'quote-invalid', privateCredential: 'never-expose-quote' });
    const result = await (await connect()).callTool({ name: 'settl_quote', arguments: { serviceId: 'service-one' } });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({ error: 'TOOL_FAILED' });
    expect(JSON.stringify(result)).not.toContain('never-expose-quote');
  });

  it.each([
    ['settl_call', { serviceId: 'service-one', agentId: 'other-agent' }],
    ['settl_call', { serviceId: 'service-one', maxPricePhp: '-1' }],
    ['settl_call', { serviceId: 'service-one', maxPricePhp: '1.001' }],
    ['settl_quote', { serviceId: ' ' }],
    ['settl_receipts', { limit: 0 }],
    ['settl_receipts', { limit: 101 }],
    ['settl_receipts', { limit: 1.5 }],
  ])('rejects invalid input for %s before invoking dependencies', async (name, args) => {
    const result = await (await connect()).callTool({ name, arguments: args });
    expect(result.isError).toBe(true);
    expect(mocks.executeCall).not.toHaveBeenCalled();
    expect(mocks.createQuote).not.toHaveBeenCalled();
    expect(mocks.db.payment.findMany).not.toHaveBeenCalled();
  });

  it('scopes approval lookups and never returns another agent’s approval', async () => {
    mocks.db.approval.findFirst.mockResolvedValue(null);
    const result = await (await connect()).callTool({ name: 'settl_check_approval', arguments: { approvalId: 'other-approval' } });
    expect(mocks.db.approval.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'other-approval', agentId: 'agent-one' },
    }));
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({ error: 'APPROVAL_NOT_FOUND' });
  });

  it('serializes approval amounts and dates using explicit public fields', async () => {
    mocks.db.approval.findFirst.mockResolvedValue({
      id: 'approval-one', providerId: 'provider-one', quoteId: 'quote-one', amount: 10n,
      status: 'approved', expiresAt: new Date('2026-11-05T03:00:00Z'), agentId: 'hidden-agent',
    });
    const result = await (await connect()).callTool({ name: 'settl_check_approval', arguments: { approvalId: 'approval-one' } });
    expect(result.structuredContent).toEqual({ approval: {
      id: 'approval-one', providerId: 'provider-one', quoteId: 'quote-one', amountStroops: '10',
      status: 'approved', expiresAt: '2026-11-05T03:00:00.000Z',
    } });
    expect(JSON.stringify(result)).not.toContain('hidden-agent');
  });

  it.each([
    { name: 'pending approvals', approvals: [
      { id: 'approval-one', providerId: 'provider-one', quoteId: 'quote-one', amount: 50n,
        expiresAt: new Date('2026-11-05T17:00:00Z'), agentId: 'private-agent', privateToken: 'never-expose-budget' },
      { id: 'approval-two', providerId: 'provider-two', quoteId: 'quote-two', amount: 9007199254740993n,
        expiresAt: new Date('2026-11-05T18:00:00Z'), agentId: 'private-agent', privateToken: 'never-expose-budget' },
    ] },
    { name: 'no pending approvals', approvals: [] },
  ])('computes UTC spend and holds and returns $name safely', async ({ approvals }) => {
    const now = new Date('2026-11-05T16:00:00Z');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    try {
      mocks.db.agent.findUnique.mockResolvedValue({ deviceHash: 'device-one', policy: {
        asset: 'XLM', maxAmount: 500n, dailyBudget: 100n, maxPricePerCall: 50n,
        autoApproveUpTo: 25n, expiresAt: new Date('2027-01-01T00:00:00Z'), allowlist: ['provider-one'],
      } });
      mocks.balanceOf.mockResolvedValue(200n);
      mocks.db.payment.findMany.mockResolvedValue([{ quote: { amount: 80n } }]);
      mocks.db.reservation.aggregate.mockResolvedValue({ _sum: { amount: 30n } });
      mocks.db.approval.findMany.mockResolvedValue(approvals);
      const result = await (await connect()).callTool({ name: 'settl_get_budget', arguments: {} });
      expect(mocks.balanceOf).toHaveBeenCalledWith('device-one');
      expect(mocks.db.payment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
        status: 'paid', confirmedAt: { gte: new Date('2026-11-05T00:00:00Z') }, quote: { agentId: 'agent-one' },
      } }));
      expect(mocks.db.reservation.aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: {
        agentId: 'agent-one', status: 'held', expiresAt: { gt: now },
      } }));
      expect(mocks.db.approval.findMany).toHaveBeenCalledWith({
        where: { agentId: 'agent-one', status: 'pending', expiresAt: { gt: now } },
        orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
        select: { id: true, providerId: true, quoteId: true, amount: true, expiresAt: true },
      });
      expect(result.structuredContent).toMatchObject({
        balanceStroops: '200', availableStroops: '170', spentTodayStroops: '80', heldStroops: '30',
        remainingDailyBudgetStroops: '0', openApprovals: approvals.length,
        pendingApprovals: approvals.map((approval) => ({
          id: approval.id, providerId: approval.providerId, quoteId: approval.quoteId,
          amountStroops: approval.amount.toString(), expiresAt: approval.expiresAt.toISOString(),
        })),
        policy: { dailyBudget: '100' },
      });
      expect(JSON.stringify(result)).not.toContain('private-agent');
      expect(JSON.stringify(result)).not.toContain('never-expose-budget');
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns recent terminal receipts scoped to the caller with a bounded limit', async () => {
    mocks.db.payment.findMany.mockResolvedValue([{
      id: 'payment-one', quoteId: 'quote-one', status: 'paid', txHash: 'tx-one',
      submittedAt: new Date('2026-11-05T01:00:00Z'), confirmedAt: new Date('2026-11-05T01:00:01Z'),
      quote: { endpointId: 'service-one', amount: 1000000n }, recovery: { secret: 'never-expose' },
    }]);
    const result = await (await connect()).callTool({ name: 'settl_receipts', arguments: { limit: 5 } });
    expect(mocks.db.payment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: { in: ['paid', 'not_charged', 'blocked', 'failed'] }, quote: { agentId: 'agent-one' } }, take: 5,
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
    }));
    expect(result.structuredContent).toEqual({ receipts: [{
      id: 'payment-one', quoteId: 'quote-one', serviceId: 'service-one', status: 'paid', amountStroops: '1000000',
      displayPrice: { currency: 'PHP', amount: '1.50' }, txHash: 'tx-one',
      submittedAt: '2026-11-05T01:00:00.000Z', confirmedAt: '2026-11-05T01:00:01.000Z',
    }] });
    expect(JSON.stringify(result)).not.toContain('never-expose');
  });

  it.each([
    ['not_charged', 'not_charged'], ['blocked', 'blocked'], ['failed', 'blocked'],
  ])('returns a %s receipt with zero charged and public verification checks', async (paymentStatus, receiptStatus) => {
    const checks = [{ check: 'required-output', ok: false, note: 'Required output is missing' }];
    mocks.db.payment.findMany.mockResolvedValue([{
      id: 'payment-outcome', quoteId: 'quote-outcome', status: paymentStatus, txHash: null,
      submittedAt: new Date('2026-11-05T02:00:00Z'), confirmedAt: null,
      quote: { endpointId: 'outcome-service', amount: 1000000n, verification: { reasons: checks } },
      error: 'private provider failure', recovery: { secret: 'never-expose' },
    }]);
    const result = await (await connect()).callTool({ name: 'settl_receipts', arguments: {} });
    expect(result.structuredContent).toEqual({ receipts: [{
      id: 'payment-outcome', quoteId: 'quote-outcome', serviceId: 'outcome-service', status: receiptStatus,
      amountStroops: '0', displayPrice: { currency: 'PHP', amount: '0.00' },
      submittedAt: '2026-11-05T02:00:00.000Z', confirmedAt: null, checks,
    }] });
    expect(mocks.db.payment.findMany).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({
      status: true, quote: { select: { endpointId: true, amount: true, verification: { select: { reasons: true } } } },
    }) }));
    expect(JSON.stringify(result)).not.toContain('private provider failure');
    expect(JSON.stringify(result)).not.toContain('never-expose');
  });

  it('omits malformed verification details instead of forwarding arbitrary stored JSON', async () => {
    mocks.db.payment.findMany.mockResolvedValue([{
      id: 'payment-malformed', quoteId: 'quote-malformed', status: 'not_charged', txHash: null,
      submittedAt: new Date('2026-11-05T02:00:00Z'), confirmedAt: null,
      quote: { endpointId: 'outcome-service', amount: 1000000n, verification: {
        reasons: [{ secret: 'private-token' }],
      } },
    }]);
    const result = await (await connect()).callTool({ name: 'settl_receipts', arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ receipts: [{ status: 'not_charged', amountStroops: '0' }] });
    expect(JSON.stringify(result)).not.toContain('private-token');
    expect(JSON.stringify(result)).not.toContain('checks');
  });

  it('never forwards unexpected fields from a stored verification check', async () => {
    mocks.db.payment.findMany.mockResolvedValue([{
      id: 'payment-extra', quoteId: 'quote-extra', status: 'paid', txHash: 'tx-extra',
      submittedAt: new Date('2026-11-05T02:00:00Z'), confirmedAt: new Date('2026-11-05T02:00:01Z'),
      quote: { endpointId: 'outcome-service', amount: 1000000n, verification: { reasons: [{
        check: 'required-output', ok: true, note: 'Output is present', privateToken: 'never-expose-this',
      }] } },
    }]);
    const result = await (await connect()).callTool({ name: 'settl_receipts', arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ receipts: [{ status: 'paid', amountStroops: '1000000' }] });
    expect(JSON.stringify(result)).not.toContain('never-expose-this');
    expect(JSON.stringify(result)).not.toContain('privateToken');
  });

  it('uses the default receipt bound when omitted', async () => {
    mocks.db.payment.findMany.mockResolvedValue([]);
    const result = await (await connect()).callTool({ name: 'settl_receipts', arguments: {} });
    expect(result.structuredContent).toEqual({ receipts: [] });
    expect(mocks.db.payment.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 20 }));
  });

  it('redacts dependency errors from MCP tool results', async () => {
    mocks.executeCall.mockRejectedValue(new Error('database password super-secret'));
    const result = await (await connect()).callTool({ name: 'settl_call', arguments: { serviceId: 'service-one' } });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({ error: 'TOOL_FAILED' });
    expect(JSON.stringify(result)).not.toContain('super-secret');
  });

  it('rejects invalid exchange-rate configuration without returning fabricated prices', async () => {
    vi.stubEnv('PHP_PER_XLM', 'NaN');
    mocks.db.endpoint.findMany.mockResolvedValue([]);
    const result = await (await connect()).callTool({ name: 'settl_list_services', arguments: {} });
    expect(result.isError).toBe(true);
  });
});
