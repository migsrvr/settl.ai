import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
import { ClaimPanel } from '../provider/claim-panel';
import { AgentBudget } from './agent-budget';
import { checkoutUrl, phpToExactStroops } from './live-money';
describe('live money actions', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
  it('converts PHP using integer arithmetic and rejects executable checkout URLs', () => { expect(phpToExactStroops('0.01', '1500')).toBe('6667'); expect(() => checkoutUrl('javascript:alert(1)')).toThrow(); expect(() => phpToExactStroops('1.001', '1500')).toThrow(); });
  it('does not turn a pending claim into a completed payout or retry', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'pending', txHash: 'real-hash' }) }); vi.stubGlobal('fetch', fetcher);
    render(<ClaimPanel pending={{ amountStroops: '10000000', source: 'chain', asOf: null }} merchantWallet="GMERCHANT" claims={[]} rateCents="1500" earnedStroops="10000000" settings={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Claim ₱15.00' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm claim' }));
    await waitFor(() => expect(screen.getByText(/Claim pending/)).toBeTruthy()); expect(fetcher).toHaveBeenCalledTimes(1); expect(refresh).toHaveBeenCalled(); expect(screen.queryByText(/is in your wallet/)).toBeNull();
  });
  it.each(['server', 'network'])('keeps the balance and prevents another checkout after a %s failure', async (failure) => {
    const request = failure === 'network' ? vi.fn().mockRejectedValue(new Error('connection lost')) : vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'unavailable' }) });
    vi.stubGlobal('fetch', request);
    render(<AgentBudget agentId="owned" balance={{ amountStroops: '10000000', source: 'chain', asOf: null }} rateCents="1500" topups={[]} spentToday="0" heldStroops="0" active />);
    fireEvent.click(screen.getByRole('button', { name: 'Load budget' })); fireEvent.click(screen.getByRole('button', { name: 'Continue to checkout' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Review Budget loads/)); expect(screen.getByText('₱15.00')).toBeTruthy();
    const submit = screen.getByRole('button', { name: 'Continue to checkout' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true); fireEvent.click(submit);
    fireEvent.submit(submit.closest('form')!);
    expect(request).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect((screen.getByRole('button', { name: 'Load budget' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('₱15.00')).toBeTruthy();
  });
});
