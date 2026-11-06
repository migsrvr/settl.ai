// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateText } from 'ai';
import { decodeToolResult, mcpUrl, type McpConnection } from '../src/client';
import { Ledger } from '../src/ledger';
import { createLogger } from '../src/log';
import { runBookkeeper, selectProvider, type AgentSession } from '../src/run';

vi.mock('ai', async (original) => ({ ...await original<typeof import('ai')>(), generateText: vi.fn() }));

const hash = 'a'.repeat(64);
const data = { merchant_name: 'Office shop', date: '2026-11-05', total: 12.5,
  line_items: [{ description: 'Paper', amount: 12.5 }], confidence: 0.98 };
const paid = { status: 'paid', receipt: { quoteId: 'quote-clean', status: 'paid', amountStroops: '1333333', txHash: hash,
  checks: [{ check: 'confidence', ok: true }] }, data };
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
async function setup(respond: (name: string, args: Record<string, unknown>) => unknown = () => ({})) {
  const dir = await mkdtemp(join(tmpdir(), 'settl-agent-')); dirs.push(dir);
  const mcp: McpConnection = { callTool: vi.fn(async (name: string, args: Record<string, unknown>) => respond(name, args) as Record<string, unknown>), close: vi.fn(async () => {}) };
  const messages: string[] = [];
  const options = { env: { GROQ_API_KEY: 'groq-secret' }, connect: async () => mcp,
    ledgerPath: join(dir, 'ledger.json'), logger: createLogger(['groq-secret'], (line) => messages.push(line)) };
  return { mcp, messages, options, dir };
}
const callClean = (session: AgentSession) => session.invoke('settl_call', { serviceId: 'resibo_parse', input: { fixture: 'clean' } });

