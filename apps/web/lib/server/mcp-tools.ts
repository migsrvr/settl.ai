import { fromJsonSchema, McpServer } from '@modelcontextprotocol/server';
import { CheckResultSchema, QuoteSchema } from '@settl/core';
import * as z from 'zod/v4';
import { createQuote, executeCall } from './broker';
import { observeAgentBalanceById } from './balances';
import { getDb } from './db';
import { BUY_GUIDE } from './discovery';
import { describeCode, publicCallResult, toolError } from './mcp-errors';
import { toolNames, type CatalogEntry } from './service-catalog';

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
  } catch (error) {
    // Only allow-listed broker codes are named; database, chain and provider errors may contain
    // credentials or request internals and are reported as TOOL_FAILED.
    return result(toolError(error), true);
  }
}

function failure(code: string) {
  return result({ error: code, ...describeCode(code) }, true);
}

const receiptOutput = z.object({
  quoteId: z.string(), status: z.string(), amountStroops: z.string(), txHash: z.string().optional(),
  checks: z.array(z.object({ check: z.string(), ok: z.boolean(), note: z.string() })).optional(),
});
/** One object with a status enum: a union root would be wrapped for older MCP clients. */
export const callOutputSchema = z.object({
  status: z.enum(['paid', 'declined', 'blocked', 'approval_required', 'not_charged', 'pending']),
  reason: z.string().optional(),
  approvalId: z.string().optional(),
  quoteId: z.string().optional(),
  txHash: z.string().optional(),
  receipt: receiptOutput.optional(),
  data: z.json().optional(),
  providerError: z.string().optional(),
  issues: z.array(z.string()).optional().describe('Why the input did not match the service inputSchema.'),
  next: z.string().optional().describe('What to do next, in plain language.'),
});

function nonnegative(amount: bigint): bigint {
  return amount > 0n ? amount : 0n;
}

const MAX_SERVICE_TOOLS = 40;
const PESOS_PATTERN = String.raw`^(?:0|[1-9]\d*)(?:\.\d{1,2})?$`;
type PurchaseArgs = { input?: unknown; maxPricePhp?: string; approvalId?: string };

function serviceInputSchema(service: CatalogEntry, useDeclared: boolean) {
  const declared = useDeclared && service.inputSchema && typeof service.inputSchema === 'object' && !Array.isArray(service.inputSchema)
    ? service.inputSchema as Record<string, unknown> : undefined;
  const inputRequired = Array.isArray(declared?.required) && declared.required.length > 0;
  return fromJsonSchema<PurchaseArgs>({
    type: 'object',
    properties: {
      input: declared ?? { description: 'JSON input for the provider. settl_list_services shows its inputSchema and an example when the provider gave them.' },
      maxPricePhp: { type: 'string', maxLength: 32, pattern: PESOS_PATTERN, description: 'The most you will pay, in pesos, for example "10.00".' },
      approvalId: { type: 'string', minLength: 1, maxLength: 256, description: 'Resume a purchase a human has approved.' },
    },
    ...(inputRequired ? { required: ['input'] } : {}),
    additionalProperties: false,
  } as never);
}

