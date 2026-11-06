import { createStellarClient, loadStellarConfig } from "@settl/stellar";
import type { NoirClient } from "@settl/stellar";
import type { Prisma, PrismaClient } from "../generated/prisma/client";
import { claimProvider as defaultClaimProvider } from "./claims";
import { getDb } from "./db";
import type { Effect, SettlEvent } from "./events";
import { planEffects } from "./events";
import { isObject } from "./api-auth";
import { decryptWalletSecret } from "./wallets";
import { HEADER_DELIVERY, HEADER_SIGNATURE, signWebhook } from "./webhooks";

export type DispatchParams = {
  eventId: string;
  event: SettlEvent;
  payload: Prisma.InputJsonValue;
  effects: Effect[];
  agentId?: string;
  providerId?: string;
};
export type DispatchSummary = { queued: number; delivered: number; failed: number; pending: number; claims: number; errors: number };
interface DispatcherOptions {
  db: PrismaClient;
  chain: Pick<NoirClient, "balanceOf">;
  claimProvider?: typeof defaultClaimProvider;
  decrypt?: (encrypted: string) => string;
  fetch?: typeof fetch;
  now?: () => Date;
}
// The Phase 8 brief requests three retries after the initial attempt.
const MAX_ATTEMPTS = 4;
const LEASE_MS = 60_000;
const EVENTS: SettlEvent[] = ["payment.paid", "payment.not_charged", "payment.blocked", "approval.requested", "approval.resolved", "budget.low", "topup.completed", "claim.completed"];
const empty = (): DispatchSummary => ({ queued: 0, delivered: 0, failed: 0, pending: 0, claims: 0, errors: 0 });
function dayStart(date: Date) { return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())); }

