// @vitest-environment node
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), createServer: vi.fn() }));

vi.mock('../../lib/server/api-auth', () => ({ requireAgentAuth: mocks.auth }));
vi.mock('../../lib/server/mcp-tools', async () => {
  const { McpServer } = await import('@modelcontextprotocol/server');
  return {
    createAgentMcpServer: mocks.createServer.mockImplementation((agentId: string) => {
      const server = new McpServer({ name: 'test-settl', version: '1.0.0' });
      server.registerTool('whoami', { description: 'Return authenticated identity' }, async () => ({
        content: [{ type: 'text', text: agentId }],
        structuredContent: { agentId },
      }));
      return server;
    }),
  };
});

import { DELETE, GET, POST } from './route';

const clients: Client[] = [];
const url = 'https://settl.test/mcp';

async function connect(token: string, mode: 'auto' | 'legacy' = 'auto') {
  const responses: Response[] = [];
  const requests: Request[] = [];
  const client = new Client(
    { name: 'settl-route-tests', version: '1.0.0' },
    { versionNegotiation: { mode } },
  );
  clients.push(client);
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
    fetch: async (input, init) => {
      const request = new Request(input, init);
      requests.push(request.clone());
      const response = await POST(request);
      responses.push(response);
      return response;
    },
  });
  await client.connect(transport);
  return { client, responses, requests };
}

beforeEach(() => {
  mocks.auth.mockReset();
  mocks.createServer.mockClear();
  mocks.auth.mockImplementation(async (request: Request) => {
    const authorization = request.headers.get('authorization');
    if (authorization === 'Bearer stl_agent_one') return { agentId: 'agent-one' };
    if (authorization === 'Bearer stl_agent_two') return { agentId: 'agent-two' };
    throw Object.assign(new Error('Do not expose authentication internals'), { status: 401 });
  });
});

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe('hosted MCP transport', () => {
  it('negotiates the modern protocol, lists tools and serves calls over SSE without caching', async () => {
    const { client, responses, requests } = await connect('stl_agent_one');
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['whoami']);
    const result = await client.callTool({ name: 'whoami', arguments: {} });
    expect(result.structuredContent).toEqual({ agentId: 'agent-one' });
    expect(requests.some((request) => request.headers.get('mcp-protocol-version') === '2026-07-28')).toBe(true);
    expect(responses.some((response) => response.headers.get('content-type')?.includes('text/event-stream'))).toBe(true);
    expect(responses.every((response) => response.headers.get('cache-control') === 'no-store')).toBe(true);
  });

  it('isolates concurrently authenticated agents and creates fresh servers', async () => {
    const [one, two] = await Promise.all([connect('stl_agent_one'), connect('stl_agent_two')]);
    const [first, second] = await Promise.all([
      one.client.callTool({ name: 'whoami', arguments: {} }),
      two.client.callTool({ name: 'whoami', arguments: {} }),
    ]);
    expect(first.structuredContent).toEqual({ agentId: 'agent-one' });
    expect(second.structuredContent).toEqual({ agentId: 'agent-two' });
    expect(mocks.createServer.mock.calls.filter(([id]) => id === 'agent-one').length).toBeGreaterThan(1);
    expect(mocks.createServer.mock.calls.filter(([id]) => id === 'agent-two').length).toBeGreaterThan(1);
  });

  it('supports the legacy initialize handshake and subsequent stateless tool calls', async () => {
    const { client } = await connect('stl_agent_one', 'legacy');
    expect(client.getProtocolEra()).toBe('legacy');
    expect((await client.callTool({ name: 'whoami', arguments: {} })).structuredContent).toEqual({ agentId: 'agent-one' });
  });

  it.each([['GET', GET], ['POST', POST], ['DELETE', DELETE]] as const)('authenticates %s before transport processing', async (method, handler) => {
    const response = await handler(new Request(url, { method }));
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('Bearer');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).not.toContain('authentication internals');
    expect(mocks.createServer).not.toHaveBeenCalled();
  });

  it.each(['unknown', 'revoked', 'inactive'])('fails closed for %s credentials', async () => {
    mocks.auth.mockRejectedValueOnce(Object.assign(new Error('private key database details'), { status: 403 }));
    const response = await POST(new Request(url, { method: 'POST', headers: { Authorization: 'Bearer invalid' } }));
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain('private key database details');
    expect(mocks.createServer).not.toHaveBeenCalled();
  });

  it('rechecks authorization after a client has connected', async () => {
    const { client } = await connect('stl_agent_one');
    mocks.createServer.mockClear();
    mocks.auth.mockRejectedValue(Object.assign(new Error('revoked'), { status: 401 }));
    await expect(client.callTool({ name: 'whoami', arguments: {} })).rejects.toThrow();
    expect(mocks.createServer).not.toHaveBeenCalled();
  });

  it('rejects browser requests from a different origin', async () => {
    const response = await POST(new Request(url, {
      method: 'POST', headers: { Authorization: 'Bearer stl_agent_one', Origin: 'https://untrusted.test' },
    }));
    expect(response.status).toBe(403);
    expect(mocks.createServer).not.toHaveBeenCalled();
  });

  it('allows the endpoint origin through to protocol processing', async () => {
    const response = await GET(new Request(url, {
      headers: { Authorization: 'Bearer stl_agent_one', Origin: 'https://settl.test' },
    }));
    expect(response.status).toBe(405);
    await response.text();
  });

  it.each([['GET', GET], ['DELETE', DELETE]] as const)('delegates authenticated %s to the stateless transport', async (method, handler) => {
    const response = await handler(new Request(url, { method, headers: { Authorization: 'Bearer stl_agent_one' } }));
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await response.json()).jsonrpc).toBe('2.0');
  });
});
