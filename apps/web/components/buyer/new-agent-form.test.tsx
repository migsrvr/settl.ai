import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
import { NewAgentForm } from './new-agent-form';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.clearAllMocks(); });
it('locks creation after a server failure that may have committed', async () => {
  const request = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: 'unavailable' }) }); vi.stubGlobal('fetch', request);
  render(<NewAgentForm rateCents="1500" providers={[]}/>);
  fireEvent.change(screen.getByLabelText('Agent name'), { target: { value: 'Bookkeeper' } }); fireEvent.click(screen.getByRole('button', { name: 'Create agent' }));
  await waitFor(() => expect(screen.getByRole('link', { name: 'View agents' })).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: 'Create agent' })); expect(request).toHaveBeenCalledTimes(1);
});
it('bounds creation body reads without retrying the submission', async () => {
  vi.useFakeTimers();
  const request = vi.fn().mockResolvedValue({ ok: true, json: () => new Promise(() => {}) }); vi.stubGlobal('fetch', request);
  render(<NewAgentForm rateCents="1500" providers={[]}/>);
  fireEvent.change(screen.getByLabelText('Agent name'), { target: { value: 'Bookkeeper' } }); fireEvent.click(screen.getByRole('button', { name: 'Create agent' }));
  expect(screen.getByRole('button', { name: 'Creating agent…' })).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  expect(screen.getByRole('link', { name: 'View agents' })).toBeTruthy(); expect(request.mock.calls[0][1].signal.aborted).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Create agent' })); expect(request).toHaveBeenCalledTimes(1);
});
it('keeps the one-time key visible after registration becomes active', async () => {
  const request = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ agentId: 'owned-id', status: 'provisioning', apiKey: 'stl_agent_once' }) }).mockResolvedValue({ ok: true, json: async () => ({ agentId: 'owned-id', status: 'active', stage: 'complete', state: 'complete', updatedAt: '2026-11-07T00:00:00Z', transactions: [], errorCode: null, needsReview: false }) }); vi.stubGlobal('fetch', request);
  render(<NewAgentForm rateCents="1500" providers={[]}/>);
  fireEvent.change(screen.getByLabelText('Agent name'), { target: { value: 'Bookkeeper' } }); fireEvent.click(screen.getByRole('button', { name: 'Create agent' }));
  await waitFor(() => expect(screen.getByText('Agent ready')).toBeTruthy()); expect(screen.getByText('stl_agent_once')).toBeTruthy(); expect(request).toHaveBeenCalledTimes(2); expect(refresh).toHaveBeenCalledTimes(1);
});
it('does not poll creation progress for a pending policy update', async () => {
  const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'pending' }) }); vi.stubGlobal('fetch', request);
  render(<NewAgentForm rateCents="1500" providers={[]} agentId="owned-id"/>);
  fireEvent.click(screen.getByRole('button', { name: 'Save limits' }));
  await waitFor(() => expect(screen.getByText(/Registration pending/)).toBeTruthy()); expect(request).toHaveBeenCalledTimes(1); expect(request.mock.calls[0][1].method).toBe('PATCH');
});
it('provides navigation without repeating an unknown creation', async () => {
  const request = vi.fn().mockRejectedValue(new Error('offline')); vi.stubGlobal('fetch', request);
  render(<NewAgentForm rateCents="1500" providers={[]}/>);
  fireEvent.change(screen.getByLabelText('Agent name'), { target: { value: 'Bookkeeper' } }); fireEvent.click(screen.getByRole('button', { name: 'Create agent' }));
  await waitFor(() => expect(screen.getByRole('link', { name: 'View agents' }).getAttribute('href')).toBe('/buyer'));
  fireEvent.click(screen.getByRole('button', { name: 'Create agent' })); expect(request).toHaveBeenCalledTimes(1);
});
it('does not simulate agent creation when registration remains pending', async () => {
  const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ agentId: 'owned-id', status: 'provisioning', apiKey: 'stl_agent_once' }) }); vi.stubGlobal('fetch', request);
  render(<NewAgentForm rateCents="1500" providers={[{ id: 'stored-provider', displayName: 'Provider' }]}/>);
  fireEvent.change(screen.getByLabelText('Agent name'), { target: { value: 'Bookkeeper' } });
  fireEvent.click(screen.getByLabelText('Provider')); fireEvent.click(screen.getByRole('button', { name: 'Create agent' }));
  await waitFor(() => expect(screen.getByText(/Registration pending/)).toBeTruthy()); expect(screen.queryByText(/exists on Stellar/)).toBeNull();
  expect(JSON.parse(request.mock.calls[0][1].body).allowlist).toEqual(['stored-provider']); expect(screen.getByText('stl_agent_once')).toBeTruthy();
});