export interface AgentMcpOptions {
  /** Active services, each exposed as its own typed tool next to the generic settl_call. */
  services?: CatalogEntry[];
  /** How often settl_wait_for_approval re-reads the approval. Default one second. */
  approvalPollMs?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const APPROVAL_NEXT: Record<string, string> = {
  approved: 'Approved. Call settl_call (or the service tool) again with this approvalId to complete the purchase.',
  declined: 'A human declined this purchase. Do not retry it without asking.',
  expired: 'The approval expired. Call settl_call again to request a new one.',
  pending: 'No decision yet. Call settl_wait_for_approval again, or resume later with this approvalId.',
};

/** Build one request's tools around an identity established by server-side authentication. */
export function createAgentMcpServer(agentId: string, options: AgentMcpOptions = {}): McpServer {
  if (!agentId) throw new Error('Authenticated agent identity is required');
  const server = new McpServer({ name: 'settl', version: '1.0.0' });

  // One purchase path for settl_call and every typed service tool.
  const purchase = (endpointId: string, { input, maxPricePhp, approvalId }: PurchaseArgs) => safely(async () => result(publicCallResult(await executeCall({
    agentId, endpointId,
    ...(input !== undefined ? { input } : {}),
    ...(maxPricePhp !== undefined ? { maxPricePhp } : {}),
    ...(approvalId !== undefined ? { approvalId } : {}),
  }))));

  server.registerTool('settl_list_services', {
    description: 'List active paid services with their PHP prices, exact XLM stroop amounts and, when the provider gave them, a description, the JSON Schema for `input` and an example input. Free to call.',
    inputSchema: noArguments,
    annotations: { readOnlyHint: true, destructiveHint: false },
  }, async () => safely(async () => {
    const rate = phpRateCents();
    const endpoints = await getDb().endpoint.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      select: {
        id: true, name: true, providerId: true, price: true, mode: true,
        description: true, inputSchema: true, example: true,
        provider: { select: { displayName: true } },
      },
    });
    return result({ services: endpoints.map((endpoint) => ({
      id: endpoint.id, name: endpoint.name, providerId: endpoint.providerId,
      providerName: endpoint.provider.displayName, mode: endpoint.mode,
      displayPrice: { currency: 'PHP', amount: formatPhp(endpoint.price, rate) },
      amountStroops: endpoint.price.toString(),
      // Present only when the provider described the service; agents send `input` matching inputSchema.
      ...(endpoint.description ? { description: endpoint.description } : {}),
      ...(endpoint.inputSchema !== null && endpoint.inputSchema !== undefined ? { inputSchema: endpoint.inputSchema } : {}),
      ...(endpoint.example !== null && endpoint.example !== undefined ? { example: endpoint.example } : {}),
    })) });
  }));

  server.registerTool('settl_get_budget', {
    description: 'Read your agent wallet balance (up to 15 seconds old, see balanceAsOf), policy, confirmed UTC-day spending, active holds and pending unexpired approvals. Monetary limits are XLM stroops. Free to call.',
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
          deviceHash: true, cachedBalance: true, balanceUpdatedAt: true,
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
    if (!agent?.policy) return failure('AGENT_UNAVAILABLE');
    const observed = await observeAgentBalanceById({
      id: agentId, deviceHash: agent.deviceHash, cachedBalance: agent.cachedBalance ?? null, balanceUpdatedAt: agent.balanceUpdatedAt ?? null,
    });
    if (observed.amountStroops === null) return failure('BALANCE_UNAVAILABLE');
    const balance = BigInt(observed.amountStroops);
    const spentToday = payments.reduce((sum, payment) => sum + payment.quote.amount, 0n);
    const heldAmount = held._sum.amount ?? 0n;
    const { policy } = agent;
    return result({
      balanceStroops: balance.toString(), balancePhp: formatPhp(balance, rate),
      // The balance may be up to 15 seconds old; spending and holds below are always current.
      balanceSource: observed.source, balanceAsOf: observed.asOf,
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
    outputSchema: callOutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  }, async ({ serviceId, ...args }) => purchase(serviceId, args));

  server.registerTool('settl_check_approval', {
    description: 'Read an approval belonging to your authenticated agent, including its status and expiration.',
    inputSchema: z.strictObject({ approvalId: idSchema }),
    annotations: { readOnlyHint: true, destructiveHint: false },
  }, async ({ approvalId }) => safely(async () => {
    const approval = await getDb().approval.findFirst({
      where: { id: approvalId, agentId },
      select: { id: true, providerId: true, quoteId: true, amount: true, status: true, expiresAt: true },
    });
    if (!approval) return failure('APPROVAL_NOT_FOUND');
    return result({ approval: {
      id: approval.id, providerId: approval.providerId, quoteId: approval.quoteId,
      amountStroops: approval.amount.toString(), status: approval.status,
      expiresAt: approval.expiresAt.toISOString(),
    } });
  }));

  server.registerTool('settl_wait_for_approval', {
    description: 'Wait for a human to approve or decline a purchase, up to timeoutSeconds (default 25, at most 55), and return the decision as soon as it is made. Read-only: it never pays. When approved, call settl_call or the service tool again with the approvalId.',
    inputSchema: z.strictObject({ approvalId: idSchema, timeoutSeconds: z.number().int().min(1).max(55).default(25) }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, async ({ approvalId, timeoutSeconds }) => safely(async () => {
    const pollMs = options.approvalPollMs ?? 1000;
    const deadline = Date.now() + timeoutSeconds * 1000;
    for (;;) {
      const approval = await getDb().approval.findFirst({
        where: { id: approvalId, agentId },
        select: { id: true, providerId: true, quoteId: true, amount: true, status: true, expiresAt: true },
      });
      if (!approval) return failure('APPROVAL_NOT_FOUND');
      // An approval past its expiry can still read "pending" until something updates it.
      const status = approval.status === 'pending' && approval.expiresAt <= new Date() ? 'expired' : approval.status;
      const remaining = deadline - Date.now();
      if (status !== 'pending' || remaining <= 0) {
        return result({
          decided: status !== 'pending',
          approval: {
            id: approval.id, providerId: approval.providerId, quoteId: approval.quoteId,
            amountStroops: approval.amount.toString(), status, expiresAt: approval.expiresAt.toISOString(),
          },
          next: APPROVAL_NEXT[status] ?? APPROVAL_NEXT.pending,
        });
      }
      await sleep(Math.min(pollMs, remaining));
    }
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

  registerServiceTools(server, options.services ?? [], purchase);
  registerGuidance(server, options.services ?? []);
  return server;
}

/** Resources and a prompt that tell an agent what it can buy and how to buy it safely. */
function registerGuidance(server: McpServer, services: CatalogEntry[]): void {
  server.registerResource('services', 'settl://services', {
    title: 'Settl services',
    description: 'The paid services you can buy, with prices, descriptions, input schemas, examples and the tool name for each.',
    mimeType: 'application/json',
  }, async (uri) => {
    let rate: bigint | undefined;
    try { rate = phpRateCents(); } catch { rate = undefined; }
    const names = toolNames(services.slice(0, MAX_SERVICE_TOOLS));
    const listed = services.map((service) => ({
      id: service.id, name: service.name, providerId: service.providerId, providerName: service.providerName, mode: service.mode,
      ...(names.has(service.id) ? { tool: names.get(service.id) } : {}),
      amountStroops: service.price.toString(),
      ...(rate !== undefined ? { displayPrice: { currency: 'PHP', amount: formatPhp(service.price, rate) } } : {}),
      ...(service.description ? { description: service.description } : {}),
      ...(service.inputSchema != null ? { inputSchema: service.inputSchema } : {}),
      ...(service.example != null ? { example: service.example } : {}),
    }));
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ services: listed }) }] };
  });

  server.registerResource('guide', 'settl://guide', {
    title: 'How to buy through Settl',
    description: 'The safe buying steps: discovery, price caps, input schemas, approvals and pending results.',
    mimeType: 'text/plain',
  }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/plain', text: BUY_GUIDE }] }));

  server.registerPrompt('buy_service', {
    title: 'Buy a service for a task',
    description: 'Start a task that may need a paid service, with the safe buying steps and a price cap.',
    argsSchema: z.object({
      task: z.string().min(1).max(2000).describe('What you need done.'),
      maxPricePhp: phpLimitSchema.optional().describe('The most to pay for one call, in pesos.'),
    }),
  }, ({ task, maxPricePhp }) => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `Task: ${task}\n\n`
          + (maxPricePhp ? `Never pay more than PHP ${maxPricePhp} for one call; pass it as maxPricePhp.\n\n` : 'Set maxPricePhp on every purchase.\n\n')
          + 'Start with settl_list_services and pick the service that fits.\n\n' + BUY_GUIDE,
      },
    }],
  }));
}

