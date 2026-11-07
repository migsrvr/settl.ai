// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client";
import { createDispatcher } from "./dispatcher";
import { verifyWebhook } from "./webhooks";
import * as timing from "./timing";

function setup() {
  let clock = new Date("2026-11-05T12:00:00Z");
  type Row = { id: string; webhookEndpointId: string; eventId: string; event: string; payload: object; status: string; attempts: number; nextAttemptAt: Date; endpoint: typeof endpoint; [key: string]: unknown };
  const endpoint = { id: "hook", orgId: "buyer", events: ["payment.paid", "budget.low"], active: true, url: "https://buyer.test/hook", secretEnc: "encrypted" };
  const endpoints = [endpoint];
  const rows: Row[] = [];
  const settings = { lowBudgetAlert: 10n, lastAlertAt: null as Date | null };
  const intents = [{ id: "intent", eventId: event.eventId, source: "settl", verified: true, processedAt: null as Date | null, payload: { ...event, orgIds: ["buyer"], effects: undefined } }];
  const tx = { $queryRaw: vi.fn().mockResolvedValue([]), webhookEndpoint: { findMany: vi.fn(async () => endpoints) }, webhookDelivery: {
    upsert: vi.fn(async ({ create }: { create: Omit<Row, "id" | "attempts" | "status" | "endpoint"> }) => { let row = rows.find((r) => r.eventId === create.eventId && r.webhookEndpointId === create.webhookEndpointId); if (!row) { row = { ...create, id: `d${rows.length}`, attempts: 0, status: "pending", endpoint: endpoints.find((e) => e.id === create.webhookEndpointId)! } as Row; rows.push(row); } return row; }),
    findMany: vi.fn(async () => rows.filter((r) => r.status === "pending" && r.nextAttemptAt <= clock).map((r) => ({ ...r }))),
    updateMany: vi.fn(async ({ where, data }: { where: { id?: string; status?: string; attempts?: number | { gte: number }; nextAttemptAt?: { lte: Date } }; data: Record<string, unknown> }) => {
      let count = 0;
      for (const r of rows) {
        if (where.id && r.id !== where.id || where.status && r.status !== where.status || typeof where.attempts === "number" && r.attempts !== where.attempts || typeof where.attempts === "object" && r.attempts < where.attempts.gte || where.nextAttemptAt && r.nextAttemptAt > where.nextAttemptAt.lte) continue;
        count++; Object.assign(r, data, typeof data.attempts === "object" ? { attempts: r.attempts + 1 } : {});
      } return { count };
    }),
  }, webhookEvent: { findMany: vi.fn(async () => intents.filter((row) => !row.processedAt)), updateMany: vi.fn(async ({ where, data }: { where: { id: string }; data: object }) => { const intent = intents.find((row) => row.id === where.id && !row.processedAt); if (!intent) return { count: 0 }; Object.assign(intent, data); return { count: 1 }; }) }, agent: { findUnique: vi.fn().mockImplementation(async () => ({ id: "a", orgId: "buyer", deviceHash: "device", settings })) }, agentSettings: { update: vi.fn(async ({ data }: { data: object }) => Object.assign(settings, data)) } };
  let queue = Promise.resolve();
  const db = { ...tx, $transaction: vi.fn((work: (transaction: typeof tx) => Promise<unknown>) => { const result = queue.then(() => work(tx)); queue = result.then(() => {}, () => {}); return result; }) };
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(null, { status: 204 }));
  const claim = vi.fn().mockResolvedValue({ status: "skipped" });
  const chain = { balanceOf: vi.fn().mockResolvedValue(1n) };
  const dispatcher = createDispatcher({ db: db as unknown as PrismaClient, chain, decrypt: () => "secret", fetch: fetcher, now: () => clock, claimProvider: claim });
  return { ...dispatcher, rows, tx, endpoint, endpoints, fetcher, claim, chain, settings, intents, advance: (milliseconds = 120_000) => { clock = new Date(clock.getTime() + milliseconds); } };
}
const event = { eventId: "payment:q:paid", event: "payment.paid" as const, payload: { amountStroops: "10" }, effects: [{ kind: "webhook" as const, orgId: "buyer", event: "payment.paid" as const }] };

