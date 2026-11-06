// @vitest-environment node
import { Keypair } from "@stellar/stellar-sdk";
import { decodePaymentHeader } from "@settl/core";
import type { PrismaClient } from "../generated/prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBroker } from "./broker";

const NOW = new Date("2026-11-05T12:00:00Z");
const HASH = "ab".repeat(32);
const INNER = "cd".repeat(32);
const SIGNER = Keypair.random();

vi.mock("./wallets", () => ({ decryptWalletSecret: vi.fn(() => SIGNER.secret()) }));

function setup() {
  const policy = { asset: "native-asset", expiresAt: new Date("2026-12-31T00:00:00Z"), dailyBudget: 50_000_000n, maxAmount: 10_000_000n, maxPricePerCall: 10_000_000n, autoApproveUpTo: 5_000_000n, allowlist: ["resibo"] };
  const agent = { id: "bookkeeper", orgId: "buyer", status: "active", agentPublic: SIGNER.publicKey(), agentSecretEnc: "encrypted", deviceHash: "ef".repeat(32), lastNonce: 0n, policy, settings: { lowBudgetAlert: 0n, lastAlertAt: null } };
  const provider = { id: "resibo", orgId: "seller", merchantWallet: Keypair.random().publicKey(), settings: { autoClaimEnabled: false, autoClaimThreshold: 1n } };
  const endpoint = { id: "ocr", name: "Receipt OCR", active: true, method: "POST", route: "/ocr", url: null as string | null, price: 1_333_334n, mode: "per_call", criteria: null, providerId: "resibo", provider };
  type QuoteRow = { id: string; agentId: string; endpointId: string; nonce: bigint; amount: bigint; asset: string; merchant: string; mode: string; criteria?: unknown; resource: string; status: string; expiresAt: Date };
  type PaymentRow = { id: string; quoteId: string; status: string; txHash?: string | null; innerHash?: string | null; kind: string; [key: string]: unknown };
  const quotes = new Map<string, QuoteRow>();
  const payments = new Map<string, PaymentRow>();
  type ApprovalRow = { id: string; quoteId: string; agentId: string; providerId: string; amount: bigint; status: string; expiresAt: Date };
  const approvals = new Map<string, ApprovalRow>();
  const reservations = new Map<string, { id: string; quoteId: string; agentId: string; amount: bigint; expiresAt: Date; status: string; releaseReason?: string }>();
  const verifications = new Map<string, object>();
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    webhookEvent: { upsert: vi.fn().mockResolvedValue({ id: "outbox" }) },
    agent: {
      findUnique: vi.fn(async () => agent), findFirst: vi.fn(async () => agent),
      update: vi.fn(async ({ data }: { data: { lastNonce: bigint } }) => Object.assign(agent, data)),
    },
    endpoint: { findUnique: vi.fn(async () => endpoint) },
    quote: {
      create: vi.fn(async ({ data }: { data: Omit<QuoteRow, "id"> }) => { const row = { ...data, id: `q${quotes.size + 1}` }; quotes.set(row.id, row); return row; }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = quotes.get(where.id);
        return row ? { ...row, agent, endpoint, payment: payments.get(row.id) ?? null, reservation: reservations.get(row.id) ?? null, verification: verifications.get(row.id) ?? null } : null;
      }),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<QuoteRow> }) => Object.assign(quotes.get(where.id)!, data)),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; status?: string }; data: Partial<QuoteRow> }) => {
        const q = quotes.get(where.id);
        if (!q || (where.status && q.status !== where.status)) return { count: 0 };
        Object.assign(q, data); return { count: 1 };
      }),
    },
    payment: {
      findFirst: vi.fn(async ({ where }: { where: { status?: string; quoteId?: { not: string }; OR?: { txHash?: string; innerHash?: string }[] } }) => {
        return [...payments.values()].find((p) => where.status ? p.status === where.status : p.quoteId !== where.quoteId?.not && where.OR?.some((h) => h.txHash && p.txHash === h.txHash || h.innerHash && p.innerHash === h.innerHash)) ?? null;
      }),
      create: vi.fn(async ({ data }: { data: Omit<PaymentRow, "id"> }) => { const row = { ...data, id: `p${payments.size + 1}` } as PaymentRow; payments.set(row.quoteId, row); return row; }),
      update: vi.fn(async ({ where, data }: { where: { quoteId: string }; data: Partial<PaymentRow> }) => Object.assign(payments.get(where.quoteId)!, data)),
      updateMany: vi.fn(async ({ where, data }: { where: { quoteId: string; status?: string }; data: Partial<PaymentRow> }) => {
        const p = payments.get(where.quoteId);
        if (!p || (where.status && p.status !== where.status)) return { count: 0 };
        Object.assign(p, data); return { count: 1 };
      }),
      upsert: vi.fn(async ({ where, create, update }: { where: { quoteId: string }; create: Omit<PaymentRow, "id">; update: Partial<PaymentRow> }) => {
        const p = payments.get(where.quoteId) ?? { ...create, id: `p${payments.size + 1}` } as PaymentRow;
        Object.assign(p, update); payments.set(where.quoteId, p); return p;
      }),
    },
    reservation: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }),
      create: vi.fn(async ({ data }: { data: { quoteId: string; agentId: string; amount: bigint; expiresAt: Date; status: string } }) => { const row = { ...data, id: "r1" }; reservations.set(data.quoteId, row); return row; }),
      update: vi.fn(async ({ where, data }: { where: { quoteId: string }; data: object }) => Object.assign(reservations.get(where.quoteId)!, data)),
    },
    verification: { upsert: vi.fn(async ({ where, create }: { where: { quoteId: string }; create: object }) => { verifications.set(where.quoteId, create); return create; }) },
    approval: {
      create: vi.fn(async ({ data }: { data: Omit<ApprovalRow, "id"> }) => { const row = { ...data, id: `a${approvals.size + 1}` }; approvals.set(row.id, row); return row; }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => { const a = approvals.get(where.id); return a ? { ...a, quote: quotes.get(a.quoteId) } : null; }),
    },
    webhookEndpoint: { findMany: vi.fn().mockResolvedValue([]) },
  };
  // The real implementation locks agent rows; this stand-in serializes transactions.
  let queue = Promise.resolve();
  const db = { ...tx, $transaction: vi.fn((work: (transaction: typeof tx) => Promise<unknown>) => {
    const result = queue.then(() => work(tx)); queue = result.then(() => {}, () => {}); return result;
  }) };
  const chain = {
    authorize: vi.fn().mockResolvedValue({ status: "SUCCESS", hash: HASH, innerHash: INNER, transport: "velo" }),
    readAuthorizeTx: vi.fn(), balanceOf: vi.fn().mockResolvedValue(10_000_000n), pendingBalance: vi.fn().mockResolvedValue(1_333_334n),
  };
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ parsed: true }), { status: 200 }));
  const evaluate = vi.fn(() => [{ check: "confidence", ok: true, note: "Passed" }]);
  const broker = createBroker({ db: db as unknown as PrismaClient, chain, escrowContract: "escrow", phpPerXlm: 15, now: () => NOW, fetch: fetcher, evaluate });
  return { ...broker, tx, db, chain, fetcher, agent, policy, endpoint, quotes, payments, approvals, reservations, evaluate };
}

