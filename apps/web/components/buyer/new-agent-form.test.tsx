import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
import { NewAgentForm } from './new-agent-form';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('does not simulate agent creation when registration remains pending', async () => {
  const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ agentId: 'owned-id', status: 'provisioning', apiKey: 'stl_agent_once' }) }); vi.stubGlobal('fetch', request);
  render(<NewAgentForm rateCents="1500" providers={[{ id: 'stored-provider', displayName: 'Provider' }]}/>);
  fireEvent.change(screen.getByLabelText('Agent name'), { target: { value: 'Bookkeeper' } });
  fireEvent.click(screen.getByLabelText('Provider')); fireEvent.click(screen.getByRole('button', { name: 'Create agent' }));
  await waitFor(() => expect(screen.getByText(/Registration pending/)).toBeTruthy()); expect(screen.queryByText(/exists on Stellar/)).toBeNull();
  expect(JSON.parse(request.mock.calls[0][1].body).allowlist).toEqual(['stored-provider']); expect(screen.getByText('stl_agent_once')).toBeTruthy();
});