describe("durable automation delivery", () => {
  it('records sanitized background timing without payloads or URLs', async () => {
    const tracker = { correlationId: 'safe', measure: vi.fn(async (_phase: string, run: () => Promise<unknown>) => run()), finish: vi.fn() };
    const spy = vi.spyOn(timing, 'createTimingTracker').mockReturnValue(tracker as ReturnType<typeof timing.createTimingTracker>);
    try {
      const s = setup(); await s.flushAutomationEvents(); await s.flushDueDeliveries();
      expect(spy).toHaveBeenCalledWith('background.automations'); expect(spy).toHaveBeenCalledWith('background.deliveries');
      expect(tracker.finish).toHaveBeenCalledWith('completed');
      expect(JSON.stringify(tracker.finish.mock.calls)).not.toMatch(/secret|https:|payload/);
    } finally { spy.mockRestore(); }
  });
  it("signs the exact body, uses a stable delivery ID and deduplicates repeated events", async () => {
    const s = setup(); await s.dispatchEffects(event); await s.dispatchEffects(event);
    expect(s.fetcher).toHaveBeenCalledTimes(1);
    const [, init] = s.fetcher.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(headers.get("x-settl-delivery")).toBe("d0");
    expect(verifyWebhook("secret", init!.body as string, headers.get("x-settl-signature")!, new Date("2026-11-05T12:00:00Z"))).toBe(true);
    expect(init?.redirect).toBe("error");
  });
  it("retries only due deliveries and stops after the initial attempt plus three retries", async () => {
    const s = setup(); s.fetcher.mockRejectedValue(new Error("secret network detail"));
    await s.dispatchEffects(event); await s.flushDueDeliveries();
    expect(s.fetcher).toHaveBeenCalledTimes(1);
    s.advance(); await s.flushDueDeliveries(); s.advance(); await s.flushDueDeliveries(); s.advance(); await s.flushDueDeliveries(); s.advance(); await s.flushDueDeliveries();
    expect(s.fetcher).toHaveBeenCalledTimes(4);
    expect(s.rows[0]).toMatchObject({ status: "failed", attempts: 4, lastError: "delivery_failed" });
  });
  it("queues one stable delivery per subscribed endpoint when organizations have several subscriptions", async () => {
    const s = setup(); s.endpoints.push({ ...s.endpoint, id: "hook-2", url: "https://buyer.test/other-hook" });
    await s.flushAutomationEvents(); await s.flushDueDeliveries();
    expect(s.rows).toHaveLength(2); expect(s.fetcher).toHaveBeenCalledTimes(2);
    expect(new Set(s.rows.map((row) => row.id)).size).toBe(2);
  });
  it("claims a due delivery with CAS so concurrent flushes cannot both send it", async () => {
    const s = setup(); s.fetcher.mockRejectedValueOnce(new Error()); await s.dispatchEffects(event); s.advance();
    await Promise.all([s.flushDueDeliveries(), s.flushDueDeliveries()]);
    expect(s.fetcher).toHaveBeenCalledTimes(2);
  });
  it("ignores inactive, unsubscribed and mismatched organization endpoints", async () => {
    const s = setup(); s.endpoint.active = false; await s.dispatchEffects(event);
    s.endpoint.active = true; s.endpoint.orgId = "other"; await s.dispatchEffects(event);
    s.endpoint.orgId = "buyer"; s.endpoint.events = []; await s.dispatchEffects(event);
    expect(s.fetcher).not.toHaveBeenCalled();
  });
  it("rejects credential URLs and never stores network secrets in errors", async () => {
    const s = setup(); s.endpoint.url = "https://user:password@buyer.test/hook";
    await s.dispatchEffects(event); expect(s.fetcher).not.toHaveBeenCalled();
    expect(JSON.stringify(s.rows)).not.toContain("network secret");
  });
  it("deduplicates low budget effects atomically per UTC day and uses the live balance", async () => {
    const s = setup(); const low = { ...event, effects: [{ kind: "budget_low" as const, agentId: "a" }, { kind: "webhook" as const, orgId: "buyer", event: "budget.low" as const }] };
    await Promise.all([s.dispatchEffects(low), s.dispatchEffects(low)]);
    expect(s.rows.filter((r) => r.event === "budget.low")).toHaveLength(1);
    expect(s.settings.lastAlertAt).toBeInstanceOf(Date);
    const high = setup(); high.chain.balanceOf.mockResolvedValue(20n); await high.dispatchEffects(low);
    expect(high.rows).toHaveLength(0);
  });
  it("invokes the claim service for auto-claim effects", async () => {
    const s = setup(); await s.dispatchEffects({ ...event, effects: [{ kind: "auto_claim", providerId: "p" }] });
    expect(s.claim).toHaveBeenCalledWith("p");
  });
  it("recovers an expired final lease without sending a fifth attempt", async () => {
    const s = setup(); s.fetcher.mockRejectedValueOnce(new Error()); await s.dispatchEffects(event);
    s.rows[0].attempts = 4; s.advance(); await s.flushDueDeliveries();
    expect(s.fetcher).toHaveBeenCalledTimes(1); expect(s.rows[0].status).toBe("failed");
  });
  it("allows another low-budget alert on a new UTC day", async () => {
    const s = setup(); const low = { ...event, effects: [{ kind: "budget_low" as const, agentId: "a" }] };
    await s.dispatchEffects(low); s.advance(86_400_000); await s.dispatchEffects(low);
    expect(s.rows.filter((r) => r.event === "budget.low")).toHaveLength(2);
  });
  it("drains committed automation intents and marks processed only after durable enqueue", async () => {
    const s = setup(); expect(await s.flushAutomationEvents()).toMatchObject({ processed: 1, errors: 0 });
    expect(s.rows).toHaveLength(1); expect(s.intents[0].processedAt).toBeInstanceOf(Date);
    expect(s.tx.webhookEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { source: "settl", verified: true, processedAt: null } }));
  });
  it("leaves the automation intent available when persistence fails", async () => {
    const s = setup(); s.tx.webhookDelivery.upsert.mockRejectedValueOnce(new Error("database secret"));
    expect(await s.flushAutomationEvents()).toMatchObject({ processed: 0, errors: 1 });
    expect(s.intents[0].processedAt).toBeNull();
  });
  it("does not allow an outbox subscription lookup to broaden intended organizations", async () => {
    const s = setup(); s.endpoint.orgId = "other"; await s.flushAutomationEvents();
    expect(s.rows).toHaveLength(0);
  });
  it("reads subscriptions once per outbox batch and preserves per-intent tenancy", async () => {
    const s = setup();
    s.endpoints.push({ ...s.endpoint, id: "seller-hook", orgId: "seller" });
    s.intents.push({ ...s.intents[0], id: "intent-2", eventId: "payment:q2:paid", payload: { ...s.intents[0].payload, eventId: "payment:q2:paid", orgIds: ["seller"] } });
    expect(await s.flushAutomationEvents()).toEqual({ processed: 2, errors: 0 });
    expect(s.tx.webhookEndpoint.findMany).toHaveBeenCalledTimes(1);
    expect(s.tx.webhookEndpoint.findMany).toHaveBeenCalledWith({ where: { orgId: { in: ["buyer", "seller"] }, active: true }, select: { id: true, orgId: true, active: true, events: true } });
    expect(s.rows.map((row) => [row.eventId, row.webhookEndpointId])).toEqual([[event.eventId, "hook"], ["payment:q2:paid", "seller-hook"]]);
  });
  it("refreshes subscriptions on each batch and excludes inactive cached rows", async () => {
    const s = setup();
    await s.flushAutomationEvents();
    s.endpoint.active = false;
    s.intents.push({ ...s.intents[0], id: "intent-2", processedAt: null, eventId: "payment:q2:paid", payload: { ...s.intents[0].payload, eventId: "payment:q2:paid" } });
    expect(await s.flushAutomationEvents()).toEqual({ processed: 1, errors: 0 });
    expect(s.tx.webhookEndpoint.findMany).toHaveBeenCalledTimes(2);
    expect(s.rows).toHaveLength(1);
  });
  it("leaves every intent retryable if the shared subscription lookup fails", async () => {
    const s = setup();
    s.intents.push({ ...s.intents[0], id: "intent-2", eventId: "payment:q2:paid", payload: { ...s.intents[0].payload, eventId: "payment:q2:paid" } });
    s.tx.webhookEndpoint.findMany.mockRejectedValueOnce(new Error("database secret"));
    expect(await s.flushAutomationEvents()).toEqual({ processed: 0, errors: 2 });
    expect(s.intents.every((intent) => intent.processedAt === null)).toBe(true);
    expect(s.rows).toHaveLength(0);
  });
  it("keeps financial effects in intent order and reads low-budget subscriptions in its transaction", async () => {
    const s = setup();
    Object.assign(s.intents[0].payload, { providerId: "p1", agentId: "a" });
    s.intents.push({ ...s.intents[0], id: "intent-2", eventId: "payment:q2:paid", payload: { ...s.intents[0].payload, eventId: "payment:q2:paid" } });
    Object.assign(s.intents[1].payload, { providerId: "p2" });
    const order: string[] = [];
    let release!: () => void;
    s.claim.mockImplementation(async (id: string) => { order.push(`claim:${id}`); if (id === "p1") await new Promise<void>((resolve) => { release = resolve; }); return { status: "skipped" }; });
    s.chain.balanceOf.mockImplementation(async () => { order.push("balance"); return 1n; });
    const running = s.flushAutomationEvents();
    await vi.waitFor(() => expect(order).toEqual(["claim:p1"]));
    release();
    expect(await running).toEqual({ processed: 2, errors: 0 });
    expect(order).toEqual(["claim:p1", "balance", "claim:p2"]);
    expect(s.tx.webhookEndpoint.findMany).toHaveBeenCalledTimes(2);
    expect(s.tx.webhookEndpoint.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { orgId: "buyer", active: true, events: { has: "budget.low" } } }));
  });
  it("overlaps at most four webhook sends while concurrent flushes retain one lease per delivery", async () => {
    const s = setup();
    for (let id = 1; id < 9; id++) s.endpoints.push({ ...s.endpoint, id: `hook-${id}` });
    await s.flushAutomationEvents();
    const releases: (() => void)[] = [];
    let active = 0; let maximum = 0;
    s.fetcher.mockImplementation(async () => {
      active++; maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active--;
      return new Response(null, { status: 204 });
    });
    const first = s.flushDueDeliveries();
    await vi.waitFor(() => expect(s.fetcher).toHaveBeenCalledTimes(4));
    // The second batch can lease other rows, but cannot resend leased rows.
    const second = s.flushDueDeliveries();
    await vi.waitFor(() => expect(s.fetcher).toHaveBeenCalledTimes(8));
    expect(maximum).toBe(8); // Four workers per invocation, not a process-wide lock.
    releases.splice(0).forEach((release) => release());
    await vi.waitFor(() => expect(s.fetcher).toHaveBeenCalledTimes(9));
    releases.splice(0).forEach((release) => release());
    await Promise.all([first, second]);
    expect(s.rows.every((row) => row.status === "delivered" && row.attempts === 1)).toBe(true);
  });
  it("does not start more webhook sends after the batch time budget expires", async () => {
    const s = setup();
    for (let id = 1; id < 9; id++) s.endpoints.push({ ...s.endpoint, id: `hook-${id}` });
    await s.flushAutomationEvents();
    const releases: (() => void)[] = [];
    s.fetcher.mockImplementation(async () => { await new Promise<void>((resolve) => releases.push(resolve)); return new Response(null, { status: 204 }); });
    const running = s.flushDueDeliveries();
    await vi.waitFor(() => expect(s.fetcher).toHaveBeenCalledTimes(4));
    s.advance(20_000);
    releases.forEach((release) => release());
    expect(await running).toMatchObject({ delivered: 4 });
    expect(s.rows.filter((row) => row.attempts === 0)).toHaveLength(5);
  });
});
