import { cookies } from 'next/headers';
import { connection } from 'next/server';
import { CheckResultSchema } from '@settl/core';
import { cache } from 'react';
import { Prisma } from '../generated/prisma/client';
import { snapshotBalance } from './balances';
import { createTimingTracker } from './timing';
import { loadWorkspaceOrganization } from './workspace-accounts';
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
const organization = cache(async (role: Role, email: string) => {
  const org = await loadWorkspaceOrganization(email);
  return org?.role === role ? org : null;
});
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

const PAGE_SIZE = 25;
type Options = { cursor?: string; q?: string; status?: string; topupCursor?: string };
type Cursor = { id: string; at: string };
function decodeCursor(value?: string): Cursor | null {
  if (!value || value.length > 1024) return null;
  try {
    const c = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    return typeof c.id === 'string' && c.id.length <= 200 && typeof c.at === 'string' && Number.isFinite(Date.parse(c.at)) ? c : null;
  } catch { return null; }
}
function page<T extends { id: string }>(rows: T[], timestamp: (row: T) => Date) {
  const items = rows.slice(0, PAGE_SIZE); const last = items.at(-1);
  return { items, nextCursor: rows.length > PAGE_SIZE && last ? Buffer.from(JSON.stringify({ id: last.id, at: timestamp(last).toISOString() })).toString('base64url') : null };
}
function keyset(cursor: string | undefined, field: 'submittedAt' | 'createdAt') {
  const c = decodeCursor(cursor);
  return c ? { OR: [{ [field]: { lt: new Date(c.at) } }, { [field]: new Date(c.at), id: { lt: c.id } }] } : {};
}
function search(q?: string): Prisma.PaymentWhereInput | undefined {
  const term = q?.trim().slice(0, 200); if (!term) return undefined;
  const contains = { contains: term, mode: 'insensitive' as const };
  return { OR: [{ id: contains }, { txHash: contains }, { quote: { agentId: contains } }, { quote: { agent: { name: contains } } }, { quote: { agent: { org: { name: contains } } } }, { quote: { endpoint: { route: contains } } }, { quote: { endpoint: { provider: { displayName: contains } } } }] };
}
function calls(where: Prisma.PaymentWhereInput, options: Options = {}) {
  const status = ['paid', 'not_charged', 'blocked', 'failed', 'pending'].includes(options.status ?? '') ? options.status as Prisma.PaymentWhereInput['status'] : undefined;
  return getDb().payment.findMany({
    where: { ...where, ...(status ? { status } : {}), ...keyset(options.cursor, 'submittedAt'), ...(search(options.q) ? { AND: [search(options.q)!] } : {}) },
    orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }], take: PAGE_SIZE + 1, select: callSelect,
  }).then(rows => { const result = page(rows, row => row.submittedAt); return { calls: callsDto(result.items), nextCursor: result.nextCursor }; });
}
function day() { const at = new Date(); return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate())); }
type SummaryRow = { agentId: string; agent: string; customer: string; status: string; verification: string | null; hour: number; amount: string; count: number };
// Aggregate in SQL so historical totals/charts never depend on the visible page.
// No raw interpolation: all identities and timestamps remain bound parameters.
async function summary(orgId: string, role: Role, agentId?: string): Promise<SummaryRow[]> {
  const from = day(); const to = new Date(from.getTime() + 86_400_000);
  const scope = role === 'buyer' ? Prisma.sql`a.org_id = ${orgId}` : Prisma.sql`pr.org_id = ${orgId}`;
  return getDb().$queryRaw<SummaryRow[]>(Prisma.sql`
    SELECT a.id AS "agentId", a.name AS agent, o.name AS customer, p.status::text,
      v.result::text AS verification,
      EXTRACT(HOUR FROM COALESCE(p.confirmed_at, p.submitted_at))::int AS hour,
      SUM(q.amount)::text AS amount, COUNT(*)::int AS count
    FROM payments p JOIN quotes q ON q.id = p.quote_id JOIN agents a ON a.id = q.agent_id
      JOIN orgs o ON o.id = a.org_id JOIN endpoints e ON e.id = q.endpoint_id
      JOIN providers pr ON pr.id = e.provider_id LEFT JOIN verifications v ON v.quote_id = q.id
    WHERE ${scope} ${agentId ? Prisma.sql`AND a.id = ${agentId}` : Prisma.empty}
      AND COALESCE(p.confirmed_at, p.submitted_at) >= ${from}
      AND COALESCE(p.confirmed_at, p.submitted_at) < ${to}
      AND (p.status != 'paid' OR p.confirmed_at IS NOT NULL)
    GROUP BY a.id, a.name, o.name, p.status, v.result, hour`);
}
function totals(rows: SummaryRow[]) {
  const sum = (status: string) => rows.filter(r => r.status === status).reduce((n, r) => n + BigInt(r.amount), 0n).toString();
  const count = (status: string) => rows.filter(r => r.status === status).reduce((n, r) => n + r.count, 0);
  return { spentToday: sum('paid'), paidCalls: count('paid'), notChargedStroops: sum('not_charged'), notChargedCount: count('not_charged') };
}
async function load<T>(role: Role, operation: string, read: (org: NonNullable<Awaited<ReturnType<typeof organization>>>) => Promise<T>) {
  // Do not swallow Next's prerender interruption inside the data-error boundary.
  await connection();
  const session = resolveSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session || session.role !== role) return null;
  const timing = createTimingTracker(operation);
  try {
    const org = await timing.measure('auth', () => organization(role, session.email)); if (!org) { timing.finish('unauthorized'); return null; }
    const result = await timing.measure('db', () => read(org)); timing.finish('loaded'); return result;
  } catch { timing.finish('unavailable'); return null; }
}
const providerSelect = {
  id: true, displayName: true, merchantWallet: true, cachedPendingBalance: true, pendingBalanceUpdatedAt: true,
  settings: { select: { autoClaimEnabled: true, autoClaimThreshold: true } },
} as const;
function providerDto(p: Prisma.ProviderGetPayload<{ select: typeof providerSelect }>) {
  return { id: p.id, displayName: p.displayName, merchantWallet: p.merchantWallet,
    pending: snapshotBalance({ amount: p.cachedPendingBalance, asOf: p.pendingBalanceUpdatedAt }), rateCents: exchangeRateCents(),
    settings: p.settings ? { enabled: p.settings.autoClaimEnabled, threshold: p.settings.autoClaimThreshold.toString() } : null };
}
export async function loadProviderEndpoints() {
  return load('provider', 'dashboard.provider.endpoints', async org => {
    const provider = await getDb().provider.findUnique({ where: { orgId: org.id }, select: { id: true, endpoints: { select: { id: true, name: true, route: true, method: true, price: true, mode: true, active: true } } } });
    if (!provider) return null;
    const counts = await getDb().quote.groupBy({ by: ['endpointId'], where: { endpoint: { providerId: provider.id }, payment: { submittedAt: { gte: day() } } }, _count: { _all: true } });
    return { rateCents: exchangeRateCents(), endpoints: provider.endpoints.map(e => ({ ...e, price: e.price.toString(), callsToday: counts.find(c => c.endpointId === e.id)?._count._all ?? 0 })) };
  });
}
export async function loadProviderHome(options: Options = {}) {
  return load('provider', 'dashboard.provider.home', async org => {
    const [provider, history, rows, failures] = await Promise.all([
      getDb().provider.findUnique({ where: { orgId: org.id }, select: providerSelect }),
      calls({ quote: { endpoint: { provider: { orgId: org.id } } } }, options),
      summary(org.id, 'provider'),
      getDb().$queryRaw<{ check: string; count: number }[]>(Prisma.sql`
        SELECT reason->>'check' AS check, COUNT(*)::int AS count
        FROM payments p JOIN quotes q ON q.id = p.quote_id JOIN endpoints e ON e.id = q.endpoint_id
        JOIN providers pr ON pr.id = e.provider_id JOIN verifications v ON v.quote_id = q.id
        CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(v.reasons) = 'array' THEN v.reasons ELSE '[]'::jsonb END) reason
        WHERE pr.org_id = ${org.id} AND p.submitted_at >= ${new Date(Date.now() - 7 * 86_400_000)}
          AND reason->'ok' = 'false'::jsonb AND jsonb_typeof(reason->'check') = 'string'
        GROUP BY reason->>'check'`),
    ]);
    if (!provider) return null;
    const t = totals(rows); const hourly = Array.from({ length: 24 }, (_, hour) => rows.filter(r => r.status === 'paid' && r.hour <= hour).reduce((n, r) => n + BigInt(r.amount), 0n).toString());
    return { orgName: org.name, ...providerDto(provider), ...history,
      stats: { earnedToday: t.spentToday, paidCalls: t.paidCalls, notCharged: t.notChargedCount, verified: rows.filter(r => r.verification !== null).reduce((n, r) => n + r.count, 0), passed: rows.filter(r => r.verification === 'pass').reduce((n, r) => n + r.count, 0), hourly, failures } };
  });
}
export async function loadProviderEarnings(options: Options = {}) {
  return load('provider', 'dashboard.provider.earnings', async org => {
    const provider = await getDb().provider.findUnique({ where: { orgId: org.id }, select: { ...providerSelect, claims: { where: keyset(options.cursor, 'createdAt'), orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: PAGE_SIZE + 1, select: { id: true, amount: true, status: true, txHash: true, createdAt: true, claimedAt: true } } } });
    if (!provider) return null;
    const [earned, rows, pendingClaims] = await Promise.all([
      getDb().quote.aggregate({ where: { endpoint: { providerId: provider.id }, payment: { status: 'paid', confirmedAt: { not: null } } }, _sum: { amount: true } }),
      summary(org.id, 'provider'), getDb().claim.count({ where: { providerId: provider.id, status: 'pending' } }),
    ]);
    const customers = new Map<string, { id: string; name: string; agent: string; count: number; amountStroops: string }>();
    for (const row of rows.filter(r => r.status === 'paid')) {
      const c = customers.get(row.agentId) ?? { id: row.agentId, name: row.customer, agent: row.agent, count: 0, amountStroops: '0' };
      c.count += row.count; c.amountStroops = (BigInt(c.amountStroops) + BigInt(row.amount)).toString(); customers.set(row.agentId, c);
    }
    const history = page(provider.claims, c => c.createdAt);
    return { orgName: org.name, ...providerDto(provider), earnedStroops: (earned._sum.amount ?? 0n).toString(), customers: [...customers.values()], hasPendingClaim: pendingClaims > 0,
      nextCursor: history.nextCursor, claims: history.items.map(c => ({ id: c.id, amountStroops: c.amount.toString(), status: c.status, txHash: c.txHash, createdAt: c.createdAt.toISOString(), claimedAt: c.claimedAt?.toISOString() ?? null })) };
  });
}
function providers() { return getDb().provider.findMany({ select: { id: true, displayName: true }, orderBy: { displayName: 'asc' } }); }
export async function loadNewAgentForm() {
  return load('buyer', 'dashboard.buyer.new', async () => ({ providers: await providers(), rateCents: exchangeRateCents() }));
}
async function buyer(options: Options, id?: string) {
  return load('buyer', id ? 'dashboard.buyer.detail' : 'dashboard.buyer.home', async org => {
    const db = getDb();
    const term = options.q?.trim().slice(0, 200);
    const contains = { contains: term ?? '', mode: 'insensitive' as const };
    const where = { quote: { agent: { orgId: org.id }, ...(id ? { agentId: id } : {}) } };
    const [agents, history, approvals, registered, rows, matches] = await Promise.all([
      db.agent.findMany({ where: { ...(id ? { id } : {}), orgId: org.id }, orderBy: { createdAt: 'asc' },
        select: { id: true, name: true, status: true, agentPublic: true, deviceHash: true, cachedBalance: true, balanceUpdatedAt: true,
          policy: { select: { maxAmount: true, dailyBudget: true, autoApproveUpTo: true, expiresAt: true, allowlist: true } },
          topups: { ...(id ? { where: keyset(options.topupCursor, 'createdAt') } : {}), orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: id ? PAGE_SIZE + 1 : 0, select: { id: true, amount: true, status: true, fundTxHash: true, createdAt: true } },
          reservations: { where: { status: 'held' }, select: { amount: true } } } }),
      calls(where, options),
      db.approval.findMany({ where: { agent: { orgId: org.id }, ...(id ? { agentId: id } : {}), status: 'pending', expiresAt: { gt: new Date() } }, select: { id: true, agentId: true, amount: true, expiresAt: true, provider: { select: { displayName: true } } } }),
      id ? providers() : Promise.resolve([]), summary(org.id, 'buyer', id),
      term ? db.agent.findMany({ where: { orgId: org.id, OR: [{ id: contains }, { name: contains }, { agentPublic: contains }, { quotes: { some: { payment: search(term) } } }] }, select: { id: true } }) : Promise.resolve(null),
    ]);
    const stats = totals(rows);
    return { orgName: org.name, walletPublic: org.walletPublic, rateCents: exchangeRateCents(), providers: registered, ...history, stats,
      matchingAgentIds: matches?.map(a => a.id) ?? null,
      approvals: approvals.map(a => ({ id: a.id, agentId: a.agentId, amountStroops: a.amount.toString(), provider: a.provider.displayName, expiresAt: a.expiresAt.toISOString() })),
      agents: agents.map(a => {
        const topups = page(a.topups, t => t.createdAt);
        return { id: a.id, name: a.name, status: a.status, agentPublic: a.agentPublic, deviceHash: a.deviceHash,
          spentToday: rows.filter(r => r.agentId === a.id && r.status === 'paid').reduce((n, r) => n + BigInt(r.amount), 0n).toString(),
          balance: snapshotBalance({ amount: a.cachedBalance, asOf: a.balanceUpdatedAt }),
          heldStroops: a.reservations.reduce((s, r) => s + r.amount, 0n).toString(),
          policy: a.policy ? { cap: a.policy.maxAmount.toString(), daily: a.policy.dailyBudget.toString(), auto: a.policy.autoApproveUpTo.toString(), expiresAt: a.policy.expiresAt.toISOString(), allowlist: a.policy.allowlist } : null,
          topupsNextCursor: topups.nextCursor,
          topups: topups.items.map(t => ({ id: t.id, amountStroops: t.amount.toString(), status: t.status, txHash: t.fundTxHash, createdAt: t.createdAt.toISOString() })) };
      }) };
  });
}
export function loadBuyerHome(options: Options = {}) { return buyer(options); }
export function loadBuyerAgentDetail(id: string, options: Options = {}) { return buyer(options, id); }
// Compatibility names for existing type consumers; pages use focused entrypoints.
export const loadBuyerDashboard = loadBuyerHome;
export const loadProviderDashboard = loadProviderHome;
/** Dashboard-only history reads; ownership is established by each route's session. */
export function loadCallHistory(orgId: string, role: Role, options: Options = {}, agentId?: string) {
  return calls(role === 'provider'
    ? { quote: { endpoint: { provider: { orgId } } } }
    : { quote: { agent: { orgId }, ...(agentId ? { agentId } : {}) } }, options);
}
export type BuyerDashboard = NonNullable<Awaited<ReturnType<typeof loadBuyerHome>>>;
export type ProviderDashboard = NonNullable<Awaited<ReturnType<typeof loadProviderEarnings>>>;
