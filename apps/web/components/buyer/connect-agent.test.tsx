import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectAgent, connectSnippets } from './connect-agent';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const mcpUrl = 'https://settl.example/mcp';

describe('connectSnippets', () => {
  const snippets = connectSnippets(mcpUrl, 'stl_agent_abc123');

  it('gives a Claude Code command with the endpoint and key', () => {
    expect(snippets.claude.code).toBe('claude mcp add --transport http settl https://settl.example/mcp --header "Authorization: Bearer stl_agent_abc123"');
  });

  it('gives Codex config that reads the key from the environment', () => {
    expect(snippets.codex.code).toContain('[mcp_servers.settl]');
    expect(snippets.codex.code).toContain('url = "https://settl.example/mcp"');
    expect(snippets.codex.code).toContain('bearer_token_env_var = "SETTL_AGENT_API_KEY"');
    expect(snippets.codex.code).toContain('export SETTL_AGENT_API_KEY=stl_agent_abc123');
  });

  it('gives Cursor JSON that parses', () => {
    const config = JSON.parse(snippets.cursor.code);
    expect(config.mcpServers.settl).toEqual({ url: mcpUrl, headers: { Authorization: 'Bearer stl_agent_abc123' } });
  });

  it('gives @settl/client code', () => {
    expect(snippets.sdk.code).toContain('import { connectSettl } from "@settl/client"');
    expect(snippets.sdk.code).toContain(mcpUrl);
  });

  it('uses a visible placeholder when the key is not available', () => {
    expect(connectSnippets(mcpUrl).claude.code).toContain('Bearer stl_agent_YOUR_KEY');
  });
});

describe('ConnectAgent', () => {
  it('shows the Claude Code setup first and switches between clients', async () => {
    render(<ConnectAgent mcpUrl={mcpUrl} apiKey="stl_agent_abc123"/>);
    expect(screen.getByText(/claude mcp add/)).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Codex' }));
    expect(screen.getByText(/mcp_servers\.settl/)).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Cursor' }));
    expect(screen.getByText(/mcpServers/)).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '@settl/client' }));
    expect(screen.getByText(/connectSettl/)).toBeTruthy();
  });

  it('warns that the setup contains the key when it is filled in', () => {
    render(<ConnectAgent mcpUrl={mcpUrl} apiKey="stl_agent_abc123"/>);
    expect(screen.getByText(/includes this agent's key/i)).toBeTruthy();
  });

  it('explains why the key cannot be shown again when it is not available', () => {
    render(<ConnectAgent mcpUrl={mcpUrl}/>);
    expect(screen.getByText(/stores only a fingerprint/i)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/stl_agent_[a-z0-9]{6}/);
  });

  it('copies the setup for the selected client and says so', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<ConnectAgent mcpUrl={mcpUrl} apiKey="stl_agent_abc123"/>);
    fireEvent.click(screen.getByRole('tab', { name: 'Codex' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy Codex setup' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/copied/i));
    expect(writeText).toHaveBeenCalledWith(connectSnippets(mcpUrl, 'stl_agent_abc123').codex.code);
  });

  it('tells the person to copy by hand when the clipboard is blocked', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, configurable: true });
    render(<ConnectAgent mcpUrl={mcpUrl}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Copy Claude Code setup' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/select the text/i));
  });
});