function registerServiceTools(
  server: McpServer,
  services: CatalogEntry[],
  purchase: (endpointId: string, args: PurchaseArgs) => ReturnType<typeof safely>,
): void {
  if (services.length === 0) return;
  let rate: bigint;
  try {
    rate = phpRateCents();
  } catch {
    return; // Without a valid exchange rate no price can be described; settl_call still reports the error.
  }
  const listed = services.slice(0, MAX_SERVICE_TOOLS);
  const names = toolNames(listed);
  for (const service of listed) {
    let inputSchema;
    try {
      inputSchema = serviceInputSchema(service, true);
    } catch {
      // A provider schema that no longer compiles must not hide the service: accept free-form input instead.
      try { inputSchema = serviceInputSchema(service, false); } catch { continue; }
    }
    const summary = (service.description ?? service.name).trim().replace(/[.\s]*$/, '');
    const billing = service.mode === 'outcome' ? ', charged only when the result passes the agreed checks' : '';
    server.registerTool(names.get(service.id)!, {
      title: service.name,
      description: `${summary}. Costs PHP ${formatPhp(service.price, rate)} per call${billing}. `
        + 'This spends from your budget: set maxPricePhp to the most you accept. If the result is approval_required, '
        + 'call settl_wait_for_approval with the approvalId, then call this tool again with it. Never repeat a pending call.',
      inputSchema,
      outputSchema: callOutputSchema,
      annotations: { title: service.name, readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    }, async (args: PurchaseArgs) => purchase(service.id, args));
  }
}
