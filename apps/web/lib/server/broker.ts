import { CheckResultSchema, CriteriaSchema, PaymentHeaderSchema, QuoteSchema, encodePaymentHeader } from "@settl/core";
import type { CheckResult, Criteria, Quote as WireQuote, Receipt } from "@settl/core";
import { runChecks } from "@settl/verifier";
import { createStellarClient, loadStellarConfig } from "@settl/stellar";
import type { NoirClient, TxResult } from "@settl/stellar";
import { Keypair } from "@stellar/stellar-sdk";
import type { Prisma, PrismaClient, Quote } from "../generated/prisma/client";
import { getDb } from "./db";
import { planEffects } from "./events";
import type { Effect, SettlEvent } from "./events";
import { nextNonce } from "./nonce";
import { decide } from "./policy";
import { decryptWalletSecret } from "./wallets";

export class BrokerError extends Error {
  constructor(public readonly status: number, public readonly code: string) { super(code); }
}

export interface CallParams {
  agentId: string; endpointId: string; input?: unknown; maxPricePhp?: string; approvalId?: string;
}
export interface QuoteParams {
  endpointId: string;
  agentHint?: { agentId?: string; agent?: string; deviceHash?: string };
}
export interface VerifyParams {
  proof: { quoteId: string; kind: "tx"; txHash: string };
  endpointId?: string;
}
export type CallResult =
  | { status: "blocked" | "declined"; reason: string }
  | { status: "not_charged"; reason: string; receipt?: Receipt; data?: unknown; effects?: Effect[] }
  | { status: "approval_required"; reason: string; approvalId: string }
  | { status: "pending"; reason: string; quoteId: string; txHash?: string }
  | { status: "paid"; receipt: Receipt; data: unknown; effects: Effect[]; providerError?: string };
export type VerifyResult = { ok: true; receipt: Receipt } | { ok: false; error: string };

interface BrokerOptions {
  db: PrismaClient;
  chain: Pick<NoirClient, "authorize" | "readAuthorizeTx" | "pendingBalance" | "balanceOf">;
  escrowContract: string;
  phpPerXlm?: number;
  now?: () => Date;
  fetch?: typeof fetch;
  evaluate?: (criteria: Criteria, result: unknown) => CheckResult[];
}

export interface OutcomeIdentity { quoteId: string; endpointId: string; reservationId?: string }
export interface OutcomeParams extends OutcomeIdentity { result: unknown }
export type OutcomeResult =
  | { verification: "pass" | "fail" | "error"; receipt: Receipt; error?: string; effects?: Effect[] }
  | { verification: "pending"; quoteId: string; error: string };
type InspectResult = { ok: true; quoteId: string; reservationId: string } | { ok: false; error: string };

type Tx = Prisma.TransactionClient;
type AgentWithPolicy = Prisma.AgentGetPayload<{ include: { policy: true; settings: true } }>;
type EndpointWithProvider = Prisma.EndpointGetPayload<{ include: { provider: { include: { settings: true } } } }>;
type FullQuote = Prisma.QuoteGetPayload<{ include: { agent: true; payment: true; endpoint: { include: { provider: true } } } }>;
const quoteInclude = { agent: true, payment: true, endpoint: { include: { provider: true } } } as const;
const outcomeInclude = {
  agent: { include: { policy: true, settings: true } }, payment: true, reservation: true, verification: true,
  endpoint: { include: { provider: { include: { settings: true } } } },
} as const;
type OutcomeQuote = Prisma.QuoteGetPayload<{ include: typeof outcomeInclude }>;
const PG_MAX = (1n << 63n) - 1n;

