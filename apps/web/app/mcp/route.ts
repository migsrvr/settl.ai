import { createMcpHandler } from '@modelcontextprotocol/server';
import { requireAgentAuth } from '../../lib/server/api-auth';
import { createAgentMcpServer } from '../../lib/server/mcp-tools';

// The SDK invokes this factory for every HTTP request. No agent-specific server is shared.
const handler = createMcpHandler(({ authInfo }) => {
  if (!authInfo?.clientId) throw new Error('Authenticated agent identity is required');
  return createAgentMcpServer(authInfo.clientId);
}, {
  legacy: 'stateless',
  responseMode: 'sse',
  maxRequestBodySize: 1024 * 1024,
});

function noStore(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function serve(request: Request): Promise<Response> {
  let agentId: string;
  try {
    ({ agentId } = await requireAgentAuth(request));
    if (!agentId) throw new Error('Missing authenticated identity');
  } catch {
    return noStore(Response.json({ error: 'Unauthorized' }, {
      status: 401,
      headers: { 'WWW-Authenticate': 'Bearer realm="settl-agent"' },
    }));
  }

  // Native MCP clients omit Origin; browser callers must share the endpoint's origin.
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== new URL(request.url).origin) {
    return noStore(Response.json({ error: 'Forbidden origin' }, { status: 403 }));
  }

  // Pass only verified identity to the factory; never retain the raw bearer credential.
  try {
    return noStore(await handler.fetch(request, {
      authInfo: { token: 'verified-agent-key', clientId: agentId, scopes: [] },
    }));
  } catch {
    return noStore(Response.json({ error: 'MCP request failed' }, { status: 500 }));
  }
}

export { serve as GET, serve as POST, serve as DELETE };
