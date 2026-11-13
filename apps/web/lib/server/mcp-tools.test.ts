// @vitest-environment node
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    endpoint: { findMany: vi.fn() },
    agent: { findUnique: vi.fn(), updateMany: vi.fn() },
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

import { createAgentMcpServer, type AgentMcpOptions } from './mcp-tools';
import { BUY_GUIDE, TOOL_GUIDE } from './discovery';

const connections: { client: Client; handler: ReturnType<typeof createMcpHandler> }[] = [];

async function connect(agentId = 'agent-one', options: AgentMcpOptions = {}) {
  const handler = createMcpHandler(() => createAgentMcpServer(agentId, options), { responseMode: 'sse' });
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
  it('advertises exactly the seven validated tools', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'settl_call', 'settl_check_approval', 'settl_get_budget', 'settl_list_services', 'settl_quote', 'settl_receipts',
      'settl_wait_for_approval',
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

  it('tells agents what input a service takes when the provider described it', async () => {
    const inputSchema = { type: 'object', properties: { city: { type: 'string' } } };
    mocks.db.endpoint.findMany.mockResolvedValue([{
      id: 'geo', name: 'Lookup', providerId: 'geoph', price: 15n, mode: 'per_call',
      description: 'Looks up a city.', inputSchema, example: { city: 'Makati' }, provider: { displayName: 'GeoPH' },
    }]);
    const result = await (await connect()).callTool({ name: 'settl_list_services', arguments: {} });
    expect(result.structuredContent).toMatchObject({ services: [{ id: 'geo', description: 'Looks up a city.', inputSchema, example: { city: 'Makati' } }] });
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
    expect(result.structuredContent).toMatchObject({ status: 'approval_required', approvalId: 'approval-one', next: expect.stringMatching(/approv/i) });
  });

  it('rejects invalid broker quote output without exposing unexpected fields', async () => {
    mocks.createQuote.mockResolvedValue({ quoteId: 'quote-invalid', privateCredential: 'never-expose-quote' });
    const result = await (await connect()).callTool({ name: 'settl_quote', arguments: { serviceId: 'service-one' } });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: 'TOOL_FAILED' });
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
    expect(result.structuredContent).toMatchObject({ error: 'APPROVAL_NOT_FOUND', next: expect.any(String) });
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
    expect(result.structuredContent).toMatchObject({ error: 'TOOL_FAILED', retryable: true });
    expect(JSON.stringify(result)).not.toContain('super-secret');
  });

  it('names an allow-listed broker failure with a next step instead of TOOL_FAILED', async () => {
    mocks.executeCall.mockRejectedValue(Object.assign(new Error('invalid_max_price'), { name: 'BrokerError', status: 400, code: 'invalid_max_price' }));
    const result = await (await connect()).callTool({ name: 'settl_call', arguments: { serviceId: 'service-one' } });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: 'invalid_max_price', retryable: false, next: expect.stringMatching(/\S/) });
  });

  it('declares the settl_call output shape and never returns internal automation effects', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.find((tool) => tool.name === 'settl_call')?.outputSchema?.properties).toHaveProperty('status');
    mocks.executeCall.mockResolvedValue({
      status: 'paid', receipt: { quoteId: 'q1', status: 'paid', amountStroops: '100', txHash: 'a'.repeat(64), checks: [] },
      data: { total: 1 }, effects: [{ kind: 'webhook', secretUrl: 'https://hooks.example/private' }],
    });
    const result = await client.callTool({ name: 'settl_call', arguments: { serviceId: 'service-one' } });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ status: 'paid', data: { total: 1 } });
    expect(JSON.stringify(result)).not.toContain('effects');
    expect(JSON.stringify(result)).not.toContain('hooks.example');
  });

  it('rejects invalid exchange-rate configuration without returning fabricated prices', async () => {
    vi.stubEnv('PHP_PER_XLM', 'NaN');
    mocks.db.endpoint.findMany.mockResolvedValue([]);
    const result = await (await connect()).callTool({ name: 'settl_list_services', arguments: {} });
    expect(result.isError).toBe(true);
  });
});

