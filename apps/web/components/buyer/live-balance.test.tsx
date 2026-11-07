import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LiveBalance, LiveBudgetTotal } from './live-balance';
const missing = { amountStroops: null, source: 'unavailable' as const, asOf: null };
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('checks absent snapshots without inventing zero and deduplicates shared observers', async () => {
  let resolve!: (value: unknown) => void;
  const fetcher = vi.fn(() => new Promise(r => { resolve = r; })); vi.stubGlobal('fetch', fetcher);
  render(<><LiveBalance url="/balance" initial={missing} rateCents="1500"/><LiveBalance url="/balance" initial={missing} rateCents="1500"/></>);
  expect(screen.getAllByText('Checking balance…')).toHaveLength(2); expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async () => resolve({ ok: true, json: async () => ({ amountStroops: '10000000', source: 'chain', asOf: '2026-11-07T00:00:00Z' }) }));
  expect(screen.getAllByText('₱15.00')).toHaveLength(2); expect(screen.getAllByText(/Observed as of/)).toHaveLength(2);
});
it('polls only while visible and preserves snapshots on failed refresh', async () => {
  vi.useFakeTimers(); let visible = 'visible'; vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visible as DocumentVisibilityState);
  const fetcher = vi.fn().mockRejectedValue(new Error('offline')); vi.stubGlobal('fetch', fetcher);
  render(<LiveBalance url="/other-balance" initial={{ amountStroops: '10000000', source: 'cache', asOf: '2026-11-07T00:00:00Z' }} rateCents="1500"/>);
  await act(async () => {}); expect(screen.getByText('₱15.00')).toBeTruthy();
  await act(async () => vi.advanceTimersByTime(30000)); expect(fetcher).toHaveBeenCalledTimes(2);
  visible = 'hidden'; fireEvent(document, new Event('visibilitychange'));
  await act(async () => vi.advanceTimersByTime(60000)); expect(fetcher).toHaveBeenCalledTimes(2);
  visible = 'visible'; await act(async () => fireEvent(document, new Event('visibilitychange'))); expect(fetcher).toHaveBeenCalledTimes(3);
  cleanup(); await act(async () => vi.advanceTimersByTime(30000)); expect(fetcher).toHaveBeenCalledTimes(3);
});
it('accepts fresh cached responses without reporting a failed balance check', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ amountStroops: '10000000', source: 'cache', asOf: new Date().toISOString() }) }));
  render(<LiveBalance url="/fresh" initial={missing} rateCents="1500"/>);
  await act(async () => {}); expect(screen.getByText('₱15.00')).toBeTruthy(); expect(screen.queryByText(/Live balance unavailable/)).toBeNull();
});
it.each(['headers', 'body'])('stops waiting on stalled HTTP %s and retains its snapshot', async (phase) => {
  vi.useFakeTimers(); vi.stubGlobal('fetch', vi.fn(() => phase === 'headers' ? new Promise(() => {}) : Promise.resolve({ ok: true, json: () => new Promise(() => {}) })));
  render(<LiveBalance url="/stalled" initial={{ amountStroops: '10000000', source: 'cache', asOf: '2026-11-07T00:00:00Z' }} rateCents="1500"/>);
  await act(async () => vi.advanceTimersByTime(12000)); expect(screen.getByText('₱15.00')).toBeTruthy(); expect(screen.getByText(/Live balance unavailable/)).toBeTruthy();
});
it('updates the total when agents change and releases all polling on unmount', async () => {
  vi.useFakeTimers(); const fetcher = vi.fn().mockImplementation((url: string) => Promise.resolve({ ok: true, json: async () => ({ amountStroops: url.includes('/two/') ? '20000000' : '10000000', source: 'cache', asOf: null }) })); vi.stubGlobal('fetch', fetcher);
  const one = { id: 'one', balance: missing }; const two = { id: 'two', balance: missing };
  const view = render(<LiveBudgetTotal agents={[one]} rateCents="1500"/>); await act(async () => {}); expect(screen.getByText('₱15.00')).toBeTruthy();
  view.rerender(<LiveBudgetTotal agents={[two, one]} rateCents="1500"/>); await act(async () => {}); expect(screen.getByText('₱45.00')).toBeTruthy();
  view.rerender(<LiveBudgetTotal agents={[two]} rateCents="1500"/>); await act(async () => {}); expect(screen.getByText('₱30.00')).toBeTruthy();
  view.unmount(); const count = fetcher.mock.calls.length; await act(async () => { vi.advanceTimersByTime(60000); fireEvent(document, new Event('visibilitychange')); }); expect(fetcher).toHaveBeenCalledTimes(count);
});

it('deduplicates an in-flight request across subscription remounts', async () => {
  let complete!: (value: unknown) => void; const request = vi.fn(() => new Promise(resolve => { complete = resolve; })); vi.stubGlobal('fetch', request);
  const view = render(<StrictMode><LiveBalance url="/strict" initial={missing} rateCents="1500"/></StrictMode>);
  expect(request).toHaveBeenCalledTimes(1); view.unmount(); await act(async () => complete({ ok: true, json: async () => missing }));
});
