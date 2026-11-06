import { randomUUID } from "node:crypto";
import { Velo } from "@carts1024/velo-sdk";
import type { WebhookPaymentIntentData } from "@carts1024/velo-sdk";
import { fromStroops, toStroops } from "@settl/core";
import { createStellarClient, loadStellarConfig } from "@settl/stellar";
import type { NoirClient } from "@settl/stellar";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import type { Prisma, PrismaClient } from "../generated/prisma/client";
import { ApiError } from "./api-auth";
import { getDb } from "./db";

const MAX_STROOPS = 9_223_372_036_854_775_807n;
const HASH = /^[a-fA-F0-9]{64}$/;
export interface CreateTopupInput {
  orgId: string;
  agentId: string;
  amountStroops: unknown;
  /** Trusted request origin, never a return URL supplied in the JSON body. */
  origin: string;
}
interface VeloOptions {
  db: PrismaClient;
  velo: { checkout: Pick<Velo["checkout"], "sessions">; paymentIntents: Pick<Velo["paymentIntents"], "retrieve"> };
  treasury: Keypair;
  chain: Pick<NoirClient, "fundEscrow" | "balanceOf">;
  webhookSecret: string;
  now?: () => Date;
  newId?: () => string;
}
export interface PaidTopupSummary {
  processed: number;
  completed: number;
  failed: number;
  pending: number;
  blocked: boolean;
}
function parseStroops(value: unknown): bigint {
  if (typeof value !== "string" || !/^[0-9]{1,19}$/.test(value)) throw new ApiError(400, "invalid_topup_amount");
  const amount = BigInt(value);
  if (amount <= 0n || amount > MAX_STROOPS) throw new ApiError(400, "invalid_topup_amount");
  return amount;
}
function decimalMatches(value: string, amount: bigint): boolean {
  try { return toStroops(value) === amount; } catch { return false; }
}
function httpUrl(value: unknown): string {
  if (typeof value !== "string") throw new Error("Missing URL");
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Invalid URL");
  return url.toString();
}
function validReceiver(value: unknown): value is string {
  return typeof value === "string" && StrKey.isValidEd25519PublicKey(value);
}