afterEach(() => vi.restoreAllMocks());

describe("broker quotes and policy", () => {
  it("allocates a nonce under the row lock and returns a wire quote without bigint", async () => {
    const s = setup();
    const quote = await s.createQuote({ endpointId: "ocr" });
    expect(quote).toMatchObject({ mode: "per-call", amountStroops: "1333334", displayPrice: { currency: "PHP", amount: "2.00" }, expiresAt: "2026-11-05T12:05:00.000Z" });
    expect(s.agent.lastNonce).toBe(1n);
    expect(s.tx.$queryRaw).toHaveBeenCalled();
    expect(s.tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(s.tx.agent.update.mock.invocationCallOrder[0]);
    expect(() => JSON.stringify(quote)).not.toThrow();
  });

  it.each(["revoked", "provisioning"])("does not spend for a %s agent", async (status) => {
    const s = setup(); s.agent.status = status;
    expect(await s.executeCall({ agentId: "bookkeeper", endpointId: "ocr" })).toMatchObject({ status: "blocked" });
    expect(s.chain.authorize).not.toHaveBeenCalled();
  });

  it("includes today's paid quotes and active holds when evaluating the budget", async () => {
    const s = setup(); s.policy.dailyBudget = 4_000_000n;
    s.tx.quote.findMany.mockResolvedValue([{ amount: 2_000_000n }]);
    s.tx.reservation.aggregate.mockResolvedValue({ _sum: { amount: 1_000_000n } });
    expect(await s.executeCall({ agentId: "bookkeeper", endpointId: "ocr" })).toEqual({ status: "declined", reason: "over_daily_budget" });
    expect(s.chain.authorize).not.toHaveBeenCalled();
    expect(s.tx.reservation.aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "held", expiresAt: { gt: NOW } }) }));
  });

  it("declines the caller's maximum before allocating or signing", async () => {
    const s = setup();
    expect(await s.executeCall({ agentId: "bookkeeper", endpointId: "ocr", maxPricePhp: "1.00" })).toMatchObject({ status: "declined", reason: "over_max_price" });
    expect(s.tx.quote.create).not.toHaveBeenCalled();
    expect(s.chain.authorize).not.toHaveBeenCalled();
  });

  it("creates an approval bound to its quote and reuses it when approved", async () => {
    const s = setup(); s.policy.autoApproveUpTo = 1n;
    const decision = await s.executeCall({ agentId: "bookkeeper", endpointId: "ocr" });
    expect(decision).toMatchObject({ status: "approval_required", approvalId: "a1" });
    expect(s.chain.authorize).not.toHaveBeenCalled();
    s.approvals.get("a1")!.status = "approved";
    expect(await s.executeCall({ agentId: "bookkeeper", endpointId: "ocr", approvalId: "a1" })).toMatchObject({ status: "paid" });
    expect(s.quotes.size).toBe(1);
    expect(await s.executeCall({ agentId: "bookkeeper", endpointId: "ocr", approvalId: "a1" })).toMatchObject({ status: "declined", reason: "approval_already_used" });
    expect(s.chain.authorize).toHaveBeenCalledTimes(1);
  });

  it("rejects approval ownership mismatch and does not charge outcome calls", async () => {
    const s = setup(); s.policy.autoApproveUpTo = 1n;
    await s.executeCall({ agentId: "bookkeeper", endpointId: "ocr" });
    s.approvals.get("a1")!.agentId = "another-agent";
    await expect(s.executeCall({ agentId: "bookkeeper", endpointId: "ocr", approvalId: "a1" })).rejects.toMatchObject({ code: "invalid_approval" });
    s.policy.autoApproveUpTo = 10_000_000n; s.endpoint.mode = "outcome";
    expect(await s.executeCall({ agentId: "bookkeeper", endpointId: "ocr" })).toMatchObject({ status: "not_charged", reason: "endpoint_unavailable" });
    expect(s.chain.authorize).not.toHaveBeenCalled();
  });
});

