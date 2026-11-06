import { McpServer } from '@modelcontextprotocol/server';
import { CheckResultSchema, QuoteSchema } from '@settl/core';
import { createStellarClient, loadStellarConfig } from '@settl/stellar';
import * as z from 'zod/v4';
import { createQuote, executeCall } from './broker';
import { getDb } from './db';

const idSchema = z.string().trim().min(1).max(256);
const noArguments = z.strictObject({});
const phpLimitSchema = z.string().max(32).regex(/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/);
const stroopsPerXlm = 10_000_000n;
const verificationChecksSchema = CheckResultSchema.array();

function phpRateCents(): bigint {
  const rate = Number(process.env.PHP_PER_XLM ?? '15');
  if (!Number.isFinite(rate) || rate <= 0 || rate > Number.MAX_SAFE_INTEGER / 100 || Number(rate.toFixed(2)) !== rate) {
    throw new Error('Invalid PHP exchange rate configuration');
  }
  return BigInt(rate.toFixed(2).replace('.', ''));
}

function formatPhp(amount: bigint, rateCents: bigint): string {
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const cents = (absolute * rateCents + stroopsPerXlm / 2n) / stroopsPerXlm;
  return `${negative && cents !== 0n ? '-' : ''}${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}

function result(data: object, isError = false) {
  // Broker outcomes are JSON-safe already; keep the boundary safe for bigint and Date values too.
  const structuredContent = JSON.parse(JSON.stringify(data, (_key, value: unknown) =>
    typeof value === 'bigint' ? value.toString() : value,
  )) as Record<string, unknown>;
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(structuredContent) }],
    structuredContent,
    ...(isError ? { isError: true } : {}),
  };
}

async function safely(action: () => Promise<ReturnType<typeof result>>) {
  try {
    return await action();
  } catch {
    // Database, chain and provider errors may contain credentials or request internals.
    return result({ error: 'TOOL_FAILED' }, true);
  }
}

function nonnegative(amount: bigint): bigint {
  return amount > 0n ? amount : 0n;
}

/** Build one request's tools around an identity established by server-side authentication. */
export function createAgentMcpServer(agentId: string): McpServer {
  if (!agentId) throw new Error('Authenticated agent identity is required');
  const server = new McpServer({ name: 'settl', version: '1.0.0' });

  server.registerTool('settl_list_services', {
    description: 'List active paid services and their PHP display prices and exact XLM stroop amounts.',
    inputSchema: noArguments,
    annotations: { readOnlyHint: true, destructiveHint: false },
  }, async () => safely(async () => {
    const rate = phpRateCents();
    const endpoints = await getDb().endpoint.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      select: {
        id: true, name: true, providerId: true, price: true, mode: true,
        provider: { select: { displayName: true } },
      },
    });
    return result({ services: endpoints.map((endpoint) => ({
      id: endpoint.id, name: endpoint.name, providerId: endpoint.providerId,
      providerName: endpoint.provider.displayName, mode: endpoint.mode,
      displayPrice: { currency: 'PHP', amount: formatPhp(endpoint.price, rate) },
      amountStroops: endpoint.price.toString(),
    })) });
  }));

  server.registerTool('settl_get_budget', {
    description: 'Read your agent wallet balance, policy, confirmed UTC-day spending, active holds and pending unexpired approvals. Monetary limits are XLM stroops.',
    inputSchema: noArguments,
    annotations: { readOnlyHint: true, destructiveHint: false },
  }, async () => safely(async () => {
    const rate = phpRateCents();
    const db = getDb();
    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setUTCHours(0, 0, 0, 0);
    const [agent, payments, held, approvals] = await Promise.all([
      db.agent.findUnique({
        where: { id: agentId },
        select: {
          deviceHash: true,
          policy: { select: {
            asset: true, maxAmount: true, dailyBudget: true, maxPricePerCall: true,
            autoApproveUpTo: true, expiresAt: true, allowlist: true,
          } },
        },
      }),
      db.payment.findMany({
        where: { status: 'paid', confirmedAt: { gte: dayStart }, quote: { agentId } },
        select: { quote: { select: { amount: true } } },
      }),
      db.reservation.aggregate({
        where: { agentId, status: 'held', expiresAt: { gt: now } },
        _sum: { amount: true },
      }),
      db.approval.findMany({
        where: { agentId, status: 'pending', expiresAt: { gt: now } },
        orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
        select: { id: true, providerId: true, quoteId: true, amount: true, expiresAt: true },
      }),
    ]);
    if (!agent?.policy) return result({ error: 'AGENT_UNAVAILABLE' }, true);
    const balance = await createStellarClient(loadStellarConfig()).balanceOf(agent.deviceHash);
    const spentToday = payments.reduce((sum, payment) => sum + payment.quote.amount, 0n);
    const heldAmount = held._sum.amount ?? 0n;
    const { policy } = agent;
    return result({
      balanceStroops: balance.toString(), balancePhp: formatPhp(balance, rate),
      availableStroops: nonnegative(balance - heldAmount).toString(),
      spentTodayStroops: spentToday.toString(), spentTodayPhp: formatPhp(spentToday, rate),
      heldStroops: heldAmount.toString(),
      remainingDailyBudgetStroops: nonnegative(policy.dailyBudget - spentToday - heldAmount).toString(),
      openApprovals: approvals.length,
      pendingApprovals: approvals.map((approval) => ({
        id: approval.id, providerId: approval.providerId, quoteId: approval.quoteId,
        amountStroops: approval.amount.toString(), expiresAt: approval.expiresAt.toISOString(),
      })),
      policy: {
        asset: policy.asset, maxAmount: policy.maxAmount.toString(), dailyBudget: policy.dailyBudget.toString(),
        maxPricePerCall: policy.maxPricePerCall.toString(), autoApproveUpTo: policy.autoApproveUpTo.toString(),
        expiresAt: policy.expiresAt.toISOString(), allowlist: policy.allowlist,
      },
    });
  }));

  server.registerTool('settl_quote', {
    description: 'Create a price quote for a service as your authenticated agent. This does not execute or charge the call.',
    inputSchema: z.strictObject({ serviceId: idSchema }),
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, async ({ serviceId }) => safely(async () => result(QuoteSchema.parse(await createQuote({
    endpointId: serviceId, agentHint: { agentId },
  })))));

  server.registerTool('settl_call', {
    description: 'Execute a paid service using your authenticated agent policy. May require operator approval; retry with the returned approvalId once approved. maxPricePhp is a nonnegative PHP decimal string with at most two decimal places.',
    inputSchema: z.strictObject({
      serviceId: idSchema,
      input: z.json().optional(),
      maxPricePhp: phpLimitSchema.optional(),
      approvalId: idSchema.optional(),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  }, async ({ serviceId, input, maxPricePhp, approvalId }) => safely(async () => result(await executeCall({
    agentId, endpointId: serviceId,
    ...(input !== undefined ? { input } : {}),
    ...(maxPricePhp !== undefined ? { maxPricePhp } : {}),
    ...(approvalId !== undefined ? { approvalId } : {}),
  }))));

  server.registerTool('settl_check_approval', {
    description: 'Read an approval belonging to your authenticated agent, including its status and expiration.',
    inputSchema: z.strictObject({ approvalId: idSchema }),
    annotations: { readOnlyHint: true, destructiveHint: false },
  }, async ({ approvalId }) => safely(async () => {
    const approval = await getDb().approval.findFirst({
      where: { id: approvalId, agentId },
      select: { id: true, providerId: true, quoteId: true, amount: true, status: true, expiresAt: true },
    });
    if (!approval) return result({ error: 'APPROVAL_NOT_FOUND' }, true);
    return result({ approval: {
      id: approval.id, providerId: approval.providerId, quoteId: approval.quoteId,
      amountStroops: approval.amount.toString(), status: approval.status,
      expiresAt: approval.expiresAt.toISOString(),
    } });
  }));

  server.registerTool('settl_receipts', {
    description: 'List the most recent terminal payment receipts belonging to your authenticated agent, including uncharged outcome checks and blocked calls. Amounts show what was charged. limit defaults to 20 and must be between 1 and 100.',
    inputSchema: z.strictObject({ limit: z.number().int().min(1).max(100).default(20) }),
    annotations: { readOnlyHint: true, destructiveHint: false },
  }, async ({ limit }) => safely(async () => {
    const rate = phpRateCents();
    const payments = await getDb().payment.findMany({
      where: { status: { in: ['paid', 'not_charged', 'blocked', 'failed'] }, quote: { agentId } },
      take: limit,
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true, quoteId: true, status: true, txHash: true, confirmedAt: true, submittedAt: true,
        quote: { select: { endpointId: true, amount: true, verification: { select: { reasons: true } } } },
      },
    });
    return result({ receipts: payments.map((payment) => {
      const chargedAmount = payment.status === 'paid' ? payment.quote.amount : 0n;
      const checks = verificationChecksSchema.safeParse(payment.quote.verification?.reasons);
      return {
        id: payment.id, quoteId: payment.quoteId, serviceId: payment.quote.endpointId,
        status: payment.status === 'failed' ? 'blocked' : payment.status,
        amountStroops: chargedAmount.toString(),
        displayPrice: { currency: 'PHP', amount: formatPhp(chargedAmount, rate) },
        ...(payment.txHash !== null ? { txHash: payment.txHash } : {}),
        submittedAt: payment.submittedAt.toISOString(),
        confirmedAt: payment.confirmedAt?.toISOString() ?? null,
        ...(checks.success ? { checks: checks.data.map(({ check, ok, note }) => ({ check, ok, note })) } : {}),
      };
    }) });
  }));

  return server;
}