/** Durable at-least-once delivery: receivers deduplicate x-settl-delivery. */
export function createDispatcher(options: DispatcherOptions) {
  const { db, chain } = options;
  const now = options.now ?? (() => new Date());
  const decrypt = options.decrypt ?? decryptWalletSecret;
  const fetcher = options.fetch ?? globalThis.fetch;
  const claimProvider = options.claimProvider ?? defaultClaimProvider;

  async function enqueue(store: Pick<Prisma.TransactionClient, "webhookEndpoint" | "webhookDelivery">, eventId: string, event: SettlEvent, payload: Prisma.InputJsonValue, orgId: string) {
    const endpoints = await store.webhookEndpoint.findMany({ where: { orgId, active: true, events: { has: event } } });
    let count = 0;
    for (const endpoint of endpoints) {
      // Recheck explicit predicates so injectable stores cannot broaden tenancy.
      if (!endpoint.active || endpoint.orgId !== orgId || !endpoint.events.includes(event)) continue;
      await store.webhookDelivery.upsert({
        where: { webhookEndpointId_eventId: { webhookEndpointId: endpoint.id, eventId } }, update: {},
        create: { webhookEndpointId: endpoint.id, eventId, event, payload: { id: eventId, event, data: payload }, nextAttemptAt: now() },
      });
      count++;
    }
    return count;
  }

  async function flushDueDeliveries(): Promise<DispatchSummary> {
    const summary = empty();
    const at = now();
    // A process may have died during its final leased attempt. No fifth send.
    const exhausted = await db.webhookDelivery.updateMany({ where: { status: "pending", attempts: { gte: MAX_ATTEMPTS }, nextAttemptAt: { lte: at } }, data: { status: "failed", lastError: "delivery_attempts_exhausted" } });
    summary.failed += exhausted.count;
    const deliveries = await db.webhookDelivery.findMany({ where: { status: "pending", attempts: { lt: MAX_ATTEMPTS }, nextAttemptAt: { lte: at } }, include: { endpoint: true }, orderBy: { nextAttemptAt: "asc" }, take: 25 });
    for (const delivery of deliveries) {
      // Keep each invocation bounded. All remaining rows stay due for cron.
      if (now().getTime() - at.getTime() >= 20_000) break;
      const attempt = delivery.attempts + 1;
      const leased = await db.webhookDelivery.updateMany({ where: { id: delivery.id, status: "pending", attempts: delivery.attempts, nextAttemptAt: { lte: at } }, data: { attempts: { increment: 1 }, nextAttemptAt: new Date(now().getTime() + LEASE_MS) } });
      if (!leased.count) continue;
      let error = "delivery_failed";
      let delivered = false;
      const abort = new AbortController();
      const deadline = setTimeout(() => abort.abort(), 10_000);
      try {
        const endpoint = delivery.endpoint;
        if (!endpoint.active || !endpoint.events.includes(delivery.event)) throw new Error();
        const url = new URL(endpoint.url);
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
        const body = JSON.stringify(delivery.payload);
        const response = await fetcher(url.toString(), { method: "POST", redirect: "error", signal: abort.signal, headers: {
          "content-type": "application/json",
          [HEADER_DELIVERY]: delivery.id,
          [HEADER_SIGNATURE]: signWebhook(decrypt(endpoint.secretEnc), body, Math.floor(now().getTime() / 1000)),
        }, body });
        delivered = response.ok;
        error = `http_${response.status}`;
        // Do not buffer an untrusted response body. Cancel releases the stream.
        await response.body?.cancel();
      } catch { /* Persist safe codes only; network errors can contain credentials. */ }
      finally { clearTimeout(deadline); }
      const status = delivered ? "delivered" : attempt >= MAX_ATTEMPTS ? "failed" : "pending";
      await db.webhookDelivery.updateMany({ where: { id: delivery.id, status: "pending", attempts: attempt }, data: {
        status, lastError: delivered ? null : error,
        ...(delivered ? { deliveredAt: now() } : { nextAttemptAt: new Date(now().getTime() + 1_000 * 2 ** (attempt - 1)) }),
      } });
      if (status === "delivered") summary.delivered++;
      else if (status === "failed") summary.failed++;
      else summary.pending++;
    }
    return summary;
  }

  async function lowBudget(agentId: string) {
    return db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "agents" WHERE id = ${agentId} FOR UPDATE`;
      const agent = await tx.agent.findUnique({ where: { id: agentId }, include: { settings: true } });
      const at = now();
      if (!agent?.settings || agent.settings.lastAlertAt && agent.settings.lastAlertAt >= dayStart(at)) return 0;
      const balance = await chain.balanceOf(agent.deviceHash);
      if (balance >= agent.settings.lowBudgetAlert) return 0;
      // The daily marker and delivery rows commit together. A failed enqueue
      // rolls back the marker so a future payment can still emit the alert.
      const queued = await enqueue(tx, `budget:${agentId}:${at.toISOString().slice(0, 10)}`, "budget.low", { agentId, balanceStroops: balance.toString(), alertBelowStroops: agent.settings.lowBudgetAlert.toString() }, agent.orgId);
      await tx.agentSettings.update({ where: { agentId }, data: { lastAlertAt: at } });
      return queued;
    }, { timeout: 30_000 });
  }

  async function performEffects(params: DispatchParams, deliver: boolean): Promise<DispatchSummary> {
    const summary = empty();
    // Reject BigInt, circular objects, and non-JSON values before persistence.
    try { JSON.parse(JSON.stringify(params.payload)); } catch { summary.errors++; return summary; }
    const seen = new Set<string>();
    for (const effect of params.effects) {
      const key = JSON.stringify(effect);
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        if (effect.kind === "webhook") {
          // planEffects also emits a direct budget.low webhook. Only lowBudget
          // owns that event, after checking live balance and the daily marker.
          if (effect.event === "budget.low" && params.event !== "budget.low") continue;
          if (effect.event !== params.event) continue;
          summary.queued += await enqueue(db, params.eventId, params.event, params.payload, effect.orgId);
        } else if (effect.kind === "budget_low") summary.queued += await lowBudget(effect.agentId);
        else {
          const result = await claimProvider(effect.providerId);
          if (result.status === "failed") summary.errors++;
          else summary.claims++;
        }
      } catch { summary.errors++; }
    }
    if (deliver) try {
      const delivered = await flushDueDeliveries();
      summary.delivered += delivered.delivered; summary.failed += delivered.failed; summary.pending += delivered.pending;
    } catch { summary.errors++; }
    return summary;
  }
  function dispatchEffects(params: DispatchParams) { return performEffects(params, true); }

  async function flushAutomationEvents(eventId?: string): Promise<{ processed: number; errors: number }> {
    const summary = { processed: 0, errors: 0 };
    const intents = await db.webhookEvent.findMany({ where: { source: "settl", verified: true, processedAt: null, ...(eventId ? { eventId } : {}) }, orderBy: { receivedAt: "asc" }, take: 25 });
    for (const intent of intents) {
      try {
        const data = intent.payload;
        if (!isObject(data) || data.eventId !== intent.eventId || typeof data.event !== "string" || !EVENTS.includes(data.event as SettlEvent)
          || !Array.isArray(data.orgIds) || !data.orgIds.every((id) => typeof id === "string" && id.length > 0)
          || data.payload === undefined || data.payload === null
          || data.agentId !== undefined && typeof data.agentId !== "string"
          || data.providerId !== undefined && typeof data.providerId !== "string") {
          summary.errors++; continue;
        }
        const event = data.event as SettlEvent;
        const orgIds = data.orgIds as string[];
        const subscriptions = await db.webhookEndpoint.findMany({ where: { orgId: { in: orgIds }, active: true }, select: { orgId: true, events: true } });
        const effects = planEffects({ type: event }, { subscriptions: subscriptions.filter((subscription) => orgIds.includes(subscription.orgId)) });
        if (event === "payment.paid") {
          // These services enforce their own live settings/threshold checks.
          if (typeof data.providerId === "string") effects.push({ kind: "auto_claim", providerId: data.providerId });
          if (typeof data.agentId === "string") effects.push({ kind: "budget_low", agentId: data.agentId });
        }
        const result = await performEffects({ eventId: intent.eventId, event, payload: data.payload as Prisma.InputJsonValue, effects }, false);
        if (result.errors) { summary.errors++; continue; }
        const updated = await db.webhookEvent.updateMany({ where: { id: intent.id, source: "settl", verified: true, processedAt: null }, data: { processedAt: now() } });
        summary.processed += updated.count;
      } catch { summary.errors++; }
    }
    // Cron sends durable deliveries separately. Interactive callers can enqueue
    // intents without waiting for any third-party HTTP requests.
    return summary;
  }
  return { dispatchEffects, flushDueDeliveries, flushAutomationEvents };
}

let singleton: ReturnType<typeof createDispatcher> | undefined;
function dispatcher() {
  return singleton ??= createDispatcher({ db: getDb(), chain: createStellarClient(loadStellarConfig()) });
}
export function dispatchEffects(params: DispatchParams) { return dispatcher().dispatchEffects(params); }
export function flushDueDeliveries() { return dispatcher().flushDueDeliveries(); }
export function flushAutomationEvents(eventId?: string) { return dispatcher().flushAutomationEvents(eventId); }
