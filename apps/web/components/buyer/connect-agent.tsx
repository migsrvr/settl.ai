'use client';
import { useState, useSyncExternalStore } from 'react';
import { Button, TabBar } from '@/components/ui';

export type ConnectClient = 'claude' | 'codex' | 'cursor' | 'sdk';

const PLACEHOLDER_KEY = 'stl_agent_YOUR_KEY';

/** Paste-ready setup for each client. Exported for tests and for anywhere else that shows setup. */
export function connectSnippets(mcpUrl: string, apiKey: string = PLACEHOLDER_KEY): Record<ConnectClient, { label: string; code: string }> {
  return {
    claude: {
      label: 'Claude Code',
      code: `claude mcp add --transport http settl ${mcpUrl} --header "Authorization: Bearer ${apiKey}"`,
    },
    codex: {
      label: 'Codex',
      code: `# ~/.codex/config.toml\n[mcp_servers.settl]\nurl = "${mcpUrl}"\nbearer_token_env_var = "SETTL_AGENT_API_KEY"\n\n# then, in the shell that runs Codex\nexport SETTL_AGENT_API_KEY=${apiKey}`,
    },
    cursor: {
      label: 'Cursor',
      code: JSON.stringify({ mcpServers: { settl: { url: mcpUrl, headers: { Authorization: `Bearer ${apiKey}` } } } }, null, 2),
    },
    sdk: {
      label: '@settl/client',
      code: `import { connectSettl } from "@settl/client";\n\nconst agent = await connectSettl({\n  mcpUrl: "${mcpUrl}",\n  apiKey: process.env.SETTL_AGENT_API_KEY,\n});`,
    },
  };
}

const ORDER: ConnectClient[] = ['claude', 'codex', 'cursor', 'sdk'];
const subscribeNever = () => () => {};

/**
 * Connect an agent's client to Settl's MCP. Pass `apiKey` only on the screen that has just created it:
 * Settl keeps a fingerprint of the key, so it cannot be shown again later.
 */
export function ConnectAgent({ apiKey, mcpUrl }: { apiKey?: string; mcpUrl?: string }) {
  const [client, setClient] = useState<ConnectClient>('claude');
  const [message, setMessage] = useState('');
  // The page origin is the gateway; it is unknown during server rendering, so the first paint shows a relative URL.
  const origin = useSyncExternalStore(subscribeNever, () => window.location.origin, () => '');
  const url = mcpUrl ?? (origin ? `${origin}/mcp` : '/mcp');
  const snippets = connectSnippets(url, apiKey);
  const selected = snippets[client];

  async function copy() {
    try {
      await navigator.clipboard.writeText(selected.code);
      setMessage(`${selected.label} setup copied.`);
    } catch {
      setMessage('Copy failed. Select the text above and copy it by hand.');
    }
  }

  return (
    <section aria-labelledby="connect-agent-title" className="flex min-w-0 flex-col gap-4">
      <h2 id="connect-agent-title" className="text-lg font-medium">Connect your agent</h2>
      <p className="max-w-[65ch] text-ink-2">Give your agent&apos;s client this setup. It then sees Settl&apos;s tools and every service it may buy, with prices and the input each one takes.</p>
      <TabBar
        label="Agent client"
        tabs={ORDER.map((id) => ({ id, label: snippets[id].label }))}
        value={client}
        onChange={(id) => { setClient(id); setMessage(''); }}
      />
      <pre className="overflow-x-auto rounded-lg bg-ink p-6 font-mono text-sm leading-relaxed text-code">{selected.code}</pre>
      <Button onClick={copy} className="self-start">{`Copy ${selected.label} setup`}</Button>
      <p role="status">{message}</p>
      {apiKey
        ? <p className="max-w-[65ch]">This setup includes this agent&apos;s key. Treat it like a password and keep it out of shared files.</p>
        : <p className="max-w-[65ch]">Replace {PLACEHOLDER_KEY} with the key you saved when you created this agent. Settl stores only a fingerprint of the key, so it cannot show it again. If it is lost, revoke this agent and create a new one.</p>}
    </section>
  );
}