describe("broker authorization and recovery", () => {
  it.each(["clean", "blurry", "wrong_total"])("charges mock OCR usage before returning the %s fixture, without outcome checks", async (fixture) => {
    const s = setup(); s.endpoint.url = "https://provider.example/ocr";
    s.fetcher.mockImplementation(async (_url, init) => {
      expect(s.chain.authorize).toHaveBeenCalledTimes(1);
      expect(s.payments.get("q1")).toMatchObject({ status: "paid", txHash: HASH });
      expect(decodePaymentHeader((init!.headers as Record<string, string>)["X-PAYMENT"])).toMatchObject({ kind: "tx", txHash: HASH });
      return Response.json({ fixture, confidence: fixture === "blurry" ? 0.42 : 0.98 });
    });
    expect(await s.executeCall({ agentId: "bookkeeper", endpointId: "ocr", input: { fixture } })).toMatchObject({
      status: "paid", receipt: { amountStroops: "1333334", txHash: HASH, checks: [] }, data: { fixture },
    });
    expect(s.evaluate).not.toHaveBeenCalled();
    expect(s.reservations.size).toBe(0);
  });

  it("retains a confirmed usage charge when the provider rejects the request", async () => {
    const s = setup(); s.endpoint.url = "https://provider.example/ocr";
    s.fetcher.mockResolvedValue(Response.json({ error: "mock_rejected" }, { status: 400 }));
    expect(await s.executeCall({ agentId: "bookkeeper", endpointId: "ocr" })).toMatchObject({
      status: "paid", receipt: { amountStroops: "1333334", txHash: HASH }, providerError: "provider_rejected", data: null,
    });
    expect(s.chain.authorize).toHaveBeenCalledTimes(1);
    expect(s.payments.get("q1")?.status).toBe("paid");
  });

  it.each([true, false])("reserves an outcome quote and charges only when checks pass (%s)", async (pass) => {
    const s = setup();
    s.endpoint.mode = "outcome"; s.endpoint.url = "https://provider.example/ocr";
    // The fixture type began with null; the DB stores JSON criteria for outcome mode.
    Object.assign(s.endpoint, { criteria: { schema: "resibo.receipt.v1", minConfidence: .85 } });
    s.evaluate.mockReturnValue([{ check: "confidence", ok: pass, note: pass ? "Passed" : "Too blurry" }]);
    s.fetcher.mockImplementation(async (_url, init) => {
      expect(s.chain.authorize).not.toHaveBeenCalled();
      const proof = decodePaymentHeader((init!.headers as Record<string, string>)["X-PAYMENT"]);
      if (proof.kind !== "commit") throw new Error("Expected commitment");
      await s.inspectOutcome({ quoteId: proof.quoteId, reservationId: proof.reservationId, endpointId: "ocr" });
      await s.verifyOutcome({ quoteId: proof.quoteId, reservationId: proof.reservationId, endpointId: "ocr", result: { confidence: pass ? .98 : .42 } });
      return Response.json({ result: "provider output" });
    });
    expect(await s.executeCall({ agentId: "bookkeeper", endpointId: "ocr" })).toMatchObject({ status: pass ? "paid" : "not_charged", data: { result: "provider output" } });
    expect(s.chain.authorize).toHaveBeenCalledTimes(pass ? 1 : 0);
    expect(s.reservations.get("q1")?.status).toBe(pass ? "settled" : "released");
  });

  it("releases an unsubmitted outcome when the provider is unavailable", async () => {
    const s = setup(); s.endpoint.mode = "outcome"; s.endpoint.url = "https://provider.example/ocr";
    Object.assign(s.endpoint, { criteria: { schema: "resibo.receipt.v1", minConfidence: .85 } });
    s.fetcher.mockRejectedValue(new Error("unreachable"));
    expect(await s.executeCall({ agentId: "bookkeeper", endpointId: "ocr" })).toMatchObject({ status: "not_charged", reason: "provider_unavailable" });
    expect(s.reservations.get("q1")?.status).toBe("released");
    expect(s.chain.authorize).not.toHaveBeenCalled();
  });

  it("plans payment webhooks, auto-claim and low-budget effects after confirmation", async () => {
    const s = setup();
    s.endpoint.provider.settings.autoClaimEnabled = true;
    s.agent.settings.lowBudgetAlert = 20_000_000n;
    s.tx.webhookEndpoint.findMany.mockResolvedValue([{ orgId: "buyer", events: ["payment.paid", "budget.low"] }]);
    const result = await s.executeCall({ agentId: "bookkeeper", endpointId: "ocr" });
    expect(result).toMatchObject({ status: "paid", effects: expect.arrayContaining([
      { kind: "webhook", orgId: "buyer", event: "payment.paid" },
      { kind: "auto_claim", providerId: "resibo" },
      { kind: "budget_low", agentId: "bookkeeper" },
    ]) });
  });

  it("allows only one same-agent call to reach Stellar while its first submission is unresolved", async () => {
    const s = setup();
    let signalStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const held = new Promise<void>((resolve) => { release = resolve; });
    s.chain.authorize.mockImplementation(async () => {
      signalStarted(); await held;
      return { status: "SUCCESS", hash: HASH, innerHash: INNER, transport: "velo" };
    });
    const first = s.executeCall({ agentId: "bookkeeper", endpointId: "ocr" });
    await started;
    const second = await s.executeCall({ agentId: "bookkeeper", endpointId: "ocr" });
    expect(second).toMatchObject({ status: "pending", reason: "payment_pending" });
    expect(s.chain.authorize).toHaveBeenCalledTimes(1);
    release();
    expect(await first).toMatchObject({ status: "paid" });
  });

  it("persists a pending claim before signing, pays once, and sends proof to the provider", async () => {
    const s = setup(); s.endpoint.url = "https://provider.example/ocr";
    s.chain.authorize.mockImplementation(async () => {
      expect(s.payments.get("q1")?.status).toBe("pending");
      return { status: "SUCCESS", hash: HASH, innerHash: INNER, transport: "velo" };
    });
    const result = await s.executeCall({ agentId: "bookkeeper", endpointId: "ocr", input: { image: "demo" } });
    expect(result).toMatchObject({ status: "paid", receipt: { quoteId: "q1", txHash: HASH }, data: { parsed: true } });
    expect(s.payments.get("q1")).toMatchObject({ status: "paid", txHash: HASH, innerHash: INNER });
    expect(s.tx.webhookEvent.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { source_eventId: { source: "settl", eventId: "payment:q1:paid" } },
      create: expect.objectContaining({ verified: true, payload: expect.objectContaining({ event: "payment.paid", agentId: "bookkeeper", orgIds: ["buyer", "seller"] }) }),
    }));
    expect(s.quotes.get("q1")?.status).toBe("paid");
    expect(s.fetcher).toHaveBeenCalledWith("https://provider.example/ocr", expect.objectContaining({ headers: expect.objectContaining({ "X-PAYMENT": expect.any(String) }) }));
  });

  it("keeps pending identity durable and blocks a second payment", async () => {
    const s = setup();
    s.chain.authorize.mockResolvedValue({ status: "PENDING", hash: HASH, innerHash: INNER, transport: "velo", recovery: { requestId: "r1", transactionHash: INNER } });
    expect(await s.executeCall({ agentId: "bookkeeper", endpointId: "ocr" })).toMatchObject({ status: "pending" });
    expect(s.payments.get("q1")).toMatchObject({ status: "pending", recovery: { requestId: "r1" } });
    expect(await s.executeCall({ agentId: "bookkeeper", endpointId: "ocr" })).toMatchObject({ status: "pending", reason: "payment_pending" });
    expect(s.chain.authorize).toHaveBeenCalledTimes(1);
    expect(s.fetcher).not.toHaveBeenCalled();
  });

  it("keeps a thrown/unknown submission pending rather than retrying", async () => {
    const s = setup(); s.chain.authorize.mockRejectedValue(new Error("timeout"));
    expect(await s.executeCall({ agentId: "bookkeeper", endpointId: "ocr" })).toMatchObject({ status: "pending", reason: "submission_unknown" });
    expect(s.payments.get("q1")?.status).toBe("pending");
    expect(s.quotes.get("q1")?.status).toBe("issued");
  });

  it("records definitive chain failure and retains payment success if provider fails", async () => {
    const failed = setup(); failed.chain.authorize.mockResolvedValue({ status: "FAILED", hash: HASH, innerHash: INNER, transport: "relayer", error: "onchain_failed" });
    expect(await failed.executeCall({ agentId: "bookkeeper", endpointId: "ocr" })).toMatchObject({ status: "blocked", reason: "onchain_failed" });
    expect(failed.payments.get("q1")?.status).toBe("failed");
    expect(failed.quotes.get("q1")?.status).toBe("failed");
    const paid = setup(); paid.endpoint.url = "https://provider.example/ocr";
    paid.fetcher.mockRejectedValue(new Error("timeout"));
    expect(await paid.executeCall({ agentId: "bookkeeper", endpointId: "ocr" })).toMatchObject({ status: "paid", providerError: "provider_unavailable" });
    expect(paid.payments.get("q1")?.status).toBe("paid");
  });
});

