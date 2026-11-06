// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import type { PrismaClient } from "../generated/prisma/client";
import { createClaims } from "./claims";

function setup() {
  const signer = Keypair.random();
  const provider = { id: "p", orgId: "seller", merchantWallet: signer.publicKey(), org: { walletSecretEnc: "encrypted" }, settings: { autoClaimEnabled: true, autoClaimThreshold: 10n } };
  const rows: { id: string; status: string; [key: string]: unknown }[] = [];
  const tx = { $queryRaw: vi.fn().mockResolvedValue([]), provider: { findUnique: vi.fn(async () => provider), findMany: vi.fn().mockResolvedValue([{ id: "p" }]) }, claim: {
    findFirst: vi.fn(async () => rows.find((r) => r.status === "pending") ?? null),
    create: vi.fn(async ({ data }: { data: object }) => { const row = { id: "c", status: "pending", ...data }; rows.push(row); return row; }),
    update: vi.fn(async ({ data }: { data: object }) => Object.assign(rows[0], data)),
  }, webhookEvent: { upsert: vi.fn().mockResolvedValue({}) } };
  let queue = Promise.resolve();
  const db = { ...tx, $transaction: vi.fn((work: (transaction: typeof tx) => Promise<unknown>) => { const result = queue.then(() => work(tx)); queue = result.then(() => {}, () => {}); return result; }) };
  const chain = { pendingBalance: vi.fn().mockResolvedValue(10n), claim: vi.fn().mockResolvedValue({ status: "SUCCESS", hash: "ab".repeat(32), innerHash: "cd".repeat(32), transport: "velo" }) };
  const service = createClaims({ db: db as unknown as PrismaClient, chain, decrypt: () => signer.secret() });
  return { ...service, tx, db, provider, rows, chain };
}

describe("custodial auto claims", () => {
  it("allows an authenticated manual claim below the automatic threshold or when automation is disabled", async () => {
    const s = setup(); s.provider.settings.autoClaimEnabled = false; s.chain.pendingBalance.mockResolvedValue(1n);
    expect(await s.claimProvider("p", { manual: true })).toMatchObject({ status: "completed", amountStroops: "1" });
    expect(s.chain.claim).toHaveBeenCalledOnce();
  });
  it("persists a pending claim before submission, signed by the merchant", async () => {
    const s = setup();
    s.chain.claim.mockImplementationOnce(async (signer: Keypair) => {
      expect(s.rows[0]).toMatchObject({ status: "pending", amount: 10n });
      expect(signer.publicKey()).toBe(s.provider.merchantWallet);
      return { status: "SUCCESS", hash: "ab".repeat(32) };
    });
    expect(await s.claimProvider("p")).toMatchObject({ status: "completed", claimId: "c", amountStroops: "10" });
    expect(s.rows[0].claimedAt).toBeInstanceOf(Date);
    expect(s.tx.webhookEvent.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ source: "settl", eventId: "claim:c:completed", payload: expect.objectContaining({ orgIds: ["seller"], event: "claim.completed" }) }) }));
  });
  it.each([0n, 9n])("skips a live pending balance of %s below threshold", async (balance) => {
    const s = setup(); s.chain.pendingBalance.mockResolvedValue(balance);
    expect(await s.claimProvider("p")).toMatchObject({ status: "skipped" });
    expect(s.chain.claim).not.toHaveBeenCalled();
  });
  it("skips disabled settings and rejects mismatched custodial wallets", async () => {
    const s = setup(); s.provider.settings.autoClaimEnabled = false;
    expect(await s.claimProvider("p")).toMatchObject({ status: "skipped" });
    s.provider.settings.autoClaimEnabled = true; s.provider.merchantWallet = Keypair.random().publicKey();
    expect(await s.claimProvider("p")).toMatchObject({ status: "failed" });
    expect(s.chain.claim).not.toHaveBeenCalled();
  });
  it("serializes concurrent invocations and preserves uncertain submissions", async () => {
    const s = setup(); s.chain.claim.mockRejectedValue(new Error("secret transport detail"));
    const results = await Promise.all([s.claimProvider("p"), s.claimProvider("p")]);
    expect(results.every((r) => r.status === "pending")).toBe(true);
    expect(s.chain.claim).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(results)).not.toContain("secret");
    expect(s.rows[0].status).toBe("pending");
  });
  it("preserves pending hashes and recovery, and marks only known failures failed", async () => {
    const s = setup();
    s.chain.claim.mockResolvedValueOnce({ status: "PENDING", hash: "ab".repeat(32), recovery: { executionId: "execution" } });
    expect(await s.claimProvider("p")).toMatchObject({ status: "pending", txHash: "ab".repeat(32) });
    expect(s.rows[0].recovery).toMatchObject({ executionId: "execution" });
    const failed = setup(); failed.chain.claim.mockResolvedValueOnce({ status: "FAILED", hash: "", error: "secret" });
    expect(await failed.claimProvider("p")).toMatchObject({ status: "failed" });
    expect(failed.rows[0].status).toBe("failed");
  });
  it("returns an observed transaction hash when result persistence fails, without resubmitting", async () => {
    const s = setup(); s.chain.claim.mockResolvedValueOnce({ status: "PENDING", hash: "ab".repeat(32) });
    s.tx.claim.update.mockRejectedValueOnce(new Error("database secret"));
    expect(await s.claimProvider("p")).toMatchObject({ status: "pending", txHash: "ab".repeat(32) });
    await s.claimProvider("p"); expect(s.chain.claim).toHaveBeenCalledTimes(1);
  });
});
