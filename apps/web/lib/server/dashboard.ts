import { cookies } from 'next/headers';
import { connection } from 'next/server';
import { CheckResultSchema } from '@settl/core';
import { createStellarClient, loadStellarConfig } from '@settl/stellar';
import { resolveSession, SESSION_COOKIE, type Role } from '../auth';
import { getDb } from './db';

export type Balance = { amountStroops: string | null; source: 'chain' | 'cache' | 'unavailable'; asOf: string | null };
export type LiveCall = { id: string; agentId: string; endpointId: string; agent: string; customer: string; provider: string; endpoint: string; status: string; amountStroops: string; quotedStroops: string; time: string; confirmedAt: string | null; txHash: string | null; verification: string | null; checks: { check: string; ok: boolean; note?: string }[] };
export function exchangeRateCents(): string | null {
  const value = process.env.PHP_PER_XLM ?? '15';
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return cents > 0n ? cents.toString() : null;
}
async function organization(role: Role, email: string) {
  const org = await getDb().org.findUnique({ where: { email }, select: { id: true, role: true, name: true, walletPublic: true } });
  return org?.role === role ? org : null;
}
const callSelect = {
  id: true, status: true, submittedAt: true, confirmedAt: true, txHash: true,
  quote: { select: { amount: true, agentId: true, endpointId: true, agent: { select: { name: true, org: { select: { name: true } } } }, endpoint: { select: { route: true, provider: { select: { displayName: true } } } }, verification: { select: { result: true, reasons: true } } } },
} as const;
// The explicit projection below is also used by Prisma so secrets never enter this boundary.
function callsDto(rows: { id: string; status: string; submittedAt: Date; confirmedAt: Date | null; txHash: string | null; quote: { amount: bigint; agentId: string; endpointId: string; agent: { name: string; org: { name: string } }; endpoint: { route: string; provider: { displayName: string } }; verification: { result: string; reasons: unknown } | null } }[]): LiveCall[] {
  return rows.map(row => { const checks = CheckResultSchema.array().safeParse(row.quote.verification?.reasons); return {
    id: row.id, status: row.status, agentId: row.quote.agentId, endpointId: row.quote.endpointId, agent: row.quote.agent.name, customer: row.quote.agent.org.name, provider: row.quote.endpoint.provider.displayName, endpoint: row.quote.endpoint.route,
    amountStroops: row.status === 'paid' ? row.quote.amount.toString() : '0', quotedStroops: row.quote.amount.toString(), time: row.submittedAt.toISOString(), confirmedAt: row.confirmedAt?.toISOString() ?? null, txHash: row.txHash, verification: row.quote.verification?.result ?? null,
    checks: checks.success ? checks.data.map(({ check, ok, note }) => ({ check, ok, ...(note ? { note } : {}) })) : [],
  }; });
}
async function chainBalance(read: () => Promise<bigint>, cached?: { cachedBalance?: bigint | null; balanceUpdatedAt?: Date | null }): Promise<Balance> {
  try { return { amountStroops: (await read()).toString(), source: 'chain', asOf: new Date().toISOString() }; }
  catch { return cached?.cachedBalance != null && cached.balanceUpdatedAt ? { amountStroops: cached.cachedBalance.toString(), source: 'cache', asOf: cached.balanceUpdatedAt.toISOString() } : { amountStroops: null, source: 'unavailable', asOf: null }; }
}
export async function loadProviderDashboard() {
  // Keep request-time APIs outside the data-error boundary so Next can suspend prerendering.
  await connection();
  const session = resolveSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session || session.role !== 'provider') return null;
  try {
    const org = await organization('provider', session.email); if (!org) return null;
    const db = getDb();
    const [provider, payments] = await Promise.all([
      db.provider.findUnique({ where: { orgId: org.id }, select: { id: true, displayName: true, merchantWallet: true, settings: { select: { autoClaimEnabled: true, autoClaimThreshold: true } }, endpoints: { select: { id: true, name: true, route: true, method: true, price: true, mode: true, active: true } }, claims: { orderBy: { createdAt: 'desc' }, select: { id: true, amount: true, status: true, txHash: true, createdAt: true, claimedAt: true } } } }),
      db.payment.findMany({ where: { quote: { endpoint: { provider: { orgId: org.id } } } }, orderBy: { submittedAt: 'desc' }, select: callSelect }),
    ]);
    if (!provider) return null;
    const pending = await chainBalance(() => createStellarClient(loadStellarConfig()).pendingBalance(provider.merchantWallet));
    return { orgName: org.name, id: provider.id, displayName: provider.displayName, merchantWallet: provider.merchantWallet, pending, rateCents: exchangeRateCents(), calls: callsDto(payments), endpoints: provider.endpoints.map(e => ({ ...e, price: e.price.toString() })), claims: provider.claims.map(c => ({ id: c.id, amountStroops: c.amount.toString(), status: c.status, txHash: c.txHash, createdAt: c.createdAt.toISOString(), claimedAt: c.claimedAt?.toISOString() ?? null })), settings: provider.settings ? { enabled: provider.settings.autoClaimEnabled, threshold: provider.settings.autoClaimThreshold.toString() } : null };
  } catch (err) {
    console.error("loadProviderDashboard error:", err);
    return null;
  }
}
export async function loadBuyerDashboard() {
  // Live balances and expiry checks must wait for the actual request, not prerendering.
  // Keep this outside try/catch so Next's prerender interruption can propagate.
  await connection();
  const session = resolveSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session || session.role !== 'buyer') return null;
  try {
    const org = await organization('buyer', session.email);
    if (!org) return null;
    const db = getDb();
    const [agents, payments, approvals, providers] = await Promise.all([
      db.agent.findMany({ where: { orgId: org.id }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true, status: true, agentPublic: true, deviceHash: true, cachedBalance: true, balanceUpdatedAt: true, policy: { select: { maxAmount: true, dailyBudget: true, autoApproveUpTo: true, expiresAt: true, allowlist: true } }, topups: { select: { id: true, amount: true, status: true, fundTxHash: true, createdAt: true } }, reservations: { where: { status: 'held' }, select: { amount: true } } } }),
      db.payment.findMany({ where: { quote: { agent: { orgId: org.id } } }, orderBy: { submittedAt: 'desc' }, select: callSelect }),
      db.approval.findMany({ where: { agent: { orgId: org.id }, status: 'pending', expiresAt: { gt: new Date() } }, select: { id: true, agentId: true, amount: true, expiresAt: true, provider: { select: { displayName: true } } } }),
      db.provider.findMany({ select: { id: true, displayName: true }, orderBy: { displayName: 'asc' } }),
    ]);
    return { orgName: org.name, walletPublic: org.walletPublic, rateCents: exchangeRateCents(), providers, calls: callsDto(payments), approvals: approvals.map(a => ({ id: a.id, agentId: a.agentId, amountStroops: a.amount.toString(), provider: a.provider.displayName, expiresAt: a.expiresAt.toISOString() })), agents: await Promise.all(agents.map(async a => ({ id: a.id, name: a.name, status: a.status, agentPublic: a.agentPublic, deviceHash: a.deviceHash, balance: await chainBalance(() => createStellarClient(loadStellarConfig()).balanceOf(a.deviceHash), a), heldStroops: a.reservations.reduce((s, r) => s + r.amount, 0n).toString(), policy: a.policy ? { cap: a.policy.maxAmount.toString(), daily: a.policy.dailyBudget.toString(), auto: a.policy.autoApproveUpTo.toString(), expiresAt: a.policy.expiresAt.toISOString(), allowlist: a.policy.allowlist } : null, topups: a.topups.map(t => ({ id: t.id, amountStroops: t.amount.toString(), status: t.status, txHash: t.fundTxHash, createdAt: t.createdAt.toISOString() })) }))) };
  } catch (err) {
    console.error("loadBuyerDashboard error:", err);
    return null;
  }
}
export type BuyerDashboard = NonNullable<Awaited<ReturnType<typeof loadBuyerDashboard>>>;
export type ProviderDashboard = NonNullable<Awaited<ReturnType<typeof loadProviderDashboard>>>;