describe("broker payment verification", () => {
  it("consumes a proof once when two provider verifications arrive concurrently", async () => {
    const s = setup(); await s.executeCall({ agentId: "bookkeeper", endpointId: "ocr" });
    const params = { proof: { quoteId: "q1", kind: "tx" as const, txHash: HASH }, endpointId: "ocr" };
    const outcomes = await Promise.all([s.verifyPayment(params), s.verifyPayment(params)]);
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(outcomes.filter((outcome) => !outcome.ok)).toEqual([{ ok: false, error: "quote_already_used" }]);
  });

  it("accepts a matching confirmed payment once and rejects replay or other endpoint use", async () => {
    const s = setup(); await s.executeCall({ agentId: "bookkeeper", endpointId: "ocr" });
    const proof = { quoteId: "q1", kind: "tx" as const, txHash: HASH };
    expect(await s.verifyPayment({ proof, endpointId: "different" })).toMatchObject({ ok: false });
    expect(await s.verifyPayment({ proof, endpointId: "ocr" })).toMatchObject({ ok: true, receipt: { txHash: HASH } });
    expect(await s.verifyPayment({ proof, endpointId: "ocr" })).toMatchObject({ ok: false, error: "quote_already_used" });
    expect(s.chain.readAuthorizeTx).not.toHaveBeenCalled();
  });

  it("validates every on-chain field including device and rejects a mismatch", async () => {
    const s = setup(); await s.createQuote({ endpointId: "ocr" });
    const q = s.quotes.get("q1")!;
    const args = { agent: s.agent.agentPublic, deviceHash: s.agent.deviceHash, merchant: q.merchant, asset: q.asset, amount: q.amount, nonce: q.nonce };
    for (const field of ["agent", "deviceHash", "merchant", "asset", "amount", "nonce"] as const) {
      s.chain.readAuthorizeTx.mockResolvedValue({ ok: true, args: { ...args, [field]: typeof args[field] === "bigint" ? 999n : "different" } });
      expect(await s.verifyPayment({ proof: { kind: "tx", quoteId: q.id, txHash: HASH } })).toMatchObject({ ok: false });
    }
    s.chain.readAuthorizeTx.mockResolvedValue({ ok: true, args });
    expect(await s.verifyPayment({ proof: { kind: "tx", quoteId: q.id, txHash: HASH } })).toMatchObject({ ok: true });
    expect(s.quotes.get(q.id)?.status).toBe("verified");
  });

  it("rejects expired unpaid quotes, failed chain observations, and reused transaction hashes", async () => {
    const s = setup(); await s.createQuote({ endpointId: "ocr" });
    const q = s.quotes.get("q1")!; q.expiresAt = new Date(NOW.getTime() - 1);
    expect(await s.verifyPayment({ proof: { kind: "tx", quoteId: q.id, txHash: HASH } })).toMatchObject({ ok: false, error: "quote_expired" });
    q.expiresAt = new Date(NOW.getTime() + 1000);
    s.chain.readAuthorizeTx.mockResolvedValue({ ok: false });
    expect(await s.verifyPayment({ proof: { kind: "tx", quoteId: q.id, txHash: HASH } })).toMatchObject({ ok: false });
    s.payments.set("other", { id: "other", quoteId: "other", kind: "tx", status: "paid", txHash: HASH });
    expect(await s.verifyPayment({ proof: { kind: "tx", quoteId: q.id, txHash: HASH } })).toMatchObject({ ok: false, error: "transaction_already_used" });
  });
});
