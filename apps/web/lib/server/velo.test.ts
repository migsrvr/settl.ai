// @vitest-environment node
import { createHmac } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";
import type { PaymentIntent, WebhookPaymentEvent } from "@carts1024/velo-sdk";
import type { PrismaClient } from "../generated/prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVeloService } from "./velo";

const treasury = Keypair.random();
const receiver = Keypair.random().publicKey();
const paymentHash = "a".repeat(64);
const fundHash = "b".repeat(64);
const agent = { id: "agent", orgId: "buyer", status: "active", deviceHash: "c".repeat(64), cachedBalance: 90n, balanceUpdatedAt: null };
type Row = { id: string; agentId: string; amount: bigint; asset: string; status: string; veloPaymentIntentId: string; checkoutUrl: string | null; receiverAddress: string | null; paymentTxHash: string | null; fundTxHash: string | null; recovery: unknown; completedAt: Date | null; agent: typeof agent };
let rows: Row[];
let deliveries: Map<string, { processedAt?: Date; payload: unknown }>;
const checkout = vi.fn();
const retrieve = vi.fn();
const fundEscrow = vi.fn();
const balanceOf = vi.fn();
const db = {
  agent: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  topup: { create: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  webhookEvent: { upsert: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  $queryRaw: vi.fn(), $transaction: vi.fn(),
};
function intent(overrides: Partial<PaymentIntent> = {}): PaymentIntent {
  return { id: "pi", paymentIntentId: "pi", object: "payment_intent", amount: "1.0000000", asset: "XLM", status: "paid", receiverAddress: receiver, checkoutUrl: "https://checkout.velo.test/pi", description: null, successUrl: null, cancelUrl: null, createdAt: "2026-11-06", updatedAt: "2026-11-06", expiresAt: "2026-11-07", ...overrides };
}
function event(overrides: Partial<WebhookPaymentEvent["paymentIntent"]> = {}, type: WebhookPaymentEvent["type"] = "payment.succeeded"): WebhookPaymentEvent {
  return { version: "1", id: "evt", type, test: true, sentAt: new Date().toISOString(), project: { id: "project", registryProjectId: "registry", name: "Settl", slug: "settl" }, paymentIntent: { id: "pi", amount: "1.0000000", asset: "XLM", status: "paid", receiverAddress: receiver, merchantName: "Settl", description: null, txHash: paymentHash, createdAt: "2026-11-06", updatedAt: "2026-11-06", ...overrides } };
}
function signed(value: unknown, deliveryId = "delivery") {
  const payload = JSON.stringify(value);
  const timestamp = Math.floor(Date.now() / 1000);
  return { payload, signature: `t=${timestamp},v1=${createHmac("sha256", "webhook-secret").update(`${timestamp}.${payload}`).digest("hex")}`, deliveryId };
}
function seed(overrides: Partial<Row> = {}) {
  const row: Row = { id: "topup", agentId: "agent", amount: 10_000_000n, asset: "XLM", status: "pending", veloPaymentIntentId: "pi", checkoutUrl: null, receiverAddress: receiver, paymentTxHash: null, fundTxHash: null, recovery: null, completedAt: null, agent: { ...agent }, ...overrides };
  rows.push(row); return row;
}
const service = () => createVeloService({ db: db as unknown as PrismaClient, velo: { checkout: { sessions: { create: checkout } }, paymentIntents: { retrieve } }, treasury, chain: { fundEscrow, balanceOf }, webhookSecret: "webhook-secret", newId: () => "local" });
beforeEach(() => {
  vi.resetAllMocks(); rows = []; deliveries = new Map(); agent.status = "active";
  vi.spyOn(console, "warn").mockImplementation(() => {});
  checkout.mockResolvedValue(intent({ status: "created" })); retrieve.mockResolvedValue(intent());
  fundEscrow.mockResolvedValue({ status: "SUCCESS", hash: fundHash, innerHash: fundHash, transport: "relayer" }); balanceOf.mockResolvedValue(12_345n);
  db.agent.findFirst.mockImplementation(async ({ where }) => where.id === agent.id && where.orgId === agent.orgId ? { ...agent } : null);
  db.agent.findUnique.mockImplementation(async ({ where }) => where.id === agent.id ? { ...agent } : null);
  db.agent.update.mockResolvedValue({}); db.$queryRaw.mockResolvedValue([]);
  db.topup.create.mockImplementation(async ({ data }) => seed(data));
  db.topup.findUnique.mockImplementation(async ({ where }) => rows.find((r) => where.id ? r.id === where.id : r.veloPaymentIntentId === where.veloPaymentIntentId) ?? null);
  db.topup.findFirst.mockImplementation(async ({ where }) => rows.find((r) => r.status === where.status) ?? null);
  db.topup.findMany.mockImplementation(async ({ where, take }) => rows.filter((r) => r.status === where.status).slice(0, take));
  db.topup.update.mockImplementation(async ({ where, data }) => { const row = rows.find((r) => r.id === where.id)!; Object.assign(row, data); return row; });
  db.webhookEvent.upsert.mockImplementation(async ({ where, create }) => { const key = `${where.source_eventId.source}:${where.source_eventId.eventId}`; if (!deliveries.has(key)) deliveries.set(key, create); return deliveries.get(key); });
  db.webhookEvent.findUnique.mockImplementation(async ({ where }) => deliveries.get(`${where.source_eventId.source}:${where.source_eventId.eventId}`) ?? null);
  db.webhookEvent.update.mockImplementation(async ({ where, data }) => { const row = deliveries.get(`${where.source_eventId.source}:${where.source_eventId.eventId}`)!; Object.assign(row, data); return row; });
  let queue = Promise.resolve();
  db.$transaction.mockImplementation((work: (tx: typeof db) => Promise<unknown>) => {
    const result = queue.then(async () => {
      const snapshots = rows.map((row) => ({ row, data: structuredClone(row) }));
      const deliverySnapshot = structuredClone(deliveries);
      try { return await work(db); } catch (error) {
        rows = snapshots.map(({ row, data }) => Object.assign(row, data)); deliveries = deliverySnapshot; throw error;
      }
    });
    queue = result.then(() => {}, () => {}); return result;
  });
});

describe("Velo checkout", () => {
  it("persists a stable operation before the SDK call and formats stroops exactly", async () => {
    checkout.mockImplementation(async () => { expect(rows[0]).toMatchObject({ id: "local", veloPaymentIntentId: "pending:local", status: "pending" }); return intent(); });
    expect(await service().createTopup({ orgId: "buyer", agentId: "agent", amountStroops: "10000000", origin: "https://settl.test" })).toEqual({ checkoutUrl: "https://checkout.velo.test/pi", sessionId: "pi" });
    expect(checkout).toHaveBeenCalledWith({ amount: "1.0000000", asset: "XLM", anchor: "inhouse", description: "Settl agent escrow top-up", successUrl: "https://settl.test/buyer/agents/agent?topup=success", cancelUrl: "https://settl.test/buyer/agents/agent?topup=cancelled" }, { idempotencyKey: "checkout:local", correlationId: "checkout:local" });
    expect(rows[0]).toMatchObject({ veloPaymentIntentId: "pi", amount: 10_000_000n, receiverAddress: receiver });
  });
  it.each(["0", "-1", "1.1", "1e7", " 1", "9223372036854775808", 10000000, null])("rejects invalid or overflowing stroops %s", async (amountStroops) => {
    await expect(service().createTopup({ orgId: "buyer", agentId: "agent", amountStroops, origin: "https://settl.test" })).rejects.toMatchObject({ status: 400 }); expect(checkout).not.toHaveBeenCalled();
  });
  it("hides another buyer's agent and never sends its identity to checkout", async () => {
    await expect(service().createTopup({ orgId: "other", agentId: "agent", amountStroops: "1", origin: "https://settl.test" })).rejects.toMatchObject({ status: 404 }); expect(checkout).not.toHaveBeenCalled();
  });
  it.each(["provisioning", "paused", "revoked"])("rejects a new checkout for an owned %s agent", async (status) => {
    agent.status = status;
    await expect(service().createTopup({ orgId: "buyer", agentId: "agent", amountStroops: "10000000", origin: "https://settl.test" })).rejects.toMatchObject({ status: 409, code: "agent_inactive" });
    expect(db.topup.create).not.toHaveBeenCalled(); expect(checkout).not.toHaveBeenCalled();
  });
  it("rechecks checkout eligibility after a lifecycle update wins the agent lock", async () => {
    db.$queryRaw.mockImplementation(async (sql: TemplateStringsArray) => {
      if (sql.join("").includes('FROM "agents"')) agent.status = "provisioning";
      return [];
    });
    await expect(service().createTopup({ orgId: "buyer", agentId: "agent", amountStroops: "10000000", origin: "https://settl.test" })).rejects.toMatchObject({ status: 409, code: "agent_inactive" });
    expect(db.topup.create).not.toHaveBeenCalled(); expect(checkout).not.toHaveBeenCalled();
  });
  it("does not create a remote intent when the durable local insert fails", async () => {
    db.topup.create.mockRejectedValueOnce(new Error("database"));
    await expect(service().createTopup({ orgId: "buyer", agentId: "agent", amountStroops: "1", origin: "https://settl.test" })).rejects.toThrow(); expect(checkout).not.toHaveBeenCalled();
  });
  it("retains the stable recovery identity after an SDK timeout or intent persistence failure", async () => {
    checkout.mockRejectedValueOnce(new Error("secret"));
    await expect(service().createTopup({ orgId: "buyer", agentId: "agent", amountStroops: "1", origin: "https://settl.test" })).rejects.toMatchObject({ code: "checkout_unavailable" });
    expect(rows[0].recovery).toMatchObject({ idempotencyKey: "checkout:local" }); expect(rows[0].status).toBe("pending");
    db.topup.update.mockRejectedValueOnce(new Error("database"));
    await expect(service().createTopup({ orgId: "buyer", agentId: "agent", amountStroops: "1", origin: "https://settl.test" })).rejects.toMatchObject({ code: "checkout_unavailable" });
  });
  it.each(["javascript:alert(1)", "https://user:password@checkout.test/pi", null])("rejects unsafe checkout URL %s", async (checkoutUrl) => {
    checkout.mockResolvedValueOnce(intent({ checkoutUrl }));
    await expect(service().createTopup({ orgId: "buyer", agentId: "agent", amountStroops: "10000000", origin: "https://settl.test" })).rejects.toMatchObject({ code: "checkout_unavailable" });
  });
});

afterEach(() => { vi.restoreAllMocks(); });

describe("verified Velo payments", () => {
  it.each([42, undefined])("accepts Velo's signed payment.created with registryProjectId %s without funding", async (registryProjectId) => {
    const value = { ...event({}, "payment.created"), project: { ...event().project, registryProjectId } };
    expect(await service().handleVeloWebhook(signed(value))).toEqual({ received: true });
    expect(db.webhookEvent.upsert).toHaveBeenCalledOnce();
    expect(fundEscrow).not.toHaveBeenCalled(); expect(retrieve).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });
  it("funds a numeric-registry payment once only after retrieving and matching the stored paid intent", async () => {
    const row = seed(); const api = service();
    const value = { ...event(), project: { ...event().project, registryProjectId: 42 } };
    await api.handleVeloWebhook(signed(value)); await api.handleVeloWebhook(signed(value, "second"));
    expect(retrieve).toHaveBeenCalledWith("pi");
    expect(fundEscrow).toHaveBeenCalledExactlyOnceWith(treasury, agent.deviceHash, row.amount);
    expect(row).toMatchObject({ status: "completed", fundTxHash: fundHash });
  });
  it.each(["bad signature", "expired signature", "tampered body"])("rejects a numeric-registry event with %s before storage", async (failure) => {
    const input = signed({ ...event(), project: { ...event().project, registryProjectId: 42 } });
    if (failure === "bad signature") input.signature = input.signature.replace(/v1=.*/, `v1=${"0".repeat(64)}`);
    if (failure === "expired signature") {
      const timestamp = Math.floor(Date.now() / 1000) - 600;
      input.signature = `t=${timestamp},v1=${createHmac("sha256", "webhook-secret").update(`${timestamp}.${input.payload}`).digest("hex")}`;
    }
    if (failure === "tampered body") input.payload += " ";
    await expect(service().handleVeloWebhook(input)).rejects.toMatchObject({ status: 400, code: "invalid_velo_signature" });
    expect(db.webhookEvent.upsert).not.toHaveBeenCalled(); expect(fundEscrow).not.toHaveBeenCalled();
  });
  it.each([-1, 1.5, null, {}, true])("rejects unsupported signed registry metadata %s", async (registryProjectId) => {
    await expect(service().handleVeloWebhook(signed({ ...event(), project: { ...event().project, registryProjectId } }))).rejects.toMatchObject({ status: 400, code: "invalid_velo_payload" });
    expect(db.webhookEvent.upsert).not.toHaveBeenCalled(); expect(fundEscrow).not.toHaveBeenCalled();
  });
  it("validates all required payment fields after the authenticated registry compatibility path", async () => {
    await expect(service().handleVeloWebhook(signed({ ...event(), project: { ...event().project, registryProjectId: 42 }, paymentIntent: { id: "pi" } }))).rejects.toMatchObject({ status: 400, code: "invalid_velo_payload" });
    expect(db.webhookEvent.upsert).not.toHaveBeenCalled(); expect(fundEscrow).not.toHaveBeenCalled();
  });
  it("retains independent amount matching for a numeric-registry event", async () => {
    seed(); retrieve.mockResolvedValueOnce(intent({ amount: "2.0000000" }));
    await expect(service().handleVeloWebhook(signed({ ...event(), project: { ...event().project, registryProjectId: 42 } }))).rejects.toMatchObject({ status: 400, code: "velo_payment_mismatch" });
    expect(fundEscrow).not.toHaveBeenCalled();
  });
  it.each([
    { label: "missing signature", reason: "missing_signature", code: "invalid_velo_signature" },
    { label: "changed body", reason: "signature_mismatch", code: "invalid_velo_signature" },
    { label: "expired signature", reason: "signature_timestamp_outside_tolerance", code: "invalid_velo_signature" },
    { label: "signed invalid project", reason: "invalid_project_fields", code: "invalid_velo_payload" },
    { label: "signed unsupported version", reason: "invalid_event_shape", code: "invalid_velo_payload" },
  ])("diagnoses $label without logging signed content or performing payment work", async ({ label, reason, code }) => {
    let input = signed(event());
    if (label === "missing signature") input = { ...input, signature: "" };
    if (label === "changed body") input = { ...input, payload: `${input.payload} ` };
    if (label === "expired signature") {
      const timestamp = Math.floor(Date.now() / 1000) - 600;
      input.signature = `t=${timestamp},v1=${createHmac("sha256", "webhook-secret").update(`${timestamp}.${input.payload}`).digest("hex")}`;
    }
    if (label === "signed invalid project") input = signed({ ...event(), project: { id: "project" } });
    if (label === "signed unsupported version") input = signed({ ...event(), version: "secret-payload-version" });
    await expect(service().handleVeloWebhook(input)).rejects.toMatchObject({ status: 400, code });
    expect(console.warn).toHaveBeenCalledExactlyOnceWith("velo_webhook_verification_failed", { reason });
    expect(db.webhookEvent.upsert).not.toHaveBeenCalled();
    expect(retrieve).not.toHaveBeenCalled(); expect(fundEscrow).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toMatch(/webhook-secret|secret-payload-version|v1=/);
  });
  it("checks the exact raw signature before parsing or touching storage", async () => {
    const valid = signed(event());
    await expect(service().handleVeloWebhook({ ...valid, payload: `${valid.payload} ` })).rejects.toMatchObject({ status: 400 });
    await expect(service().handleVeloWebhook(signed("not an event"))).rejects.toMatchObject({ status: 400 });
    await expect(service().handleVeloWebhook({ ...valid, payload: "{malformed" })).rejects.toMatchObject({ status: 400 });
    expect(db.webhookEvent.upsert).not.toHaveBeenCalled(); expect(fundEscrow).not.toHaveBeenCalled();
  });
  it("requires a delivery ID", async () => {
    await expect(service().handleVeloWebhook(signed(event(), ""))).rejects.toMatchObject({ status: 400 }); expect(db.webhookEvent.upsert).not.toHaveBeenCalled();
  });
  it("funds stored identity once across repeated and distinct delivery IDs, with an atomic completion outbox", async () => {
    const row = seed(); const api = service();
    await api.handleVeloWebhook(signed(event())); await api.handleVeloWebhook(signed(event())); await api.handleVeloWebhook(signed(event(), "second"));
    expect(fundEscrow).toHaveBeenCalledExactlyOnceWith(treasury, agent.deviceHash, row.amount);
    expect(retrieve).toHaveBeenCalledWith("pi"); expect(row).toMatchObject({ status: "completed", paymentTxHash: paymentHash, fundTxHash: fundHash });
    expect(db.agent.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ cachedBalance: 12_345n, balanceUpdatedAt: expect.any(Date) }) }));
    expect(deliveries.get("settl:topup:topup:completed")?.payload).toMatchObject({ eventId: "topup:topup:completed", event: "topup.completed", agentId: "agent", orgIds: ["buyer"] });
  });
  it.each([{ amount: "10000000" }, { asset: "USDC" }, { receiverAddress: Keypair.random().publicKey() }, { status: "pending" as const }, { txHash: "invalid" }])("rejects a signed mismatched payment %s", async (overrides) => {
    seed(); await expect(service().handleVeloWebhook(signed(event(overrides)))).rejects.toMatchObject({ status: 400 }); expect(fundEscrow).not.toHaveBeenCalled();
  });
  it.each([{ amount: "2" }, { asset: "USDC" }, { receiverAddress: Keypair.random().publicKey() }, { status: "pending" as const }, { id: "other", paymentIntentId: "other" }])("independently retrieves and rejects an inconsistent remote intent %s", async (overrides) => {
    seed(); retrieve.mockResolvedValueOnce(intent(overrides)); await expect(service().handleVeloWebhook(signed(event()))).rejects.toMatchObject({ status: 400 }); expect(fundEscrow).not.toHaveBeenCalled();
  });
  it("acknowledges an unknown intent without using forged metadata to select an agent", async () => {
    await service().handleVeloWebhook(signed({ ...event(), metadata: { agentId: "agent", amount: "1" } })); expect(fundEscrow).not.toHaveBeenCalled(); expect(retrieve).not.toHaveBeenCalled();
  });
  it("leaves a failed retrieval retryable without funding", async () => {
    seed(); retrieve.mockRejectedValueOnce(new Error("network"));
    await expect(service().handleVeloWebhook(signed(event()))).rejects.toMatchObject({ status: 503 }); expect(fundEscrow).not.toHaveBeenCalled();
    await service().handleVeloWebhook(signed(event())); expect(fundEscrow).toHaveBeenCalledOnce();
  });
  it("requires a payment transaction hash in authenticated event data", async () => {
    seed(); await expect(service().handleVeloWebhook(signed(event({ txHash: undefined })))).rejects.toMatchObject({ status: 400 }); expect(fundEscrow).not.toHaveBeenCalled();
  });
  it("retains pending funding and freezes all later treasury submissions across concurrent top-ups", async () => {
    seed(); seed({ id: "other", veloPaymentIntentId: "pi2" });
    retrieve.mockImplementation(async (id: string) => intent({ id, paymentIntentId: id }));
    fundEscrow.mockResolvedValue({ status: "PENDING", hash: fundHash, innerHash: fundHash, transport: "velo", recovery: { requestId: "request", transactionHash: fundHash } });
    const api = service();
    await Promise.all([api.handleVeloWebhook(signed(event(), "one")), api.handleVeloWebhook(signed(event({ id: "pi2", txHash: "d".repeat(64) }), "two"))]);
    expect(fundEscrow).toHaveBeenCalledOnce(); expect(rows.map((r) => r.status).sort()).toEqual(["funding", "paid"]);
    expect(rows.find((r) => r.status === "funding")?.recovery).toMatchObject({ treasuryPublic: treasury.publicKey(), requestId: "request" });
    expect(await api.processPaidTopups()).toMatchObject({ blocked: true, completed: 0 }); expect(fundEscrow).toHaveBeenCalledOnce();
  });
  it.each(["provisioning", "paused", "revoked"])("never funds a paid top-up whose current agent is %s, preserving an operator outcome", async (status) => {
    const row = seed({ status: "paid", paymentTxHash: paymentHash });
    db.agent.findUnique.mockResolvedValueOnce({ ...agent, status });
    expect(await service().processPaidTopups()).toMatchObject({ processed: 1, failed: 1, completed: 0 });
    expect(row).toMatchObject({ status: "failed", completedAt: null, fundTxHash: null, paymentTxHash: paymentHash,
      recovery: expect.objectContaining({ phase: "funding_blocked", reason: "agent_inactive", agentStatus: status }),
    });
    expect(fundEscrow).not.toHaveBeenCalled(); expect(db.agent.update).not.toHaveBeenCalled();
    expect(deliveries.has("settl:topup:topup:completed")).toBe(false);
  });
  it("checks the current locked agent before committing funding even when the selected relation was active", async () => {
    const row = seed({ status: "paid", paymentTxHash: paymentHash });
    db.$queryRaw.mockImplementation(async (sql: TemplateStringsArray) => {
      if (sql.join("").includes('FROM "agents"')) agent.status = "provisioning";
      return [];
    });
    await service().processPaidTopups();
    expect(row.status).toBe("failed"); expect(fundEscrow).not.toHaveBeenCalled();
  });
  it("commits funding before network submission and never retries a thrown unknown outcome", async () => {
    const row = seed(); fundEscrow.mockImplementation(async () => { expect(row.status).toBe("funding"); throw new Error("unknown secret"); });
    const api = service(); await api.handleVeloWebhook(signed(event())); await api.handleVeloWebhook(signed(event(), "retry"));
    expect(row.status).toBe("funding"); expect(fundEscrow).toHaveBeenCalledOnce(); expect(db.agent.update).not.toHaveBeenCalled();
  });
  it("preserves the known hash if completion/outbox persistence fails, without a second submission", async () => {
    const row = seed({ status: "paid", paymentTxHash: paymentHash });
    db.webhookEvent.upsert.mockRejectedValueOnce(new Error("database secret"));
    const api = service(); expect(await api.processPaidTopups()).toMatchObject({ pending: 1, blocked: true });
    expect(row).toMatchObject({ status: "funding", fundTxHash: fundHash, recovery: expect.objectContaining({ treasuryPublic: treasury.publicKey(), observedStatus: "SUCCESS" }) });
    expect(deliveries.has("settl:topup:topup:completed")).toBe(false);
    await api.processPaidTopups(); expect(fundEscrow).toHaveBeenCalledOnce();
  });
  it("drains durable paid work after a previous funding marker is explicitly resolved", async () => {
    seed({ status: "funding" }); seed({ id: "queued", status: "paid", veloPaymentIntentId: "pi2", paymentTxHash: "d".repeat(64) });
    const api = service(); expect(await api.processPaidTopups()).toMatchObject({ blocked: true }); rows[0].status = "completed";
    expect(await api.processPaidTopups()).toMatchObject({ completed: 1, pending: 0 }); expect(rows[1].status).toBe("completed");
  });
  it("continues after known chain failure but never retries that failed top-up", async () => {
    seed({ status: "paid", paymentTxHash: paymentHash }); seed({ id: "next", status: "paid", veloPaymentIntentId: "pi2", paymentTxHash: "d".repeat(64) });
    fundEscrow.mockResolvedValueOnce({ status: "FAILED", hash: fundHash, innerHash: fundHash, transport: "relayer" });
    expect(await service().processPaidTopups()).toMatchObject({ failed: 1, completed: 1 }); expect(rows[0].status).toBe("failed");
  });
  it("completes confirmed funding even if the observed balance is unavailable, preserving cache", async () => {
    const row = seed(); balanceOf.mockRejectedValueOnce(new Error("RPC")); await service().handleVeloWebhook(signed(event()));
    expect(row.status).toBe("completed"); expect(db.agent.update).not.toHaveBeenCalled();
  });
  it.each(["funding", "completed"])("does not overwrite %s after payment.failed", async (status) => {
    const row = seed({ status }); await service().handleVeloWebhook(signed(event({ status: "failed" }, "payment.failed"))); expect(row.status).toBe(status); expect(fundEscrow).not.toHaveBeenCalled();
  });
  it("records payment.failed before funding starts", async () => {
    const row = seed(); await service().handleVeloWebhook(signed(event({ status: "failed", txHash: undefined, receiverAddress: undefined }, "payment.failed"))); expect(row.status).toBe("failed"); expect(retrieve).not.toHaveBeenCalled();
  });
});