describe('typed service tools', () => {
  const geo = {
    id: 'geoph_lookup', name: 'GeoPH lookup', providerId: 'geoph', providerName: 'GeoPH', price: 5333334n, mode: 'per_call',
    description: 'Looks up a city.', example: { city: 'Makati' },
    inputSchema: { type: 'object', properties: { city: { type: 'string', minLength: 1 } }, required: ['city'], additionalProperties: false },
  };
  const plain = { ...geo, id: 'resibo_parse', name: 'Receipt OCR', providerId: 'resibo', providerName: 'ResiboAI', description: null, inputSchema: null, example: null };
  const paid = { status: 'paid', receipt: { quoteId: 'q1', status: 'paid', amountStroops: '5333334', txHash: 'a'.repeat(64) }, data: { province: 'Metro Manila' }, effects: [] };

  it('adds one tool per service next to the settl tools', async () => {
    const { tools } = await (await connect('agent-one', { services: [geo, plain] })).listTools();
    const names = tools.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(['settl_call', 'settl_list_services', 'geoph_lookup', 'resibo_receipt_ocr']));
  });

  it('tells the agent what the service does, what it costs and what input it takes', async () => {
    const { tools } = await (await connect('agent-one', { services: [geo] })).listTools();
    const tool = tools.find((candidate) => candidate.name === 'geoph_lookup');
    expect(tool?.description).toMatch(/Looks up a city/);
    expect(tool?.description).toMatch(/PHP 8\.00/);
    expect(tool?.annotations).toMatchObject({ destructiveHint: true, openWorldHint: true });
    expect(tool?.inputSchema.properties).toMatchObject({ input: { properties: { city: { type: 'string' } } } });
    expect(tool?.inputSchema.required).toContain('input');
    expect(tool?.outputSchema?.properties).toHaveProperty('status');
  });

  it('buys through the same broker path with the service fixed by the tool', async () => {
    mocks.executeCall.mockResolvedValue(paid);
    const result = await (await connect('agent-one', { services: [geo] })).callTool({ name: 'geoph_lookup', arguments: { input: { city: 'Makati' }, maxPricePhp: '10.00' } });
    expect(mocks.executeCall).toHaveBeenCalledWith({ agentId: 'agent-one', endpointId: 'geoph_lookup', input: { city: 'Makati' }, maxPricePhp: '10.00' });
    expect(result.structuredContent).toMatchObject({ status: 'paid', data: { province: 'Metro Manila' } });
    expect(JSON.stringify(result)).not.toContain('effects');
  });

  it('refuses input that breaks the service schema before reaching the broker', async () => {
    const result = await (await connect('agent-one', { services: [geo] })).callTool({ name: 'geoph_lookup', arguments: { input: { town: 'Makati' } } });
    expect(result.isError).toBe(true);
    expect(mocks.executeCall).not.toHaveBeenCalled();
  });

  it('keeps a service usable with free-form input when its stored schema cannot be compiled', async () => {
    mocks.executeCall.mockResolvedValue(paid);
    const broken = { ...geo, inputSchema: { type: 'object', properties: { city: { $ref: '#/nowhere' } } } };
    const client = await connect('agent-one', { services: [broken] });
    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain('geoph_lookup');
    await client.callTool({ name: 'geoph_lookup', arguments: { input: { city: 'Makati' } } });
    expect(mocks.executeCall).toHaveBeenCalled();
  });

  it('caps typed tools at 40 so large catalogs stay usable through settl_call', async () => {
    const many = Array.from({ length: 45 }, (_, index) => ({ ...plain, id: `svc${index}`, name: `Service ${index}` }));
    const { tools } = await (await connect('agent-one', { services: many })).listTools();
    expect(tools.filter((tool) => !tool.name.startsWith('settl_'))).toHaveLength(40);
  });
});

describe('settl_wait_for_approval', () => {
  const approval = (status: string, expiresAt = new Date(Date.now() + 60_000)) => ({
    id: 'approval-one', providerId: 'provider-one', quoteId: 'quote-one', amount: 10n, status, expiresAt,
  });

  it('returns at once when a human has already decided', async () => {
    mocks.db.approval.findFirst.mockResolvedValue(approval('approved'));
    const result = await (await connect()).callTool({ name: 'settl_wait_for_approval', arguments: { approvalId: 'approval-one' } });
    expect(result.structuredContent).toMatchObject({ decided: true, approval: { status: 'approved' }, next: expect.stringMatching(/approvalId/) });
    expect(mocks.db.approval.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'approval-one', agentId: 'agent-one' } }));
  });

  it('waits on the server until the decision arrives', async () => {
    mocks.db.approval.findFirst
      .mockResolvedValueOnce(approval('pending')).mockResolvedValueOnce(approval('pending')).mockResolvedValue(approval('declined'));
    const result = await (await connect('agent-one', { approvalPollMs: 5 })).callTool({ name: 'settl_wait_for_approval', arguments: { approvalId: 'approval-one' } });
    expect(result.structuredContent).toMatchObject({ decided: true, approval: { status: 'declined' } });
    expect(mocks.db.approval.findFirst).toHaveBeenCalledTimes(3);
  });

  it('gives the approval back undecided when the wait runs out', async () => {
    mocks.db.approval.findFirst.mockResolvedValue(approval('pending'));
    const result = await (await connect('agent-one', { approvalPollMs: 50 })).callTool({ name: 'settl_wait_for_approval', arguments: { approvalId: 'approval-one', timeoutSeconds: 1 } });
    expect(result.structuredContent).toMatchObject({ decided: false, approval: { status: 'pending' } });
  });

  it('reports an approval past its expiry as expired even before the database is updated', async () => {
    mocks.db.approval.findFirst.mockResolvedValue(approval('pending', new Date(Date.now() - 1000)));
    const result = await (await connect()).callTool({ name: 'settl_wait_for_approval', arguments: { approvalId: 'approval-one' } });
    expect(result.structuredContent).toMatchObject({ decided: true, approval: { status: 'expired' } });
  });

  it("never reveals another agent's approval", async () => {
    mocks.db.approval.findFirst.mockResolvedValue(null);
    const result = await (await connect()).callTool({ name: 'settl_wait_for_approval', arguments: { approvalId: 'other' } });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: 'APPROVAL_NOT_FOUND' });
  });

  it.each([{ timeoutSeconds: 0 }, { timeoutSeconds: 56 }, { timeoutSeconds: 1.5 }])('rejects an out-of-range wait %o', async (args) => {
    const result = await (await connect()).callTool({ name: 'settl_wait_for_approval', arguments: { approvalId: 'approval-one', ...args } });
    expect(result.isError).toBe(true);
    expect(mocks.db.approval.findFirst).not.toHaveBeenCalled();
  });
});

