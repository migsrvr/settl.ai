import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
import { ProvisioningProgress } from './provisioning-progress';
const progress = { agentId: 'a', status: 'provisioning', stage: 'register_device', state: 'pending', updatedAt: '2026-11-07T00:00:00Z', transactions: [], errorCode: null, needsReview: true };
beforeEach(() => { vi.useFakeTimers(); Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }
it('refreshes newly activated agents separately when the component is reused', async () => {
  const request = vi.fn().mockImplementation(async (url: string) => ({ ok: true, json: async () => ({ ...progress, agentId: url.includes('/b/') ? 'b' : 'a', status: 'active', stage: 'complete', state: 'complete' }) })); vi.stubGlobal('fetch', request);
  const view = render(<ProvisioningProgress agentId="a"/>); await flush(); expect(refresh).toHaveBeenCalledTimes(1);
  view.rerender(<ProvisioningProgress agentId="b"/>); await flush(); expect(refresh).toHaveBeenCalledTimes(2);
});
it('renders actual pending stages, then stops and refreshes once on activation', async () => {
  const request = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => progress }).mockResolvedValue({ ok: true, json: async () => ({ ...progress, status: 'active', stage: 'complete', state: 'complete', needsReview: false }) }); vi.stubGlobal('fetch', request);
  render(<ProvisioningProgress agentId="a"/>); await flush(); expect(screen.getByText(/Needs review/)).toBeTruthy(); expect(screen.getByText(/Awaiting confirmation/)).toBeTruthy(); expect(screen.queryByText('Agent ready')).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); }); expect(screen.getByText('Agent ready')).toBeTruthy(); expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); }); expect(request).toHaveBeenCalledTimes(2); expect(request.mock.calls[0][1].cache).toBe('no-store'); expect(request.mock.calls[0][1].method).toBe('GET');
});
it('suspends while hidden, resumes on visibility, and aborts on unmount', async () => {
  const request = vi.fn().mockImplementation(() => new Promise(() => {})); vi.stubGlobal('fetch', request);
  const view = render(<ProvisioningProgress agentId="a"/>); await flush();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); act(() => { document.dispatchEvent(new Event('visibilitychange')); }); expect(request.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(4000); }); expect(request).toHaveBeenCalledTimes(1);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); act(() => { document.dispatchEvent(new Event('visibilitychange')); }); await flush(); expect(request).toHaveBeenCalledTimes(2); view.unmount(); expect(request.mock.calls[1][1].signal.aborted).toBe(true);
});
it('bounds body reads and keeps a single read in flight', async () => {
  const request = vi.fn().mockResolvedValue({ ok: true, json: () => new Promise(() => {}) }); vi.stubGlobal('fetch', request);
  render(<ProvisioningProgress agentId="a"/>); await flush(); await act(async () => { await vi.advanceTimersByTimeAsync(9000); }); expect(request).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); }); expect(screen.getByText(/Status is unavailable/)).toBeTruthy(); expect(request.mock.calls[0][1].signal.aborted).toBe(true);
});
it.each(['error', 'revoked'])('stops polling for terminal %s status', async status => {
  const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...progress, status, state: 'failed' }) }); vi.stubGlobal('fetch', request);
  render(<ProvisioningProgress agentId="a"/>); await flush(); await act(async () => { await vi.advanceTimersByTimeAsync(6000); }); expect(request).toHaveBeenCalledTimes(1); expect(refresh).not.toHaveBeenCalled();
});
