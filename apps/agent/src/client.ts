import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

export interface McpConnection {
  callTool(name: string, args: Record<string, unknown>, timeoutMs?: number): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

export function decodeToolResult(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid MCP result');
  const result = raw as Record<string, unknown>;
  if (result.isError) throw new Error('MCP tool failed');
  let value = result.structuredContent;
  if (value === undefined && Array.isArray(result.content)) {
    const text = result.content.find((item: unknown) => item && typeof item === 'object' &&
      (item as Record<string, unknown>).type === 'text') as { text?: unknown } | undefined;
    if (typeof text?.text === 'string') value = JSON.parse(text.text);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid MCP JSON object');
  return value as Record<string, unknown>;
}

export function mcpUrl(value: string): URL {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('SETTL_MCP_URL must be an HTTP(S) endpoint without credentials, query or fragment');
  }
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('Hosted SETTL_MCP_URL must use HTTPS');
  }
  return url;
}

export async function connectMcp(url: string, token: string): Promise<McpConnection> {
  const endpoint = mcpUrl(url);
  const client = new Client({ name: 'settl-bookkeeper', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(endpoint, {
    requestInit: { headers: { Authorization: `Bearer ${token}` }, redirect: 'error' },
  });
  try {
    await client.connect(transport);
    return {
      async callTool(name, args, timeoutMs = 130_000) {
        return decodeToolResult(await client.callTool({ name, arguments: args }, { timeout: timeoutMs }));
      },
      async close() {
        try { await client.close(); }
        finally { await transport.close(); }
      },
    };
  } catch {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
    throw new Error('MCP connection failed. Check the hosted URL and agent token.');
  }
}
