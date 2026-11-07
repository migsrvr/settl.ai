// @vitest-environment node
import { Keypair } from "@stellar/stellar-sdk";
import type { PrismaClient } from "../generated/prisma/client";
import { describe, expect, it, vi } from "vitest";
import { createProvisioningService } from "./agent-provisioning";

const NOW = new Date("2026-11-07T00:00:00Z");
const success = { status: "SUCCESS" as const, hash: "ab".repeat(32), innerHash: "ab".repeat(32), transport: "velo" as const };
function setup() {
  const owner = Keypair.random(); const signer = Keypair.random();
  let time = NOW.getTime();
  const agent = { id: "agent", orgId: "buyer", agentPublic: signer.publicKey(), agentSecretEnc: signer.secret(), deviceHash: "dd".repeat(32), status: "provisioning", lifecycleRecovery: { version: 1, operation: "create", stage: "queued", state: "working", updatedAt: NOW.toISOString(), transactions: [] } as Record<string, unknown>, org: { id: "buyer", role: "buyer", walletPublic: owner.publicKey(), walletSecretEnc: owner.secret() }, policy: { maxAmount: 100n, asset: "asset", expiresAt: new Date("2026-12-31") } };
  const db = {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => strings.join("").includes("automaticRecoveryBlocked") ? [{ id: agent.id }] : []),
    agent: {
      findUnique: vi.fn(async () => structuredClone(agent)),
      findMany: vi.fn(async (args: { where?: { orgId?: string } }) => args.where?.orgId ? [{ id: agent.id, lifecycleRecovery: structuredClone(agent.lifecycleRecovery) }] : [{ id: agent.id }]),
      updateMany: vi.fn(async ({ where, data }: { where: { lifecycleRecovery: { equals: unknown } }; data: Record<string, unknown> }) => {
        if (JSON.stringify(agent.lifecycleRecovery) !== JSON.stringify(where.lifecycleRecovery.equals)) return { count: 0 };
        Object.assign(agent, structuredClone(data)); return { count: 1 };
      }),
    },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation(async (fn) => fn(db));
  const chain = { registerDevice: vi.fn().mockResolvedValue(success), registerAgent: vi.fn().mockResolvedValue(success) };
  const ensureAccount = vi.fn().mockResolvedValue(undefined);
  const reconcile = vi.fn().mockResolvedValue(success);
  const createChain = vi.fn(() => chain);
  const service = createProvisioningService({ db: db as unknown as PrismaClient, createChain, reconcile, ensureAccount, decrypt: (v) => v, now: () => new Date(time), jobTimeoutMs: 1000 });
  return { ...service, agent, db, chain, createChain, ensureAccount, reconcile, advance: (ms: number) => { time += ms; } };
}
describe("durable agent provisioning", () => {
  it("prepares both wallets concurrently, registers in order and persists completed stages", async () => {
    const s = setup(); let checks = 0;
    s.ensureAccount.mockImplementation(async () => { checks++; await Promise.resolve(); expect(checks).toBe(2); });
    s.chain.registerDevice.mockImplementation(async () => {
      expect(s.agent.lifecycleRecovery).toMatchObject({ stage: "register_device", state: "pending" }); return success;
    });
    s.chain.registerAgent.mockImplementation(async () => {
      expect(s.agent.lifecycleRecovery.transactions).toEqual([expect.objectContaining({ stage: "register_device", status: "SUCCESS" })]); return success;
    });
    await s.provisionAgent("agent");
    expect(s.agent).toMatchObject({ status: "active", lifecycleRecovery: { stage: "complete", state: "complete" } });
    expect(s.chain.registerDevice.mock.invocationCallOrder[0]).toBeLessThan(s.chain.registerAgent.mock.invocationCallOrder[0]);
  });
  it("does not replay legacy creation checkpoints", async () => {
    const s = setup(); s.agent.lifecycleRecovery = { operation: "create", stage: "accounts", state: "working" };
    await s.provisionAgent("agent"); expect(s.ensureAccount).not.toHaveBeenCalled(); expect(s.createChain).not.toHaveBeenCalled();
  });
  it.each(["complete", "register_policy"])("fails closed for an inconsistent %s checkpoint", async (stage) => {
    const s = setup(); s.agent.lifecycleRecovery.stage = stage;
    await s.provisionAgent("agent"); expect(s.createChain).not.toHaveBeenCalled(); expect(s.reconcile).not.toHaveBeenCalled();
    expect(s.agent).toMatchObject({ status: "provisioning", lifecycleRecovery: { state: "pending", automaticRecoveryBlocked: true, needsReview: true, errorCode: "invalid_provisioning_checkpoint" } });
  });
  it("does not overwrite a successor while marking an invalid checkpoint", async () => {
    const s = setup(); s.agent.lifecycleRecovery.stage = "complete";
    s.db.agent.updateMany.mockResolvedValueOnce({ count: 0 });
    const initial = structuredClone(s.agent);
    await s.provisionAgent("agent"); expect(s.agent).toEqual(initial); expect(s.createChain).not.toHaveBeenCalled();
  });
  it.each(["failed", "complete"])("review-blocks terminal %s checkpoints inconsistent with provisioning status", async (state) => {
    const s = setup();
    s.agent.lifecycleRecovery = state === "failed"
      ? { ...s.agent.lifecycleRecovery, state }
      : { ...s.agent.lifecycleRecovery, stage: "complete", state, transactions: [{ ...success, stage: "register_device" }, { ...success, stage: "register_policy" }] };
    await s.provisionAgent("agent");
    expect(s.agent).toMatchObject({ status: "provisioning", lifecycleRecovery: { state: "pending", automaticRecoveryBlocked: true, needsReview: true } });
    expect(s.createChain).not.toHaveBeenCalled(); expect(s.reconcile).not.toHaveBeenCalled();
  });
  it("leaves blocked checkpoints untouched on direct invocation", async () => {
    const s = setup(); s.agent.lifecycleRecovery.automaticRecoveryBlocked = true;
    await s.provisionAgent("agent"); expect(s.db.agent.updateMany).not.toHaveBeenCalled(); expect(s.createChain).not.toHaveBeenCalled();
  });
  it("retains stored identity and never advances on a mismatched reconciliation", async () => {
    const s = setup(); s.agent.lifecycleRecovery = { ...s.agent.lifecycleRecovery, stage: "register_device", state: "pending", transactions: [{ ...success, status: "PENDING", stage: "register_device" }] };
    s.reconcile.mockResolvedValue({ ...success, innerHash: "ee".repeat(32) });
    await s.provisionAgent("agent");
    expect(s.agent.lifecycleRecovery).toMatchObject({ state: "pending", needsReview: true, errorCode: "transaction_identity_mismatch", transactions: [{ innerHash: success.innerHash, status: "PENDING" }] });
    expect(s.chain.registerAgent).not.toHaveBeenCalled();
  });
  it("fails expired queued policies before preparing accounts or registering", async () => {
    const s = setup(); s.agent.policy.expiresAt = new Date("2026-11-06");
    await s.provisionAgent("agent"); expect(s.agent).toMatchObject({ status: "error", lifecycleRecovery: { errorCode: "policy_expired", state: "failed" } });
    expect(s.ensureAccount).not.toHaveBeenCalled(); expect(s.createChain).not.toHaveBeenCalled();
  });
  it("reconciles submitted transactions even after policy expiry but does not submit the next stage", async () => {
    const s = setup(); s.agent.policy.expiresAt = new Date("2026-11-06");
    s.agent.lifecycleRecovery = { ...s.agent.lifecycleRecovery, stage: "register_device", state: "pending", transactions: [{ ...success, status: "PENDING", stage: "register_device" }] };
    await s.provisionAgent("agent"); expect(s.reconcile).toHaveBeenCalledOnce(); expect(s.chain.registerAgent).not.toHaveBeenCalled();
    expect(s.agent.lifecycleRecovery).toMatchObject({ state: "failed", errorCode: "policy_expired" });
  });
  it("does not claim a live lease", async () => {
    const s = setup(); s.agent.lifecycleRecovery.lease = { token: "other", expiresAt: new Date(NOW.getTime() + 270000).toISOString() };
    await s.provisionAgent("agent"); expect(s.ensureAccount).not.toHaveBeenCalled();
  });
  it("blocks other owner lifecycle operations, including legacy work", async () => {
    const s = setup(); s.db.agent.findMany.mockResolvedValue([{ id: "other", lifecycleRecovery: { state: "pending" } }]);
    await s.provisionAgent("agent"); expect(s.createChain).not.toHaveBeenCalled();
  });
  it("resumes account checking after an expired lease without treating it as a submission", async () => {
    const s = setup(); Object.assign(s.agent.lifecycleRecovery, { stage: "accounts", state: "pending", errorCode: "account_setup_incomplete", lease: { token: "expired", expiresAt: NOW.toISOString() } });
    await s.provisionAgent("agent"); expect(s.agent.status).toBe("active");
  });
  it("preserves pending identity, then reconciles instead of resubmitting", async () => {
    const s = setup(); s.chain.registerDevice.mockResolvedValue({ ...success, status: "PENDING" });
    await s.provisionAgent("agent"); expect(s.agent.lifecycleRecovery).toMatchObject({ state: "pending", stage: "register_device" });
    expect(s.chain.registerAgent).not.toHaveBeenCalled();
    await s.provisionAgent("agent");
    expect(s.reconcile).toHaveBeenCalledOnce(); expect(s.chain.registerDevice).toHaveBeenCalledOnce(); expect(s.agent.status).toBe("active");
  });
  it("never replays an expired financial marker without a signed identity", async () => {
    const s = setup(); Object.assign(s.agent.lifecycleRecovery, { stage: "register_device", state: "pending" });
    await s.provisionAgent("agent");
    expect(s.agent.lifecycleRecovery).toMatchObject({ state: "pending", needsReview: true, automaticRecoveryBlocked: true, errorCode: "submission_identity_missing" });
    expect(s.chain.registerDevice).not.toHaveBeenCalled(); expect(s.chain.registerAgent).not.toHaveBeenCalled();
  });
  it("does not advance a failed or still-pending reconciliation", async () => {
    const s = setup(); s.agent.lifecycleRecovery = { ...s.agent.lifecycleRecovery, stage: "register_device", state: "pending", transactions: [{ ...success, status: "PENDING", stage: "register_device" }] };
    s.reconcile.mockResolvedValue({ ...success, status: "PENDING" }); await s.provisionAgent("agent");
    expect(s.chain.registerAgent).not.toHaveBeenCalled();
    s.reconcile.mockResolvedValue({ ...success, status: "FAILED" }); await s.provisionAgent("agent");
    expect(s.agent).toMatchObject({ status: "error", lifecycleRecovery: { state: "failed" } });
  });
  it("fences a timed-out worker and prevents it advancing after its lease is replaced", async () => {
    const s = setup(); let resolve!: (value: typeof success) => void;
    s.chain.registerDevice.mockImplementation(() => new Promise((done) => { resolve = done; }));
    await s.provisionAgent("agent");
    s.advance(280000);
    await s.provisionAgent("agent");
    const checkpoint = structuredClone(s.agent.lifecycleRecovery);
    resolve(success); await new Promise((done) => setTimeout(done, 10));
    expect(s.agent.lifecycleRecovery).toEqual(checkpoint); expect(s.chain.registerAgent).not.toHaveBeenCalled();
  });
  it("refuses a checkpoint CAS race before financial submission", async () => {
    const s = setup(); s.db.agent.updateMany.mockResolvedValueOnce({ count: 0 });
    await s.provisionAgent("agent"); expect(s.createChain).not.toHaveBeenCalled();
  });
  it("reports bounded batch counts without exposing custody", async () => {
    const s = setup(); expect(await s.processAgentProvisioning()).toEqual({ processed: 1, active: 1, pending: 0, failed: 0, errors: 0 });
  });
  it("marks five invalid jobs once and reaches the next owner on the next batch", async () => {
    const s = setup();
    const rows: typeof s.agent[] = Array.from({ length: 6 }, (_, index) => ({ ...structuredClone(s.agent), id: `agent-${index}`, orgId: `org-${index}`, lifecycleRecovery: { ...structuredClone(s.agent.lifecycleRecovery), ...(index < 5 ? { stage: "complete" } : {}) } }));
    s.db.agent.findUnique.mockImplementation(async (args?: { where: { id: string } }) => structuredClone(rows.find((row) => row.id === args?.where.id)!));
    s.db.agent.findMany.mockImplementation(async (args) => rows.filter((row) => row.orgId === args.where?.orgId).map((row) => ({ id: row.id, lifecycleRecovery: structuredClone(row.lifecycleRecovery) })));
    s.db.agent.updateMany.mockImplementation(async (args) => {
      const row = rows.find((candidate) => JSON.stringify(candidate.lifecycleRecovery) === JSON.stringify(args.where.lifecycleRecovery.equals));
      if (!row) return { count: 0 }; Object.assign(row, structuredClone(args.data)); return { count: 1 };
    });
    s.db.$queryRaw.mockImplementation(async (strings) => strings.join("").includes("automaticRecoveryBlocked") ? rows.filter((row) => row.status === "provisioning" && row.lifecycleRecovery.automaticRecoveryBlocked !== true).slice(0, 5).map(({ id }) => ({ id })) : []);
    expect((await s.processAgentProvisioning()).processed).toBe(0);
    expect(rows.slice(0, 5).every((row) => row.lifecycleRecovery.automaticRecoveryBlocked === true && row.lifecycleRecovery.state === "pending")).toBe(true);
    expect(await s.processAgentProvisioning()).toMatchObject({ processed: 1, active: 1 });
    expect(rows[5].status).toBe("active");
  });
  it("excludes live leases before taking a batch so a later queued owner can progress", async () => {
    const s = setup();
    s.db.$queryRaw.mockImplementation(async (strings, ...params: unknown[]) => {
      const sql = strings.join(""); if (!sql.includes("automaticRecoveryBlocked")) return [];
      expect(sql).toContain("expiresAt"); expect(sql).toContain("COALESCE");
      expect(params).toContain(NOW.toISOString());
      // Model a DB page whose first five rows have unexpired leases; filtering
      // them in SQL must leave the later queued record inside the LIMIT.
      return [{ id: s.agent.id }];
    });
    expect(await s.processAgentProvisioning()).toMatchObject({ processed: 1, active: 1 });
  });
});