export function createVeloService(options: VeloOptions) {
  const { db, velo, treasury, chain } = options;
  const now = options.now ?? (() => new Date());
  const treasuryPublic = treasury.publicKey();
  const deliveryKey = (eventId: string) => ({ source_eventId: { source: "velo", eventId } });
  async function sourceLock(tx: Prisma.TransactionClient) {
    // One transaction source for every buyer and every process. This lock only
    // claims durable work; a committed funding marker protects the network gap.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${treasuryPublic}, 0))::text`;
  }

  async function createTopup(input: CreateTopupInput): Promise<{ checkoutUrl: string; sessionId: string }> {
    const amount = parseStroops(input.amountStroops);
    let origin: string;
    try { origin = new URL(httpUrl(input.origin)).origin; } catch { throw new ApiError(400, "invalid_topup_origin"); }
    const id = (options.newId ?? randomUUID)();
    const idempotencyKey = `checkout:${id}`;
    // The local operation exists even if Velo accepts the request and its
    // response or our following database write is lost. Recover with the SAME
    // key; never create another intent automatically for this operation.
    const agent = await db.$transaction(async (tx) => {
      // Lifecycle changes use this same row lock and reject pending top-ups.
      // Check eligibility and publish the checkout marker in one transaction.
      await tx.$queryRaw`SELECT id FROM "agents" WHERE id = ${input.agentId} AND org_id = ${input.orgId} FOR UPDATE`;
      const current = await tx.agent.findFirst({ where: { id: input.agentId, orgId: input.orgId }, select: { id: true, status: true } });
      if (!current) throw new ApiError(404, "agent_not_found");
      if (current.status !== "active") throw new ApiError(409, "agent_inactive");
      await tx.topup.create({ data: { id, agentId: current.id, amount, asset: "XLM", status: "pending", veloPaymentIntentId: `pending:${id}`,
        recovery: { phase: "checkout_pending", idempotencyKey, correlationId: idempotencyKey },
      } });
      return current;
    });
    try {
      const path = `/buyer/agents/${encodeURIComponent(agent.id)}`;
      const session = await velo.checkout.sessions.create({ amount: fromStroops(amount), asset: "XLM", anchor: "inhouse", description: "Settl agent escrow top-up",
        successUrl: `${origin}${path}?topup=success`, cancelUrl: `${origin}${path}?topup=cancelled`,
      }, { idempotencyKey, correlationId: idempotencyKey });
      if (!session.paymentIntentId?.trim()) throw new Error("Missing payment intent");
      // Preserve the known remote identity before validating its presentation.
      // A rejected URL must not orphan an already-created payment intent.
      await db.topup.update({ where: { id }, data: { veloPaymentIntentId: session.paymentIntentId,
        ...(validReceiver(session.receiverAddress) ? { receiverAddress: session.receiverAddress } : {}),
        recovery: { phase: "checkout_created", idempotencyKey, correlationId: idempotencyKey },
      } });
      if (session.asset !== "XLM" || !decimalMatches(session.amount, amount)) throw new Error("Mismatched checkout");
      const checkoutUrl = httpUrl(session.checkoutUrl);
      await db.topup.update({ where: { id }, data: { checkoutUrl } });
      return { checkoutUrl, sessionId: session.paymentIntentId };
    } catch { throw new ApiError(503, "checkout_unavailable"); }
  }

  function validatePayment(payment: WebhookPaymentIntentData, topup: { veloPaymentIntentId: string; amount: bigint; asset: string; receiverAddress: string | null }) {
    if (payment.id !== topup.veloPaymentIntentId || payment.asset !== "XLM" || topup.asset !== "XLM"
      || !decimalMatches(payment.amount, topup.amount)
      || (payment.receiverAddress !== undefined && topup.receiverAddress !== null && payment.receiverAddress !== topup.receiverAddress)) throw new ApiError(400, "velo_payment_mismatch");
  }

  async function handleVeloWebhook(input: { payload: string; signature: string | null; deliveryId: string | null }): Promise<{ received: true }> {
    if (!options.webhookSecret) throw new ApiError(503, "velo_webhook_unavailable");
    // SDK authenticates the untouched body before parsing its typed event.
    let event;
    try { event = await Velo.webhooks.verify({ payload: input.payload, signature: input.signature, secret: options.webhookSecret }); }
    catch { throw new ApiError(400, "invalid_velo_signature"); }
    const deliveryId = input.deliveryId;
    if (!deliveryId?.trim() || deliveryId.length > 256) throw new ApiError(400, "invalid_velo_delivery");
    await db.webhookEvent.upsert({ where: deliveryKey(deliveryId), update: {}, create: {
      source: "velo", eventId: deliveryId, verified: true, payload: JSON.parse(input.payload) as Prisma.InputJsonValue,
    } });
    const storedDelivery = await db.webhookEvent.findUnique({ where: deliveryKey(deliveryId) });
    if (storedDelivery?.processedAt) return { received: true };
    if (event.type !== "payment.succeeded" && event.type !== "payment.failed") {
      await db.webhookEvent.update({ where: deliveryKey(deliveryId), data: { processedAt: now() } });
      return { received: true };
    }
    const payment = event.paymentIntent;
    const topup = await db.topup.findUnique({ where: { veloPaymentIntentId: payment.id }, include: { agent: true } });
    if (!topup) {
      // A webhook cannot choose a buyer, device or amount through metadata.
      await db.webhookEvent.update({ where: deliveryKey(deliveryId), data: { processedAt: now() } });
      return { received: true };
    }
    validatePayment(payment, topup);
    if (event.type === "payment.succeeded" && topup.status !== "completed" && topup.status !== "funding" && topup.status !== "failed") {
      if (payment.status !== "paid" || typeof payment.txHash !== "string" || !HASH.test(payment.txHash) || !validReceiver(payment.receiverAddress)) throw new ApiError(400, "velo_payment_mismatch");
      let remote;
      try { remote = await velo.paymentIntents.retrieve(topup.veloPaymentIntentId); }
      catch { throw new ApiError(503, "velo_payment_unavailable"); }
      if (remote.status !== "paid" || remote.id !== topup.veloPaymentIntentId || remote.paymentIntentId !== topup.veloPaymentIntentId
        || remote.asset !== "XLM" || !decimalMatches(remote.amount, topup.amount)
        || remote.receiverAddress !== payment.receiverAddress
        || (topup.receiverAddress !== null && remote.receiverAddress !== topup.receiverAddress)) throw new ApiError(400, "velo_payment_mismatch");
    } else if (event.type === "payment.failed" && payment.status !== "failed") throw new ApiError(400, "velo_payment_mismatch");
    await db.$transaction(async (tx) => {
      await sourceLock(tx);
      const current = await tx.topup.findUnique({ where: { id: topup.id } });
      if (!current) throw new ApiError(404, "topup_not_found");
      // Funding/completed/failed records are terminal for webhook mutation.
      // A failure after submission can never overwrite a known/unknown fund.
      if (current.status === "pending" || current.status === "paid") {
        if (event.type === "payment.failed") await tx.topup.update({ where: { id: current.id }, data: { status: "failed" } });
        else await tx.topup.update({ where: { id: current.id }, data: { status: "paid", paymentTxHash: payment.txHash!.toLowerCase(), receiverAddress: payment.receiverAddress! } });
      }
      await tx.webhookEvent.update({ where: deliveryKey(deliveryId), data: { processedAt: now() } });
    });
    // Paid jobs survive the HTTP acknowledgment and can also be drained by the
    // protected cron. No retry of an unresolved submission is attempted here.
    if (event.type === "payment.succeeded") await processPaidTopups();
    return { received: true };
  }

  async function processPaidTopups(limit = 10): Promise<PaidTopupSummary> {
    const summary: PaidTopupSummary = { processed: 0, completed: 0, failed: 0, pending: 0, blocked: false };
    const bound = Number.isFinite(limit) ? Math.max(1, Math.min(25, Math.floor(limit))) : 10;
    for (let i = 0; i < bound; i++) {
      const prepared = await db.$transaction(async (tx) => {
        await sourceLock(tx);
        // Conservative across key rotation as well: an old unresolved funding
        // record requires operator reconciliation before using another source.
        const unresolved = await tx.topup.findFirst({ where: { status: "funding" }, select: { id: true } });
        if (unresolved) return { blocked: true as const };
        const topup = await tx.topup.findFirst({ where: { status: "paid" }, include: { agent: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
        if (!topup) return { empty: true as const };
        // Serialize the paid -> funding claim with revoke and policy changes.
        // Re-read after the lock rather than trusting the earlier relation.
        await tx.$queryRaw`SELECT id FROM "agents" WHERE id = ${topup.agentId} FOR UPDATE`;
        const currentAgent = await tx.agent.findUnique({ where: { id: topup.agentId } });
        if (!currentAgent || currentAgent.status !== "active") {
          await tx.topup.update({ where: { id: topup.id }, data: { status: "failed", recovery: {
            phase: "funding_blocked", reason: "agent_inactive", agentStatus: currentAgent?.status ?? "missing", treasuryPublic,
          } } });
          return { inactive: true as const };
        }
        await tx.topup.update({ where: { id: topup.id }, data: { status: "funding", recovery: {
          phase: "funding_started", treasuryPublic, startedAt: now().toISOString(),
        } } });
        return { topup: { ...topup, agent: currentAgent } };
      });
      if ("blocked" in prepared) { summary.blocked = true; break; }
      if ("empty" in prepared) break;
      if ("inactive" in prepared) { summary.processed++; summary.failed++; continue; }
      const { topup } = prepared;
      summary.processed++;
      let observedResult: { hash: string; recovery: Prisma.InputJsonObject } | undefined;
      try {
        const result = await chain.fundEscrow(treasury, topup.agent.deviceHash, topup.amount);
        const hash = result.hash || result.innerHash;
        // A claimed success without a usable ledger identity still needs
        // reconciliation; never release its durable source marker.
        const status = result.status === "SUCCESS" && HASH.test(hash) ? "completed" : result.status === "FAILED" ? "failed" : "funding";
        const recovery: Prisma.InputJsonObject = { phase: status === "funding" ? "funding_unresolved" : `funding_${status}`, treasuryPublic,
          observedStatus: result.status,
          ...(result.recovery ? { requestId: result.recovery.requestId, transactionHash: result.recovery.transactionHash } : {}),
          ...(result.innerHash ? { innerHash: result.innerHash } : {}), transport: result.transport,
          ...(result.sponsorshipError ? { sponsorshipError: result.sponsorshipError } : {}),
        };
        observedResult = { hash, recovery };
        let observed: { cachedBalance: bigint; balanceUpdatedAt: Date } | undefined;
        if (status === "completed") {
          try {
            const balance = await chain.balanceOf(topup.agent.deviceHash);
            if (balance >= 0n && balance <= MAX_STROOPS) observed = { cachedBalance: balance, balanceUpdatedAt: now() };
          } catch { /* Preserve the earlier observed cache if this read fails. */ }
        }
        await db.$transaction(async (tx) => {
          await sourceLock(tx);
          await tx.topup.update({ where: { id: topup.id }, data: { status, recovery,
            ...(HASH.test(hash) ? { fundTxHash: hash.toLowerCase() } : {}), ...(status === "completed" ? { completedAt: now() } : {}),
          } });
          if (status === "completed") {
            if (observed) await tx.agent.update({ where: { id: topup.agentId }, data: observed });
            const eventId = `topup:${topup.id}:completed`;
            await tx.webhookEvent.upsert({ where: { source_eventId: { source: "settl", eventId } }, update: {}, create: {
              source: "settl", eventId, verified: true,
              payload: { eventId, event: "topup.completed", agentId: topup.agentId, orgIds: [topup.agent.orgId], payload: {
                topupId: topup.id, agentId: topup.agentId, amountStroops: topup.amount.toString(), asset: topup.asset, txHash: hash.toLowerCase(),
              } },
            } });
          }
        });
        if (status === "completed") summary.completed++;
        else if (status === "failed") summary.failed++;
        else { summary.pending++; summary.blocked = true; break; }
      } catch {
        // The committed marker remains authoritative after network errors or
        // failed result persistence. Inspect the ledger before resolving it.
        // If a result was returned, retain its identity in a separate attempt
        // without marking it completed outside the atomic outbox transaction.
        if (observedResult) {
          const known = observedResult;
          try {
            await db.$transaction(async (tx) => {
              await sourceLock(tx);
              const current = await tx.topup.findUnique({ where: { id: topup.id } });
              if (current?.status === "funding") await tx.topup.update({ where: { id: topup.id }, data: {
                recovery: { ...known.recovery, phase: "funding_persistence_unresolved" },
                ...(HASH.test(known.hash) ? { fundTxHash: known.hash.toLowerCase() } : {}),
              } });
            });
          } catch { /* The original durable funding marker still blocks writes. */ }
        }
        summary.pending++; summary.blocked = true; break;
      }
    }
    return summary;
  }
  return { createTopup, handleVeloWebhook, processPaidTopups };
}

let singleton: ReturnType<typeof createVeloService> | undefined;
function service() {
  if (!singleton) {
    const apiKey = process.env.VELO_API_KEY?.trim();
    const treasurySecret = process.env.SETTL_TREASURY_SECRET?.trim();
    if (!apiKey || !treasurySecret) throw new ApiError(503, "velo_unavailable");
    const treasury = Keypair.fromSecret(treasurySecret);
    const relayer = process.env.SETTL_RELAYER_SECRET?.trim() || treasurySecret;
    const config = loadStellarConfig();
    const clientOptions = { relayer: Keypair.fromSecret(relayer) };
    const reader = createStellarClient(config, clientOptions);
    singleton = createVeloService({ db: getDb(), velo: new Velo({ apiKey, environment: "testnet" }), treasury,
      webhookSecret: process.env.VELO_WEBHOOK_SECRET?.trim() ?? "",
      chain: { balanceOf: reader.balanceOf, fundEscrow: (...args) => createStellarClient(config, clientOptions).fundEscrow(...args) },
    });
  }
  return singleton;
}
export function createTopup(input: CreateTopupInput) { return service().createTopup(input); }
export function handleVeloWebhook(input: { payload: string; signature: string | null; deliveryId: string | null }) { return service().handleVeloWebhook(input); }
export function processPaidTopups(limit = 10) { return service().processPaidTopups(limit); }