function dayStart(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
function receiptFor(quote: Quote, txHash: string): Receipt {
  return { quoteId: quote.id, status: "paid", amountStroops: quote.amount.toString(), txHash, checks: [] };
}
async function lockAgent(tx: Tx, agentId: string) {
  await tx.$queryRaw`SELECT * FROM "agents" WHERE id = ${agentId} FOR UPDATE`;
}
async function pendingPayment(tx: Tx, agentId: string) {
  return tx.payment.findFirst({ where: { status: "pending", quote: { agentId } } });
}
/** Commit the automation intent with its state change; cron performs network work. */
async function enqueueEvent(tx: Tx, eventId: string, event: SettlEvent, payload: Prisma.InputJsonValue, agent: { id: string; orgId: string }, provider: { id: string; orgId: string }) {
  await tx.webhookEvent.upsert({
    where: { source_eventId: { source: "settl", eventId } }, update: {},
    create: { source: "settl", eventId, verified: true, payload: {
      eventId, event, payload, agentId: agent.id, providerId: provider.id,
      orgIds: [...new Set([agent.orgId, provider.orgId])],
    } },
  });
}
async function context(tx: Tx, agentId: string, endpointId: string) {
  const agent = await tx.agent.findUnique({ where: { id: agentId }, include: { policy: true, settings: true } });
  const endpoint = await tx.endpoint.findUnique({ where: { id: endpointId }, include: { provider: { include: { settings: true } } } });
  if (!agent) throw new BrokerError(404, "agent_not_found");
  if (!endpoint || !endpoint.active) throw new BrokerError(404, "endpoint_not_found");
  if (!agent.policy) throw new BrokerError(409, "agent_policy_missing");
  if (endpoint.price <= 0n) throw new BrokerError(409, "invalid_endpoint_price");
  return { agent, endpoint, policy: agent.policy };
}
function providerRequest(endpoint: EndpointWithProvider, input: unknown) {
  if (!endpoint.url) return null;
  let url: URL;
  try { url = new URL(endpoint.url); } catch { throw new BrokerError(409, "invalid_endpoint_url"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new BrokerError(409, "invalid_endpoint_url");
  if (endpoint.method !== "POST") throw new BrokerError(409, "unsupported_endpoint_method");
  let body: string;
  try { body = JSON.stringify(input ?? {}); } catch { throw new BrokerError(400, "invalid_call_input"); }
  return { url: endpoint.url, body };
}

/** Dependency injection keeps policy/locking/recovery tests offline. */
export function createBroker(options: BrokerOptions) {
  const { db, chain } = options;
  const now = options.now ?? (() => new Date());
  const fetcher = options.fetch ?? globalThis.fetch;
  const rate = options.phpPerXlm ?? Number(process.env.PHP_PER_XLM ?? "15");
  if (!Number.isFinite(rate) || rate < 0.01 || !Number.isSafeInteger(Math.round(rate * 100)) || Number(rate.toFixed(2)) !== rate) {
    throw new BrokerError(503, "invalid_exchange_rate");
  }
  const rateCents = BigInt(Math.round(rate * 100));
  function display(amount: bigint) {
    const cents = (amount * rateCents + 5_000_000n) / 10_000_000n;
    return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
  }
  function maximum(value: string | undefined, fallback: bigint) {
    if (value === undefined) return fallback;
    if (!/^\d{1,16}(\.\d{1,2})?$/.test(value)) throw new BrokerError(400, "invalid_max_price");
    const [whole, fraction = ""] = value.split(".");
    const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
    const stroops = (cents * 10_000_000n + rateCents - 1n) / rateCents;
    return stroops < fallback ? stroops : fallback;
  }
  async function allocate(tx: Tx, agent: AgentWithPolicy) {
    const nonce = nextNonce(agent.lastNonce);
    if (nonce > PG_MAX) throw new BrokerError(409, "nonce_exhausted");
    await tx.agent.update({ where: { id: agent.id }, data: { lastNonce: nonce } });
    return nonce;
  }
  async function issue(tx: Tx, agent: AgentWithPolicy, endpoint: EndpointWithProvider, at: Date) {
    // Validate the criteria before changing nonce state.
    const criteria = endpoint.mode === "outcome" ? CriteriaSchema.safeParse(endpoint.criteria) : null;
    if (criteria && !criteria.success) throw new BrokerError(409, "invalid_endpoint_criteria");
    return tx.quote.create({ data: {
      agentId: agent.id, endpointId: endpoint.id, nonce: await allocate(tx, agent), amount: endpoint.price,
      asset: agent.policy!.asset, merchant: endpoint.provider.merchantWallet, resource: `${endpoint.method} ${endpoint.route}`,
      mode: endpoint.mode, ...(criteria?.success ? { criteria: criteria.data } : {}),
      status: "issued", expiresAt: new Date(at.getTime() + 300_000),
    } });
  }
  function wireQuote(quote: Quote, endpoint: EndpointWithProvider): WireQuote {
    return QuoteSchema.parse({
      settl: "0.1", quoteId: quote.id, mode: quote.mode === "per_call" ? "per-call" : "outcome",
      network: "stellar:testnet", asset: quote.asset, amountStroops: quote.amount.toString(),
      displayPrice: { currency: "PHP", amount: display(quote.amount) }, merchant: quote.merchant,
      escrowContract: options.escrowContract, expiresAt: quote.expiresAt.toISOString(), resource: quote.resource,
      description: endpoint.name, ...(quote.criteria ? { criteria: quote.criteria } : {}),
    });
  }

  async function createQuote(params: QuoteParams): Promise<WireQuote> {
    const hint = params.agentHint;
    return db.$transaction(async (tx) => {
      const identity = hint?.agentId ? { id: hint.agentId } : hint?.agent ? { agentPublic: hint.agent }
        : hint?.deviceHash ? { deviceHash: hint.deviceHash } : { id: "bookkeeper" };
      const found = await tx.agent.findUnique({ where: identity });
      if (!found) throw new BrokerError(404, "agent_not_found");
      if (hint?.agent && hint.agent !== found.agentPublic || hint?.deviceHash && hint.deviceHash !== found.deviceHash) throw new BrokerError(400, "agent_hint_mismatch");
      await lockAgent(tx, found.id);
      const { agent, endpoint } = await context(tx, found.id, params.endpointId);
      if (await pendingPayment(tx, agent.id)) throw new BrokerError(409, "payment_pending");
      return wireQuote(await issue(tx, agent, endpoint, now()), endpoint);
    });
  }

  async function effectsFor(agent: AgentWithPolicy, endpoint: EndpointWithProvider): Promise<Effect[]> {
    // Execution/delivery of these planned automations belongs to the later worker phase.
    try {
      const subscriptions = await db.webhookEndpoint.findMany({ where: { active: true, orgId: { in: [agent.orgId, endpoint.provider.orgId] } } });
      const [balance, pending] = await Promise.all([chain.balanceOf(agent.deviceHash), chain.pendingBalance(endpoint.provider.merchantWallet)]);
      const settings = endpoint.provider.settings;
      return planEffects({ type: "payment.paid" }, {
        subscriptions,
        provider: { id: endpoint.provider.id, orgId: endpoint.provider.orgId, pending, autoClaimAt: settings?.autoClaimEnabled ? settings.autoClaimThreshold : null },
        agent: { id: agent.id, orgId: agent.orgId, balance, alertBelow: agent.settings?.lowBudgetAlert ?? null, alertedToday: !!agent.settings?.lastAlertAt && agent.settings.lastAlertAt >= dayStart(now()) },
      });
    } catch { return []; } // A failed observation cannot undo a confirmed payment.
  }

  function outcomeIdentityError(quote: OutcomeQuote | null, params: OutcomeIdentity): string | null {
    if (!quote) return "quote_not_found";
    if (quote.endpointId !== params.endpointId) return "endpoint_mismatch";
    const r = quote.reservation;
    if (quote.mode !== "outcome" || !r || r.quoteId !== quote.id || r.agentId !== quote.agentId || r.amount !== quote.amount || params.reservationId && r.id !== params.reservationId) return "reservation_mismatch";
    return null;
  }
  function holdError(quote: OutcomeQuote): string | null {
    if (quote.reservation!.status !== "held" || quote.status !== "issued" || quote.payment?.status !== "pending" || quote.payment.kind !== "commit") return "reservation_unavailable";
    if (quote.expiresAt <= now() || quote.reservation!.expiresAt <= now()) return "reservation_expired";
    if (quote.agent.status !== "active" || !quote.agent.policy || quote.agent.policy.expiresAt < now()) return "agent_inactive";
    return null;
  }
  function savedChecks(quote: OutcomeQuote): CheckResult[] {
    const saved = quote.verification?.reasons;
    const parsed = CheckResultSchema.array().safeParse(saved);
    return parsed.success ? parsed.data : [];
  }
  function outcomeReceipt(quote: OutcomeQuote, paid: boolean, checks: CheckResult[]): Receipt {
    return { quoteId: quote.id, status: paid ? "paid" : "not_charged", amountStroops: paid ? quote.amount.toString() : "0", ...(paid && quote.payment?.txHash ? { txHash: quote.payment.txHash } : {}), checks };
  }
  async function outcomeQuote(tx: Tx, params: OutcomeIdentity) {
    const found = await tx.quote.findUnique({ where: { id: params.quoteId }, include: outcomeInclude });
    if (!found) return null;
    await lockAgent(tx, found.agentId);
    return tx.quote.findUnique({ where: { id: params.quoteId }, include: outcomeInclude });
  }
  async function inspectOutcome(params: OutcomeIdentity): Promise<InspectResult> {
    return db.$transaction(async (tx): Promise<InspectResult> => {
      const quote = await outcomeQuote(tx, params);
      const identityError = outcomeIdentityError(quote, params);
      if (identityError || !quote) return { ok: false, error: identityError ?? "quote_not_found" };
      const error = holdError(quote);
      if (error) return { ok: false, error };
      if (quote.payment!.error) return { ok: false, error: "reservation_already_in_use" };
      // Only one provider invocation can claim a commitment. Settlement has its
      // own durable marker, since provider work and chain submission differ.
      await tx.payment.update({ where: { quoteId: quote.id }, data: { error: "provider_running" } });
      return { ok: true, quoteId: quote.id, reservationId: quote.reservation!.id };
    });
  }
  async function notChargedEffects(agent: AgentWithPolicy, endpoint: EndpointWithProvider, store: Pick<Tx, "webhookEndpoint"> = db): Promise<Effect[]> {
    try {
      const subscriptions = await store.webhookEndpoint.findMany({ where: { active: true, orgId: { in: [agent.orgId, endpoint.provider.orgId] } } });
      return planEffects({ type: "payment.not_charged" }, { subscriptions });
    } catch { return []; }
  }
  async function verifyOutcome(params: OutcomeParams): Promise<OutcomeResult> {
    type Claim = { quote: OutcomeQuote; checks: CheckResult[]; signer: Keypair };
    const claimed = await db.$transaction(async (tx): Promise<Claim | OutcomeResult> => {
      const quote = await outcomeQuote(tx, params);
      const identityError = outcomeIdentityError(quote, params);
      if (identityError || !quote) throw new BrokerError(identityError === "quote_not_found" ? 404 : 409, identityError ?? "quote_not_found");
      const checks = savedChecks(quote);
      if (quote.reservation!.status === "settled" && quote.payment?.status === "paid") return { verification: "pass", receipt: outcomeReceipt(quote, true, checks) };
      if (quote.reservation!.status === "released" && quote.payment?.status === "not_charged") return { verification: "fail", receipt: outcomeReceipt(quote, false, checks) };
      // An irreversible submission may already have happened. Its original
      // expiration is never permission to release or repeat that submission.
      if (quote.payment?.status === "pending" && (quote.payment.txHash || quote.payment.error && quote.payment.error !== "provider_running")) return { verification: "pending", quoteId: quote.id, error: "payment_pending" };
      const error = holdError(quote);
      if (error) throw new BrokerError(409, error);
      const criteria = CriteriaSchema.safeParse(quote.criteria);
      let evaluated: CheckResult[];
      let verificationState: "pass" | "fail" | "error" = "error";
      try {
        if (!criteria.success) throw new Error("Invalid criteria");
        if (options.evaluate) {
          evaluated = CheckResultSchema.array().parse(options.evaluate(criteria.data, params.result));
          verificationState = evaluated.every((check) => check.ok) ? "pass" : "fail";
        }
        else {
          const verified = runChecks(criteria.data, params.result, now());
          evaluated = CheckResultSchema.array().parse(verified.checks);
          verificationState = verified.result;
        }
        if (!evaluated.length) throw new Error("No verification checks");
        if (verificationState === "pass" && evaluated.some((check) => !check.ok)) verificationState = "fail";
        if (verificationState !== "pass" && evaluated.every((check) => check.ok)) evaluated.push({ check: "verification", ok: false, note: "The result could not be verified." });
      } catch { evaluated = [{ check: "verification", ok: false, note: "The result could not be verified." }]; verificationState = "error"; }
      await tx.verification.upsert({ where: { quoteId: quote.id }, update: { result: verificationState, reasons: evaluated, checkedAt: now() }, create: { quoteId: quote.id, result: verificationState, reasons: evaluated } });
      if (verificationState !== "pass") {
        await tx.reservation.update({ where: { quoteId: quote.id }, data: { status: "released", releaseReason: "checks_failed" } });
        await tx.payment.update({ where: { quoteId: quote.id }, data: { status: "not_charged", error: "checks_failed" } });
        await tx.quote.update({ where: { id: quote.id }, data: { status: "failed" } });
        await enqueueEvent(tx, `payment:${quote.id}:not_charged`, "payment.not_charged", { quoteId: quote.id, status: "not_charged", amountStroops: "0", checks: evaluated }, quote.agent, quote.endpoint.provider);
        return { verification: "fail", receipt: outcomeReceipt(quote, false, evaluated), effects: await notChargedEffects(quote.agent, quote.endpoint, tx) };
      }
      let signer: Keypair;
      try { signer = Keypair.fromSecret(decryptWalletSecret(quote.agent.agentSecretEnc)); } catch { throw new BrokerError(503, "wallet_unavailable"); }
      if (signer.publicKey() !== quote.agent.agentPublic) throw new BrokerError(503, "wallet_identity_mismatch");
      await tx.payment.update({ where: { quoteId: quote.id }, data: { error: "verification_in_progress" } });
      return { quote, checks: evaluated, signer };
    });
    if ("verification" in claimed) return claimed;
    const { quote, checks, signer } = claimed;
    let result: TxResult;
    try { result = await chain.authorize(signer, { agent: quote.agent.agentPublic, deviceHash: quote.agent.deviceHash, merchant: quote.merchant, asset: quote.asset, amount: quote.amount, nonce: quote.nonce }); }
    catch {
      await db.payment.update({ where: { quoteId: quote.id }, data: { error: "submission_unknown" } });
      return { verification: "pending", quoteId: quote.id, error: "submission_unknown" };
    }
    await db.$transaction(async (tx) => {
      await lockAgent(tx, quote.agentId);
      await tx.payment.update({ where: { quoteId: quote.id }, data: {
        status: result.status === "SUCCESS" ? "paid" : result.status === "FAILED" ? "failed" : "pending",
        txHash: result.hash, innerHash: result.innerHash, transport: result.transport,
        sponsorshipError: result.sponsorshipError ?? null, error: result.error ?? (result.status === "PENDING" ? "payment_pending" : null),
        ...(result.recovery ? { recovery: { ...result.recovery } } : {}), confirmedAt: result.status === "SUCCESS" ? now() : null,
      } });
      if (result.status !== "PENDING") {
        await tx.reservation.update({ where: { quoteId: quote.id }, data: result.status === "SUCCESS" ? { status: "settled", txHash: result.hash } : { status: "released", releaseReason: result.error ?? "onchain_failed" } });
        await tx.quote.update({ where: { id: quote.id }, data: { status: result.status === "SUCCESS" ? "paid" : "failed" } });
        await enqueueEvent(tx, `payment:${quote.id}:${result.status === "SUCCESS" ? "paid" : "blocked"}`, result.status === "SUCCESS" ? "payment.paid" : "payment.blocked", { quoteId: quote.id, status: result.status === "SUCCESS" ? "paid" : "blocked", amountStroops: result.status === "SUCCESS" ? quote.amount.toString() : "0", txHash: result.hash }, quote.agent, quote.endpoint.provider);
      }
    });
    if (result.status === "PENDING") return { verification: "pending", quoteId: quote.id, error: result.error ?? "payment_pending" };
    if (result.status === "FAILED") return { verification: "error", receipt: outcomeReceipt(quote, false, [...checks, { check: "authorization", ok: false, note: "Authorization failed." }]), error: result.error ?? "onchain_failed" };
    return { verification: "pass", receipt: { ...receiptFor(quote, result.hash), checks }, effects: await effectsFor(quote.agent, quote.endpoint) };
  }

  async function executeCall(params: CallParams): Promise<CallResult> {
    type Prepared = { agent: AgentWithPolicy; endpoint: EndpointWithProvider; quote: Quote; signer: Keypair | null; request: ReturnType<typeof providerRequest>; reservationId?: string };
    const prepared = await db.$transaction(async (tx): Promise<Prepared | CallResult> => {
      await lockAgent(tx, params.agentId);
      const { agent, endpoint, policy } = await context(tx, params.agentId, params.endpointId);
      const pending = await pendingPayment(tx, agent.id);
      if (pending) return { status: "pending", reason: "payment_pending", quoteId: pending.quoteId, ...(pending.txHash ? { txHash: pending.txHash } : {}) };
      const at = now();
      const paid = await tx.quote.findMany({ where: { agentId: agent.id, payment: { status: "paid", confirmedAt: { gte: dayStart(at), lte: at } } }, select: { amount: true } });
      const held = await tx.reservation.aggregate({ where: { agentId: agent.id, status: "held", expiresAt: { gt: at } }, _sum: { amount: true } });
      const approval = params.approvalId ? await tx.approval.findUnique({ where: { id: params.approvalId }, include: { quote: true } }) : null;
      if (params.approvalId && (!approval || approval.agentId !== agent.id || approval.providerId !== endpoint.providerId || approval.quote.endpointId !== endpoint.id || approval.quote.agentId !== agent.id || approval.quote.amount !== endpoint.price || approval.amount !== endpoint.price || approval.quote.asset !== policy.asset || approval.quote.merchant !== endpoint.provider.merchantWallet || approval.quote.mode !== endpoint.mode)) {
        throw new BrokerError(400, "invalid_approval");
      }
      if (approval && approval.quote.status !== "issued") return { status: "declined", reason: "approval_already_used" };
      if (approval && (approval.expiresAt <= at || approval.quote.expiresAt <= at || approval.status === "expired")) return { status: "declined", reason: "approval_expired" };
      const decision = decide({
        agent: { status: agent.status === "active" ? "active" : "revoked", expiresAt: policy.expiresAt, allowlist: policy.allowlist },
        providerId: endpoint.providerId, price: endpoint.price, maxPrice: maximum(params.maxPricePhp, policy.maxPricePerCall),
        spentToday: paid.reduce((sum, q) => sum + q.amount, 0n), reservedNow: held._sum.amount ?? 0n,
        dailyBudget: policy.dailyBudget, autoApproveUpTo: policy.autoApproveUpTo,
        ...(approval ? { approval: { status: approval.status as "pending" | "approved" | "declined", providerId: approval.providerId, amount: approval.amount } } : {}), now: at,
      });
      if (decision.decision === "blocked" || decision.decision === "declined") return { status: decision.decision, reason: decision.reason };
      if (decision.decision === "approval_required") {
        if (approval) return { status: "approval_required", reason: decision.reason, approvalId: approval.id };
        const quote = await issue(tx, agent, endpoint, at);
        const created = await tx.approval.create({ data: { agentId: agent.id, providerId: endpoint.providerId, quoteId: quote.id, amount: quote.amount, expiresAt: quote.expiresAt, status: "pending" } });
        await enqueueEvent(tx, `approval:${created.id}:requested`, "approval.requested", { approvalId: created.id, quoteId: quote.id, amountStroops: quote.amount.toString(), expiresAt: quote.expiresAt.toISOString() }, agent, endpoint.provider);
        return { status: "approval_required", reason: decision.reason, approvalId: created.id };
      }
      const request = providerRequest(endpoint, params.input);
      if (endpoint.mode === "outcome" && !request) return { status: "not_charged", reason: "endpoint_unavailable" };
      let signer: Keypair | null = null;
      if (endpoint.mode === "per_call") {
        try { signer = Keypair.fromSecret(decryptWalletSecret(agent.agentSecretEnc)); }
        catch { throw new BrokerError(503, "wallet_unavailable"); }
        if (signer.publicKey() !== agent.agentPublic) throw new BrokerError(503, "wallet_identity_mismatch");
      }
      const quote = approval
        ? await tx.quote.update({ where: { id: approval.quoteId }, data: { nonce: await allocate(tx, agent) } })
        : await issue(tx, agent, endpoint, at);
      // Commit this marker before the irreversible network call. A crash/unknown
      // submission blocks all future authorizations until explicitly reconciled.
      let reservationId: string | undefined;
      if (endpoint.mode === "outcome") {
        const held = await tx.reservation.create({ data: { agentId: agent.id, quoteId: quote.id, amount: quote.amount, expiresAt: quote.expiresAt, status: "held" } });
        reservationId = held.id;
      }
      await tx.payment.create({ data: { quoteId: quote.id, kind: endpoint.mode === "outcome" ? "commit" : "tx", status: "pending" } });
      return { agent, endpoint, quote, signer, request, ...(reservationId ? { reservationId } : {}) };
    });
    if ("status" in prepared) return prepared;
    const { agent, endpoint, quote, signer, request } = prepared;
    if (prepared.reservationId && request) {
      let data: unknown = null;
      let providerError: string | undefined;
      try {
        const response = await fetcher(request.url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(125_000), headers: {
          "Content-Type": "application/json", "X-PAYMENT": encodePaymentHeader({ kind: "commit", quoteId: quote.id, reservationId: prepared.reservationId }),
        }, body: request.body });
        if (response.ok) data = await response.json(); else providerError = "provider_rejected";
      } catch { providerError = "provider_unavailable"; }
      const state = await db.$transaction(async (tx) => {
        await lockAgent(tx, agent.id);
        const found = await tx.quote.findUnique({ where: { id: quote.id }, include: outcomeInclude });
        if (!found?.reservation || !found.payment) throw new BrokerError(409, "reservation_unavailable");
        if (found.payment.status === "pending" && !found.payment.txHash && (!found.payment.error || found.payment.error === "provider_running")) {
          // A late result post will see this release under the same row lock
          // and cannot start an authorization after the caller has given up.
          const reason = providerError ?? "provider_not_verified";
          await tx.reservation.update({ where: { quoteId: quote.id }, data: { status: "released", releaseReason: reason } });
          await tx.payment.update({ where: { quoteId: quote.id }, data: { status: "not_charged", error: reason } });
          await tx.quote.update({ where: { id: quote.id }, data: { status: "failed" } });
          await enqueueEvent(tx, `payment:${quote.id}:not_charged`, "payment.not_charged", { quoteId: quote.id, status: "not_charged", amountStroops: "0", reason }, agent, endpoint.provider);
          return { ...found, reservation: { ...found.reservation, status: "released" as const, releaseReason: reason }, payment: { ...found.payment, status: "not_charged" as const, error: reason } };
        }
        return found;
      });
      if (state.reservation!.status === "settled" && state.payment!.status === "paid") return { status: "paid", receipt: outcomeReceipt(state, true, savedChecks(state)), data, effects: await effectsFor(agent, endpoint), ...(providerError ? { providerError } : {}) };
      if (state.payment!.status === "pending") return { status: "pending", quoteId: quote.id, reason: state.payment!.error ?? "payment_pending", ...(state.payment!.txHash ? { txHash: state.payment!.txHash } : {}) };
      return { status: "not_charged", reason: state.reservation!.releaseReason ?? state.payment!.error ?? "checks_failed", receipt: outcomeReceipt(state, false, savedChecks(state)), data, effects: await notChargedEffects(agent, endpoint) };
    }
    if (!signer) throw new BrokerError(409, "wallet_unavailable");
    let result: TxResult;
    try {
      result = await chain.authorize(signer, { agent: agent.agentPublic, deviceHash: agent.deviceHash, merchant: quote.merchant, asset: quote.asset, amount: quote.amount, nonce: quote.nonce });
    } catch {
      // Even a throw may follow a successful handoff; do not release this claim.
      await db.payment.updateMany({ where: { quoteId: quote.id, status: "pending" }, data: { error: "submission_unknown" } });
      return { status: "pending", quoteId: quote.id, reason: "submission_unknown" };
    }
    await db.$transaction(async (tx) => {
      await lockAgent(tx, agent.id);
      await tx.payment.updateMany({ where: { quoteId: quote.id, status: "pending" }, data: {
        status: result.status === "SUCCESS" ? "paid" : result.status === "FAILED" ? "failed" : "pending",
        txHash: result.hash, innerHash: result.innerHash, transport: result.transport,
        sponsorshipError: result.sponsorshipError ?? null,
        ...(result.recovery ? { recovery: { ...result.recovery } } : {}),
        error: result.error ?? null, confirmedAt: result.status === "SUCCESS" ? now() : null,
      } });
      if (result.status !== "PENDING") {
        await tx.quote.updateMany({ where: { id: quote.id, status: "issued" }, data: { status: result.status === "SUCCESS" ? "paid" : "failed" } });
        await enqueueEvent(tx, `payment:${quote.id}:${result.status === "SUCCESS" ? "paid" : "blocked"}`, result.status === "SUCCESS" ? "payment.paid" : "payment.blocked", { quoteId: quote.id, status: result.status === "SUCCESS" ? "paid" : "blocked", amountStroops: result.status === "SUCCESS" ? quote.amount.toString() : "0", txHash: result.hash }, agent, endpoint.provider);
      }
    });
    if (result.status === "PENDING") return { status: "pending", quoteId: quote.id, txHash: result.hash, reason: result.error ?? "payment_pending" };
    if (result.status === "FAILED") return { status: "blocked", reason: result.error ?? "onchain_failed" };
    const receipt = receiptFor(quote, result.hash);
    const effects = await effectsFor(agent, endpoint);
    if (!request) return { status: "paid", receipt, data: null, effects };
    try {
      const response = await fetcher(request.url, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
        headers: { "Content-Type": "application/json", "X-PAYMENT": encodePaymentHeader({ kind: "tx", quoteId: quote.id, txHash: result.hash }) }, body: request.body,
      });
      if (!response.ok) return { status: "paid", receipt, data: null, effects, providerError: "provider_rejected" };
      return { status: "paid", receipt, data: await response.json(), effects };
    } catch { return { status: "paid", receipt, data: null, effects, providerError: "provider_unavailable" }; }
  }

  async function verifyPayment(params: VerifyParams): Promise<VerifyResult> {
    const parsed = PaymentHeaderSchema.safeParse(params.proof);
    if (!parsed.success || parsed.data.kind !== "tx") return { ok: false, error: "invalid_payment_proof" };
    const proof = parsed.data;
    const initial = await db.quote.findUnique({ where: { id: proof.quoteId }, include: quoteInclude });
    if (!initial) return { ok: false, error: "quote_not_found" };
    return db.$transaction(async (tx): Promise<VerifyResult> => {
      await lockAgent(tx, initial.agentId);
      const quote: FullQuote | null = await tx.quote.findUnique({ where: { id: proof.quoteId }, include: quoteInclude });
      if (!quote) return { ok: false, error: "quote_not_found" };
      if (params.endpointId && quote.endpointId !== params.endpointId) return { ok: false, error: "endpoint_mismatch" };
      if (quote.status === "verified") return { ok: false, error: "quote_already_used" };
      if (quote.status === "failed" || quote.status === "expired") return { ok: false, error: "quote_not_payable" };
      if (quote.expiresAt <= now()) return { ok: false, error: "quote_expired" };
      if (quote.mode !== "per_call") return { ok: false, error: "outcome_not_supported" };
      const reused = await tx.payment.findFirst({ where: { quoteId: { not: quote.id }, OR: [{ txHash: proof.txHash }, { innerHash: proof.txHash }] } });
      if (reused) return { ok: false, error: "transaction_already_used" };
      if (quote.payment?.status === "failed") return { ok: false, error: "payment_failed" };
      const confirmed = quote.payment?.status === "paid";
      if (confirmed && quote.payment!.txHash !== proof.txHash && quote.payment!.innerHash !== proof.txHash) return { ok: false, error: "payment_hash_mismatch" };
      if (!confirmed) {
        let evidence: Awaited<ReturnType<NoirClient["readAuthorizeTx"]>>;
        try { evidence = await chain.readAuthorizeTx(proof.txHash); }
        catch { return { ok: false, error: "chain_observation_unavailable" }; }
        const a = evidence.args;
        if (!evidence.ok || !a || a.agent !== quote.agent.agentPublic || a.deviceHash !== quote.agent.deviceHash || a.merchant !== quote.merchant || a.asset !== quote.asset || a.amount !== quote.amount || a.nonce !== quote.nonce) {
          return { ok: false, error: "payment_mismatch" };
        }
        await tx.payment.upsert({ where: { quoteId: quote.id }, update: { status: "paid", txHash: proof.txHash, confirmedAt: now(), error: null }, create: { quoteId: quote.id, kind: "tx", status: "paid", txHash: proof.txHash, confirmedAt: now() } });
      }
      // Payment is confirmed first, then consumed once by the protected endpoint.
      await tx.quote.update({ where: { id: quote.id }, data: { status: "verified" } });
      await enqueueEvent(tx, `payment:${quote.id}:paid`, "payment.paid", { quoteId: quote.id, status: "paid", amountStroops: quote.amount.toString(), txHash: proof.txHash }, quote.agent, quote.endpoint.provider);
      return { ok: true, receipt: receiptFor(quote, proof.txHash) };
    }, { timeout: 45_000 });
  }

  return { executeCall, createQuote, verifyPayment, inspectOutcome, verifyOutcome };
}

let singleton: ReturnType<typeof createBroker> | undefined;
function broker() {
  if (!singleton) {
    const config = loadStellarConfig();
    const relayer = process.env.SETTL_RELAYER_SECRET || process.env.SETTL_TREASURY_SECRET;
    const clientOptions = relayer ? { relayer: Keypair.fromSecret(relayer) } : {};
    const reads = createStellarClient(config, clientOptions);
    singleton = createBroker({
      db: getDb(), escrowContract: config.contracts.paymentEscrow,
      chain: {
        // The committed DB marker owns submission/recovery across processes.
        // A fresh writer avoids retaining an in-memory pending guard after a
        // different process has verified and cleared that durable marker.
        authorize: (...args) => createStellarClient(config, clientOptions).authorize(...args),
        readAuthorizeTx: reads.readAuthorizeTx, balanceOf: reads.balanceOf, pendingBalance: reads.pendingBalance,
      },
    });
  }
  return singleton;
}
export function executeCall(params: CallParams) { return broker().executeCall(params); }
export function createQuote(params: QuoteParams) { return broker().createQuote(params); }
export function verifyPayment(params: VerifyParams) { return broker().verifyPayment(params); }
export function inspectOutcome(params: OutcomeIdentity) { return broker().inspectOutcome(params); }
export function verifyOutcome(params: OutcomeParams) { return broker().verifyOutcome(params); }