describe('budget balance snapshot', () => {
  const policy = { asset: 'XLM', maxAmount: 500n, dailyBudget: 100n, maxPricePerCall: 50n, autoApproveUpTo: 25n, expiresAt: new Date('2027-01-01T00:00:00Z'), allowlist: [] };
  beforeEach(() => {
    mocks.db.payment.findMany.mockResolvedValue([]);
    mocks.db.reservation.aggregate.mockResolvedValue({ _sum: { amount: null } });
    mocks.db.approval.findMany.mockResolvedValue([]);
  });

  it('reuses a balance observed in the last 15 seconds instead of reading the chain again', async () => {
    mocks.db.agent.findUnique.mockResolvedValue({ deviceHash: 'device-fresh', cachedBalance: 70n, balanceUpdatedAt: new Date(Date.now() - 2_000), policy });
    const result = await (await connect()).callTool({ name: 'settl_get_budget', arguments: {} });
    expect(mocks.balanceOf).not.toHaveBeenCalled();
    expect(result.structuredContent).toMatchObject({ balanceStroops: '70', balanceSource: 'cache', balanceAsOf: expect.any(String) });
  });

  it('reads and stores a fresh balance when the snapshot is old', async () => {
    mocks.db.agent.findUnique.mockResolvedValue({ deviceHash: 'device-old', cachedBalance: 70n, balanceUpdatedAt: new Date(Date.now() - 60_000), policy });
    mocks.balanceOf.mockResolvedValue(90n);
    const result = await (await connect()).callTool({ name: 'settl_get_budget', arguments: {} });
    expect(mocks.balanceOf).toHaveBeenCalledWith('device-old');
    expect(mocks.db.agent.updateMany).toHaveBeenCalled();
    expect(result.structuredContent).toMatchObject({ balanceStroops: '90', balanceSource: 'chain' });
  });

  it('says the balance is temporarily unavailable rather than inventing one', async () => {
    mocks.db.agent.findUnique.mockResolvedValue({ deviceHash: 'device-down', cachedBalance: null, balanceUpdatedAt: null, policy });
    mocks.balanceOf.mockRejectedValue(new Error('rpc down'));
    const result = await (await connect()).callTool({ name: 'settl_get_budget', arguments: {} });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: 'BALANCE_UNAVAILABLE', retryable: true });
  });
});

describe('guidance for agents', () => {
  const service = {
    id: 'geoph_lookup', name: 'GeoPH lookup', providerId: 'geoph', providerName: 'GeoPH', price: 5333334n, mode: 'per_call',
    description: 'Looks up a city.', inputSchema: { type: 'object' }, example: { city: 'Makati' },
  };

  it('keeps the published tool guide in step with the tools actually offered', async () => {
    const { tools } = await (await connect()).listTools();
    expect(TOOL_GUIDE.map(([name]) => name).sort()).toEqual(tools.map((tool) => tool.name).sort());
  });

  it('offers the catalog and a buying guide as resources', async () => {
    const client = await connect('agent-one', { services: [service] });
    const { resources } = await client.listResources();
    expect(resources.map((resource) => resource.uri).sort()).toEqual(['settl://guide', 'settl://services']);
    const guide = await client.readResource({ uri: 'settl://guide' });
    expect((guide.contents[0] as { text: string }).text).toBe(BUY_GUIDE);
    const catalog = await client.readResource({ uri: 'settl://services' });
    const parsed = JSON.parse((catalog.contents[0] as { text: string }).text);
    expect(parsed.services).toEqual([expect.objectContaining({
      id: 'geoph_lookup', tool: 'geoph_lookup', providerName: 'GeoPH', description: 'Looks up a city.',
      displayPrice: { currency: 'PHP', amount: '8.00' }, example: { city: 'Makati' },
    })]);
  });

  it('offers a buy_service prompt that frames the task with the safe buying steps', async () => {
    const prompt = await (await connect()).getPrompt({ name: 'buy_service', arguments: { task: 'Read this receipt', maxPricePhp: '5.00' } });
    const text = (prompt.messages[0]?.content as { text: string }).text;
    expect(text).toContain('Read this receipt');
    expect(text).toContain('5.00');
    expect(text).toContain('settl_list_services');
  });
});
