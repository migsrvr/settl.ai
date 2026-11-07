// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBalanceService } from './balances';

describe('display balance observations', () => {
  const at = new Date('2026-11-07T00:00:30Z');
  const read = vi.fn(); const save = vi.fn();
  beforeEach(() => { vi.useRealTimers(); vi.resetAllMocks(); save.mockResolvedValue(undefined); });
  it('reuses a fresh dated snapshot without an RPC', async () => {
    const service = createBalanceService({ now: () => at });
    expect(await service.observe('agent:a', { amount: 10n, asOf: new Date(at.getTime() - 1000) }, read, save)).toMatchObject({ amountStroops: '10', source: 'cache' });
    expect(read).not.toHaveBeenCalled();
  });
  it('deduplicates concurrent observations and persists only verified data', async () => {
    let resolve!: (v: bigint) => void;
    read.mockReturnValue(new Promise<bigint>(r => { resolve = r; }));
    const service = createBalanceService({ now: () => at });
    const a = service.observe('a', {}, read, save); const b = service.observe('a', {}, read, save);
    resolve(42n);
    expect(await a).toEqual(await b); expect(read).toHaveBeenCalledOnce(); expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith(42n, at);
  });
  it('retains the old timestamp on failure and never invents a zero', async () => {
    read.mockRejectedValue(new Error('RPC unavailable'));
    const service = createBalanceService({ now: () => at });
    const old = new Date('2026-11-06Z');
    expect(await service.observe('a', { amount: 2n, asOf: old }, read, save)).toEqual({ amountStroops: '2', source: 'cache', asOf: old.toISOString() });
    expect(await service.observe('b', {}, read, save)).toEqual({ amountStroops: null, source: 'unavailable', asOf: null });
    expect(save).not.toHaveBeenCalled();
  });
  it('bounds the wait and ignores late results', async () => {
    vi.useFakeTimers();
    let resolve!: (v: bigint) => void;
    read.mockReturnValue(new Promise<bigint>(r => { resolve = r; }));
    const service = createBalanceService({ now: () => at, timeoutMs: 50 });
    const result = service.observe('a', {}, read, save);
    await vi.advanceTimersByTimeAsync(50);
    expect(await result).toMatchObject({ source: 'unavailable' });
    resolve(99n); await Promise.resolve(); expect(save).not.toHaveBeenCalled(); vi.useRealTimers();
  });
  it('does not replace a recent snapshot with a future-dated observation', async () => {
    read.mockResolvedValue(7n);
    const service = createBalanceService({ now: () => at });
    expect(await service.observe('a', { amount: 10n, asOf: new Date(at.getTime() + 60_000) }, read, save)).toMatchObject({ source: 'chain', amountStroops: '7' });
  });
  it('dates a slow observation at read start so it cannot overwrite intervening funding observations', async () => {
    let clock = at;
    read.mockImplementation(async () => { clock = new Date(at.getTime() + 4000); return 7n; });
    const service = createBalanceService({ now: () => clock });
    expect(await service.observe('a', {}, read, save)).toMatchObject({ asOf: at.toISOString() });
    expect(save).toHaveBeenCalledWith(7n, at);
  });
});
