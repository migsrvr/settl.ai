// @vitest-environment node
import { Keypair } from "@stellar/stellar-sdk";
import type { PrismaClient } from "../generated/prisma/client";
import { describe, expect, it, vi } from "vitest";
import { createBroker } from "./broker";

const signer = Keypair.random();
const NOW = new Date("2026-11-05T12:00:00Z");
const HASH = "ab".repeat(32);
vi.mock("./wallets", () => ({ decryptWalletSecret: () => signer.secret() }));

function setup(pass = true, useRealVerifier = false) {
  const reservation = { id: "r1", agentId: "agent", quoteId: "q1", amount: 1333334n, status: "held", expiresAt: new Date(NOW.getTime() + 300_000), releaseReason: null as string | null };
  const payment = { id: "p1", quoteId: "q1", kind: "commit", status: "pending", txHash: null as string | null, innerHash: null as string | null, error: null as string | null };
  const agent = { id: "agent", orgId: "buyer", status: "active", deviceHash: "cd".repeat(32), agentPublic: signer.publicKey(), agentSecretEnc: "encrypted", settings: null, policy: { asset: "native", expiresAt: new Date("2026-12-31T00:00:00Z") } };
  const endpoint = { id: "resibo_parse", providerId: "resibo", mode: "outcome", provider: { id: "resibo", orgId: "seller", merchantWallet: signer.publicKey(), settings: null } };
  const quote = { id: "q1", endpointId: endpoint.id, agentId: agent.id, amount: reservation.amount, asset: "native", merchant: signer.publicKey(), nonce: 1n, mode: "outcome", status: "issued", expiresAt: reservation.expiresAt, criteria: { schema: "resibo.receipt.v1", minConfidence: .85 }, agent, endpoint, reservation, payment, verification: null as unknown };
  const checks = [{ check: "confidence", ok: pass, note: pass ? "Passed" : "Too blurry" }];
  const evaluate = vi.fn(() => checks);
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    webhookEvent: { upsert: vi.fn().mockResolvedValue({ id: "outbox" }) },
    quote: { findUnique: vi.fn(async () => quote), update: vi.fn(async ({ data }: { data: object }) => Object.assign(quote, data)), updateMany: vi.fn(async ({ data }: { data: object }) => { Object.assign(quote, data); return { count: 1 }; }) },
    reservation: { update: vi.fn(async ({ data }: { data: object }) => Object.assign(reservation, data)) },
    payment: { update: vi.fn(async ({ data }: { data: object }) => Object.assign(payment, data)), updateMany: vi.fn(async ({ data }: { data: object }) => { Object.assign(payment, data); return { count: 1 }; }) },
    verification: { upsert: vi.fn(async ({ create }: { create: object }) => { quote.verification = create; return create; }) },
    webhookEndpoint: { findMany: vi.fn().mockResolvedValue([]) },
  };
  let queue = Promise.resolve();
  const db = { ...tx, $transaction: vi.fn((work: (transaction: typeof tx) => Promise<unknown>) => {
    const result = queue.then(() => work(tx)); queue = result.then(() => {}, () => {}); return result;
  }) };
  const chain = { authorize: vi.fn().mockResolvedValue({ status: "SUCCESS", hash: HASH, innerHash: HASH, transport: "velo" }), readAuthorizeTx: vi.fn(), balanceOf: vi.fn().mockResolvedValue(10n), pendingBalance: vi.fn().mockResolvedValue(1333334n) };
  const broker = createBroker({ db: db as unknown as PrismaClient, chain, escrowContract: "escrow", phpPerXlm: 15, now: () => NOW, ...(useRealVerifier ? {} : { evaluate }) });
  return { ...broker, reservation, payment, quote, checks, evaluate, chain, tx };
}
const params = { quoteId: "q1", endpointId: "resibo_parse", reservationId: "r1" };