describe('bookkeeping agent', () => {
  it('the real runner exposes executable tools to AI SDK7 and only a model tool call requests payment', async () => {
    const { mcp, options } = await setup(() => paid);
    vi.mocked(generateText).mockImplementationOnce(async (request) => {
      expect(mcp.callTool).not.toHaveBeenCalled();
      const tools = request.tools as unknown as Record<string, { execute: (input: Record<string, unknown>) => Promise<unknown> }>;
      await tools.settl_call.execute({ serviceId: 'resibo_parse', input: { fixture: 'clean' } });
      expect(request).toMatchObject({ maxRetries: 0, toolCallConcurrency: 1 });
      expect(request.system).toContain('Per-call services charge for usage even when the mock output is blurry');
      return {} as Awaited<ReturnType<typeof generateText>>;
    });
    await runBookkeeper(options);
    expect(mcp.callTool).toHaveBeenCalledOnce();
    expect(mcp.callTool).toHaveBeenCalledWith('settl_call', {
      serviceId: 'resibo_parse', input: { fixture: 'clean' }, maxPricePhp: '10.00',
    });
  });

  it('records a paid blurry API call without booking its low-confidence receipt as a business expense', async () => {
    const charged = { ...paid, receipt: { ...paid.receipt, quoteId: 'quote-blurry', checks: [] }, data: { ...data, confidence: 0.42 } };
    const { options, mcp, messages } = await setup(() => charged);
    await runBookkeeper({ ...options, generate: async ({ invoke }) => {
      expect(await invoke('settl_call', { serviceId: 'resibo_parse', input: { fixture: 'blurry' } })).toEqual(charged);
    } });
    const ledger = new Ledger(options.ledgerPath); await ledger.load();
    expect(ledger.operation('resibo_parse:blurry')).toMatchObject({ status: 'paid', txHash: hash });
    expect(ledger.expenses).toEqual([]);
    expect(messages.join('\n')).toContain('paid');
    expect(mcp.callTool).toHaveBeenCalledTimes(1);
  });

  it('records only paid validated receipt data and deduplicates across restarts', async () => {
    const { mcp, options } = await setup(() => paid);
    await runBookkeeper({ ...options, generate: async (session) => { await callClean(session); await callClean(session); } });
    await runBookkeeper({ ...options, generate: async (session) => { await callClean(session); } });
    const ledger = new Ledger(options.ledgerPath); await ledger.load();
    expect(ledger.expenses).toHaveLength(1);
    expect(ledger.expenses[0]).toMatchObject({ quoteId: 'quote-clean', txHash: hash, merchant: 'Office shop', totalPhp: 12.5 });
    expect(mcp.callTool).toHaveBeenCalledTimes(1);
    expect(mcp.close).toHaveBeenCalledTimes(2);
  });

  it('uses all mission actions via registered MCP names without caller identity', async () => {
    const { mcp, options } = await setup((name, args) => {
      if (name !== 'settl_call') return {};
      if (args.serviceId === 'resibo_pro') return { status: 'declined', reason: 'over_max_price' };
      if (args.serviceId === 'geoph_lookup') return { status: 'approval_required', approvalId: 'approval-1' };
      return (args.input as { fixture: string }).fixture === 'clean' ? paid : { status: 'not_charged', reason: 'checks_failed' };
    });
    await runBookkeeper({ ...options, approvalTimeoutMs: 0, generate: async ({ invoke }) => {
      await invoke('settl_get_budget', {}); await invoke('settl_list_services', {});
      await invoke('settl_call', { serviceId: 'resibo_parse', input: { fixture: 'clean' } });
      await invoke('settl_call', { serviceId: 'resibo_parse', input: { fixture: 'blurry' } });
      await invoke('settl_call', { serviceId: 'resibo_pro', maxPricePhp: '10.00' });
      await invoke('settl_call', { serviceId: 'geoph_lookup', input: { city: 'Makati' } });
    } });
    expect(mcp.callTool).toHaveBeenCalledTimes(6);
    for (const [, args] of vi.mocked(mcp.callTool).mock.calls) expect(args).not.toHaveProperty('agentId');
  });

  it('never books blurry output, over-cap decline, invalid paid receipts, or geography as an expense', async () => {
    const { options, messages } = await setup((_name, args) => args.serviceId === 'resibo_pro'
      ? { status: 'declined', reason: 'over_max_price' }
      : args.serviceId === 'geoph_lookup' ? { ...paid, data: { city: 'Makati' } }
      : { status: 'not_charged', reason: 'checks_failed', data });
    await runBookkeeper({ ...options, generate: async ({ invoke }) => {
      await invoke('settl_call', { serviceId: 'resibo_parse', input: { fixture: 'blurry' } });
      await invoke('settl_call', { serviceId: 'resibo_pro' });
      await invoke('settl_call', { serviceId: 'geoph_lookup' });
    } });
    const ledger = new Ledger(options.ledgerPath); await ledger.load(); expect(ledger.expenses).toEqual([]);
    expect(messages.join('\n')).toContain('not_charged'); expect(messages.join('\n')).toContain('over_max_price');
    for (const invalid of [ { ...paid, receipt: { ...paid.receipt, txHash: '' } }, { ...paid, data: { ...data, total: 50 } },
      { ...paid, receipt: { ...paid.receipt, checks: [{ check: 'confidence', ok: false }] } } ]) {
      expect(await ledger.recordExpense(invalid)).toBe(false);
    }
  });

  it('deduplicates receipts by either quote id or transaction hash', async () => {
    const { options } = await setup(); const ledger = new Ledger(options.ledgerPath); await ledger.load();
    expect(await ledger.recordExpense(paid)).toBe(true);
    expect(await ledger.recordExpense({ ...paid, receipt: { ...paid.receipt, quoteId: 'another' } })).toBe(false);
    expect(await ledger.recordExpense({ ...paid, receipt: { ...paid.receipt, txHash: 'b'.repeat(64) } })).toBe(false);
    expect(JSON.parse(await readFile(options.ledgerPath, 'utf8')).expenses).toHaveLength(1);
  });

  it('polls with a fake clock and resumes only the same approved id once at the model request', async () => {
    let polls = 0; let now = 0;
    const { mcp, options, messages } = await setup((name, args) => name === 'settl_check_approval'
      ? { approval: { id: 'ap-1', status: ++polls === 2 ? 'approved' : 'pending' } }
      : args.approvalId ? { ...paid, data: { city: 'Makati' } } : { status: 'approval_required', approvalId: 'ap-1' });
    await runBookkeeper({ ...options, now: () => now, sleep: async (ms) => { now += ms; }, approvalPollMs: 10, approvalTimeoutMs: 50,
      generate: async ({ invoke }) => {
        const result = await invoke('settl_call', { serviceId: 'geoph_lookup' });
        expect(result).toMatchObject({ approvalStatus: 'approved' });
        await invoke('settl_call', { serviceId: 'geoph_lookup', approvalId: 'ap-1' });
        await invoke('settl_call', { serviceId: 'geoph_lookup', approvalId: 'ap-1' });
      } });
    expect(vi.mocked(mcp.callTool).mock.calls.filter(([name]) => name === 'settl_call')).toHaveLength(2);
    expect(messages.join('\n')).toContain('/buyer/approvals/ap-1');
  });

  it.each(['declined', 'expired', 'pending'])('does not pay when approval is %s', async (status) => {
    let now = 0;
    const { options, mcp } = await setup((name) => name === 'settl_check_approval'
      ? { approval: { id: 'ap-1', status } } : { status: 'approval_required', approvalId: 'ap-1' });
    await runBookkeeper({ ...options, now: () => now, sleep: async (ms) => { now += ms; }, approvalPollMs: 10, approvalTimeoutMs: 25,
      generate: async ({ invoke }) => {
        const result = await invoke('settl_call', { serviceId: 'geoph_lookup' });
        expect(result.approvalStatus).toBe(status === 'pending' ? 'timed_out' : status);
        await invoke('settl_call', { serviceId: 'geoph_lookup', approvalId: 'ap-1' });
      } });
    expect(vi.mocked(mcp.callTool).mock.calls.filter(([name]) => name === 'settl_call')).toHaveLength(1);
    expect(now).toBeLessThanOrEqual(25);
  });

  it('rejects a changed approval input and a price above the mission cap before payment', async () => {
    const { options, mcp } = await setup((name) => name === 'settl_check_approval'
      ? { approval: { id: 'ap-1', status: 'approved' } } : { status: 'approval_required', approvalId: 'ap-1' });
    await runBookkeeper({ ...options, generate: async ({ invoke }) => {
      await invoke('settl_call', { serviceId: 'geoph_lookup', input: { city: 'Makati' } });
      await expect(invoke('settl_call', { serviceId: 'geoph_lookup', input: { city: 'Cebu' }, approvalId: 'ap-1' })).rejects.toThrow('same input');
      await expect(invoke('settl_call', { serviceId: 'resibo_parse', maxPricePhp: '10.01' })).rejects.toThrow();
    } });
    expect(vi.mocked(mcp.callTool).mock.calls.filter(([name]) => name === 'settl_call')).toHaveLength(1);
  });

  it('resumes a persisted approval after a timeout without creating another approval', async () => {
    const { options, mcp } = await setup((name, args) => name === 'settl_check_approval'
      ? { approval: { id: 'ap-1', status: 'approved' } }
      : args.approvalId ? { ...paid, data: { city: 'Makati' } } : { status: 'approval_required', approvalId: 'ap-1' });
    await runBookkeeper({ ...options, approvalTimeoutMs: 0, generate: async ({ invoke }) => {
      await invoke('settl_call', { serviceId: 'geoph_lookup', input: { city: 'Makati' } });
    } });
    await runBookkeeper({ ...options, generate: async ({ invoke }) => {
      const result = await invoke('settl_call', { serviceId: 'geoph_lookup', input: { city: 'Makati' } });
      expect(result).toMatchObject({ approvalId: 'ap-1', approvalStatus: 'approved' });
      await invoke('settl_call', { serviceId: 'geoph_lookup', input: { city: 'Makati' }, approvalId: 'ap-1' });
    } });
    const payments = vi.mocked(mcp.callTool).mock.calls.filter(([name]) => name === 'settl_call');
    expect(payments).toHaveLength(2);
    expect(payments[1][1]).toMatchObject({ approvalId: 'ap-1' });
  });

  it('never submits a second approved resume if the first resume still requires approval', async () => {
    const { options, mcp } = await setup((name) => name === 'settl_check_approval'
      ? { approval: { id: 'ap-1', status: 'approved' } } : { status: 'approval_required', approvalId: 'ap-1' });
    await runBookkeeper({ ...options, generate: async ({ invoke }) => {
      await invoke('settl_call', { serviceId: 'geoph_lookup' });
      await invoke('settl_call', { serviceId: 'geoph_lookup', approvalId: 'ap-1' });
      await invoke('settl_call', { serviceId: 'geoph_lookup', approvalId: 'ap-1' });
    } });
    expect(vi.mocked(mcp.callTool).mock.calls.filter(([name]) => name === 'settl_call')).toHaveLength(2);
  });

  it('serializes concurrent requests and releases the lock on connection failure', async () => {
    const { mcp, options } = await setup(() => paid);
    await runBookkeeper({ ...options, generate: async (session) => { await Promise.all([callClean(session), callClean(session)]); } });
    expect(mcp.callTool).toHaveBeenCalledOnce();
    await expect(runBookkeeper({ ...options, connect: async () => { throw new Error('offline'); } })).rejects.toThrow('offline');
    const ledger = new Ledger(options.ledgerPath); const unlock = await ledger.lock(); await unlock();
  });

  it('fails closed on a corrupt ledger without connecting', async () => {
    const { options } = await setup(); const { writeFile } = await import('node:fs/promises');
    await writeFile(options.ledgerPath, '{invalid');
    const connect = vi.fn();
    await expect(runBookkeeper({ ...options, connect })).rejects.toThrow('invalid or unreadable');
    expect(connect).not.toHaveBeenCalled();
  });

  it.each(['pending', 'transport_error'])('persists %s and prevents blind payment retries', async (status) => {
    const { mcp, options } = await setup(() => { if (status === 'transport_error') throw new Error('secret transport'); return { status: 'pending', quoteId: 'pending-quote' }; });
    for (let i = 0; i < 2; i++) await runBookkeeper({ ...options, generate: async (session) => { await callClean(session); await callClean(session); } });
    expect(mcp.callTool).toHaveBeenCalledTimes(1);
  });

  it('closes MCP on model failure and rejects unexpected argument identity', async () => {
    const { mcp, options } = await setup();
    await expect(runBookkeeper({ ...options, generate: async ({ invoke }) => {
      await expect(invoke('settl_call', { serviceId: 'resibo_parse', agentId: 'other' })).rejects.toThrow();
      throw new Error('provider failed');
    } })).rejects.toThrow('provider failed');
    expect(mcp.close).toHaveBeenCalledOnce(); expect(mcp.callTool).not.toHaveBeenCalled();
  });

  it('fails before connecting without provider configuration and selects Groq first', async () => {
    expect(selectProvider({ GROQ_API_KEY: 'g', OPENAI_API_KEY: 'o' })).toMatchObject({ provider: 'groq', model: 'llama-3.3-70b-versatile' });
    expect(selectProvider({ OPENAI_API_KEY: 'o' }).provider).toBe('openai');
    expect(selectProvider({ GOOGLE_GENERATIVE_AI_API_KEY: 'a' }).provider).toBe('google');
    const connect = vi.fn();
    await expect(runBookkeeper({ env: {}, connect })).rejects.toThrow('Configure GROQ_API_KEY');
    expect(connect).not.toHaveBeenCalled();
  });

  it('reads structured or text MCP JSON and handles tool errors', () => {
    expect(decodeToolResult({ structuredContent: paid })).toEqual(paid);
    expect(decodeToolResult({ content: [{ type: 'text', text: JSON.stringify(paid) }] })).toEqual(paid);
    expect(() => decodeToolResult({ isError: true, content: [] })).toThrow('MCP tool failed');
  });

  it('allows HTTPS hosted MCP and localhost HTTP without URL credentials', () => {
    expect(mcpUrl('https://settl.example/mcp').protocol).toBe('https:');
    expect(mcpUrl('http://localhost:3000/mcp').hostname).toBe('localhost');
    expect(() => mcpUrl('http://settl.example/mcp')).toThrow('HTTPS');
    expect(() => mcpUrl('https://secret@settl.example/mcp')).toThrow('without credentials');
    expect(() => mcpUrl('https://settl.example/mcp?token=secret')).toThrow('without credentials');
  });

  it('rejects arbitrary provider input before sending a paid call', async () => {
    const { options, mcp } = await setup();
    await runBookkeeper({ ...options, generate: async ({ invoke }) => {
      await expect(invoke('settl_call', { serviceId: 'resibo_parse', input: { fixture: 'clean', agentId: 'other' } })).rejects.toThrow();
    } });
    expect(mcp.callTool).not.toHaveBeenCalled();
  });

  it('redacts credentials and bearer values from logs', () => {
    const lines: string[] = []; const log = createLogger(['groq-secret', 'token-secret'], (line) => lines.push(line));
    log('warning', 'groq-secret Bearer token-secret sk-private stl_agent_private');
    expect(lines.join()).not.toMatch(/groq-secret|token-secret|sk-private|stl_agent_private/);
  });
});
