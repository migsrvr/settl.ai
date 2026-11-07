import type { Balance } from './dashboard';
import { createStellarClient, loadStellarConfig } from '@settl/stellar';
import { ApiError } from './api-auth';
import { getDb } from './db';
import { createTimingTracker } from './timing';

type Snapshot = { amount?: bigint | null; asOf?: Date | null };
export function snapshotBalance(snapshot: Snapshot): Balance {
  return snapshot.amount != null && snapshot.asOf
    ? { amountStroops: snapshot.amount.toString(), source: 'cache', asOf: snapshot.asOf.toISOString() }
    : { amountStroops: null, source: 'unavailable', asOf: null };
}

/** Process-local read coalescing only. Financial authorization never uses this service. */
export function createBalanceService({ now = () => new Date(), timeoutMs = 8000 } = {}) {
  const inflight = new Map<string, Promise<Balance>>();
  async function observe(key: string, snapshot: Snapshot, read: () => Promise<bigint>, save: (amount: bigint, at: Date) => Promise<unknown>): Promise<Balance> {
    const age = snapshot.asOf ? now().getTime() - snapshot.asOf.getTime() : Infinity;
    if (snapshot.amount != null && age >= 0 && age < 15_000) return snapshotBalance(snapshot);
    const pending = inflight.get(key); if (pending) return pending;
    const task = (async (): Promise<Balance> => {
      const timing = createTimingTracker('dashboard.balance');
      // Older in-flight reads cannot replace a funding/newer read observation.
      const at = now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const amount = await timing.measure('rpc_prep', () => Promise.race([
          read(),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); }),
        ]));
        await timing.measure('db', () => save(amount, at));
        timing.finish('observed');
        return { amountStroops: amount.toString(), source: 'chain', asOf: at.toISOString() };
      } catch {
        timing.finish('unavailable');
        return snapshotBalance(snapshot);
      } finally { if (timer) clearTimeout(timer); }
    })();
    inflight.set(key, task);
    try { return await task; } finally { if (inflight.get(key) === task) inflight.delete(key); }
  }
  return { observe };
}
const service = createBalanceService();
export async function observeAgentBalance(orgId: string, id: string): Promise<Balance> {
  const db = getDb();
  const agent = await db.agent.findFirst({ where: { id, orgId }, select: { id: true, deviceHash: true, cachedBalance: true, balanceUpdatedAt: true } });
  if (!agent) throw new ApiError(404, 'agent_not_found');
  return service.observe(`agent:${orgId}:${agent.id}`, { amount: agent.cachedBalance, asOf: agent.balanceUpdatedAt },
    () => createStellarClient(loadStellarConfig()).balanceOf(agent.deviceHash),
    (amount, at) => db.agent.updateMany({ where: { id, orgId, OR: [{ balanceUpdatedAt: null }, { balanceUpdatedAt: { lte: at } }] }, data: { cachedBalance: amount, balanceUpdatedAt: at } }));
}
export async function observeProviderBalance(orgId: string): Promise<Balance> {
  const db = getDb();
  const provider = await db.provider.findUnique({ where: { orgId }, select: { id: true, merchantWallet: true, cachedPendingBalance: true, pendingBalanceUpdatedAt: true } });
  if (!provider) throw new ApiError(404, 'provider_not_found');
  return service.observe(`provider:${orgId}:${provider.id}`, { amount: provider.cachedPendingBalance, asOf: provider.pendingBalanceUpdatedAt },
    () => createStellarClient(loadStellarConfig()).pendingBalance(provider.merchantWallet),
    (amount, at) => db.provider.updateMany({ where: { id: provider.id, orgId, OR: [{ pendingBalanceUpdatedAt: null }, { pendingBalanceUpdatedAt: { lte: at } }] }, data: { cachedPendingBalance: amount, pendingBalanceUpdatedAt: at } }));
}