describe("outcome verification", () => {
  it.each([
    { confidence: .98, total: 1250.50, amounts: [1000, 250.50], paid: true },
    { confidence: .42, total: 1250.50, amounts: [1000, 250.50], paid: false },
    { confidence: .98, total: 500, amounts: [100, 100], paid: false },
  ])("integrates the real receipt verifier before any authorization (%j)", async ({ confidence, total, amounts, paid }) => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    try {
      const s = setup(true, true);
      Object.assign(s.quote.criteria, { required: ["merchant_name", "date", "total", "line_items"], lineItemsSumToTotal: { tolerance: .01 } });
      const output = { merchant_name: "Demo store", date: "2026-11-05", confidence, total, line_items: amounts.map((amount) => ({ description: "Item", amount })) };
      const verified = await s.verifyOutcome({ ...params, result: output });
      expect(verified).toMatchObject({ verification: paid ? "pass" : "fail", receipt: { status: paid ? "paid" : "not_charged" } });
      expect(s.chain.authorize).toHaveBeenCalledTimes(paid ? 1 : 0);
    } finally { vi.useRealTimers(); }
  });

  it("claims valid held work before the provider and rejects commitment replay", async () => {
    const s = setup();
    expect(await s.inspectOutcome(params)).toEqual({ ok: true, quoteId: "q1", reservationId: "r1" });
    expect(s.payment.error).toBe("provider_running");
    expect(await s.inspectOutcome(params)).toMatchObject({ ok: false });
    expect(s.chain.authorize).not.toHaveBeenCalled();
  });
  it("releases failed checks without submitting any payment", async () => {
    const s = setup(false);
    expect(await s.verifyOutcome({ ...params, result: { confidence: .42 } })).toMatchObject({ verification: "fail", receipt: { status: "not_charged", amountStroops: "0", checks: s.checks } });
    expect(s.chain.authorize).not.toHaveBeenCalled();
    expect(s.reservation).toMatchObject({ status: "released", releaseReason: "checks_failed" });
    expect(s.payment.status).toBe("not_charged");
    expect(s.tx.webhookEvent.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { source_eventId: { source: "settl", eventId: "payment:q1:not_charged" } } }));
    expect(s.quote.status).toBe("failed");
  });
  it("marks the settlement durable before authorizing and settles once", async () => {
    const s = setup();
    s.chain.authorize.mockImplementation(async () => {
      expect(s.payment.error).toBe("verification_in_progress");
      return { status: "SUCCESS", hash: HASH, innerHash: HASH, transport: "velo" };
    });
    expect(await s.verifyOutcome({ ...params, result: { confidence: .98 } })).toMatchObject({ verification: "pass", receipt: { status: "paid", txHash: HASH } });
    expect(s.reservation.status).toBe("settled"); expect(s.payment.status).toBe("paid");
    expect(await s.verifyOutcome({ ...params, result: {} })).toMatchObject({ verification: "pass" });
    expect(s.chain.authorize).toHaveBeenCalledTimes(1);
  });
  it.each(["pending", "throw"])("preserves the hold on %s submissions", async (mode) => {
    const s = setup();
    if (mode === "throw") s.chain.authorize.mockRejectedValue(new Error("unknown handoff"));
    else s.chain.authorize.mockResolvedValue({ status: "PENDING", hash: HASH, innerHash: HASH, transport: "velo" });
    expect(await s.verifyOutcome({ ...params, result: {} })).toMatchObject({ verification: "pending" });
    expect(s.reservation.status).toBe("held"); expect(s.payment.status).toBe("pending");
    expect(await s.verifyOutcome({ ...params, result: {} })).toMatchObject({ verification: "pending" });
    expect(s.chain.authorize).toHaveBeenCalledTimes(1);
  });
  it("rejects wrong endpoint, wrong reservation, expired hold and quote/hold amount mismatch", async () => {
    const s = setup();
    expect(await s.inspectOutcome({ ...params, endpointId: "other" })).toMatchObject({ ok: false });
    expect(await s.inspectOutcome({ ...params, reservationId: "other" })).toMatchObject({ ok: false });
    s.reservation.amount = 1n;
    expect(await s.inspectOutcome(params)).toMatchObject({ ok: false });
    s.reservation.amount = s.quote.amount; s.reservation.expiresAt = new Date(NOW.getTime() - 1);
    expect(await s.inspectOutcome(params)).toMatchObject({ ok: false });
    expect(s.chain.authorize).not.toHaveBeenCalled();
  });
  it("never authorizes twice under concurrent result posts", async () => {
    const s = setup();
    await Promise.all([s.verifyOutcome({ ...params, result: {} }), s.verifyOutcome({ ...params, result: {} })]);
    expect(s.chain.authorize).toHaveBeenCalledTimes(1);
  });
});
