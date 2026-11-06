import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
import { AgentControls } from './live-agent-controls';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
const agent = { id: 'owned-agent', name: 'Agent', status: 'active' as const, agentPublic: 'GAGENT', deviceHash: 'hash', balance: { amountStroops: null, source: 'unavailable' as const, asOf: null }, heldStroops: '0', policy: null, topups: [] };
it('keeps pending revocation locked and refreshes without fabricating success', async () => {
  const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'pending', txHash: 'actual-hash' }) }); vi.stubGlobal('fetch', request);
  render(<AgentControls agent={agent} providers={[]} rateCents="1500"/>);
  fireEvent.click(screen.getByRole('button', { name: 'Revoke agent' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm revocation' }));
  await waitFor(() => expect(screen.getByText(/Revocation pending/)).toBeTruthy());
  expect((screen.getByRole('button', { name: 'Revoke agent' }) as HTMLButtonElement).disabled).toBe(true); expect(screen.queryByText('Agent revoked on Stellar.')).toBeNull(); expect(refresh).toHaveBeenCalledTimes(1); expect(request).toHaveBeenCalledTimes(1);
});
it('disables lifecycle controls for a provisioning agent', () => {
  render(<AgentControls agent={{ ...agent, status: 'provisioning' }} providers={[]} rateCents="1500"/>);
  expect((screen.getByRole('button', { name: 'Revoke agent' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Edit limits' }) as HTMLButtonElement).disabled).toBe(true);
});
