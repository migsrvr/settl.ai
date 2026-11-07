// @vitest-environment node
import { Keypair } from "@stellar/stellar-sdk";
import type { PrismaClient } from "../generated/prisma/client";
import { describe, expect, it, vi } from "vitest";
import { createAgentService, parseAgentPolicy } from "./agents";
const NOW = new Date("2026-11-06T00:00:00Z");
const policy = { maxAmountStroops: "100", dailyBudgetStroops: "500", autoApproveUpToStroops: "50", expiresAt: "2026-12-31T00:00:00Z", allowlist: ["resibo"] };
function setup() {
  const owner = Keypair.random();
  let agent: Record<string, unknown> | null = null;
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    org: { findUnique: vi.fn().mockResolvedValue({ id: "buyer", walletPublic: owner.publicKey(), walletSecretEnc: "encrypted", role: "buyer" }) },
    provider: { findMany: vi.fn().mockResolvedValue([{ id: "resibo" }]) },
    agent: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn(async () => agent), create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => (agent = { ...data })), update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(agent!, data)) },
    policy: { upsert: vi.fn().mockResolvedValue({}) }, agentSettings: { create: vi.fn().mockResolvedValue({}) }, agentApiKey: { create: vi.fn().mockResolvedValue({}), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    payment: { findFirst: vi.fn().mockResolvedValue(null) }, reservation: { findFirst: vi.fn().mockResolvedValue(null) }, topup: { findFirst: vi.fn().mockResolvedValue(null) },
  };
  const db = { ...tx, $transaction: vi.fn(async (work: (store: typeof tx) => Promise<unknown>) => work(tx)) };
  const success = { status: "SUCCESS" as const, hash: "ab".repeat(32), innerHash: "ab".repeat(32), transport: "velo" as const };
  const chain = { registerDevice: vi.fn().mockResolvedValue(success), registerAgent: vi.fn().mockResolvedValue(success), revokeAgent: vi.fn().mockResolvedValue(success), getPolicy: vi.fn().mockResolvedValue(null), revokeAndSweep: vi.fn().mockResolvedValue({ status: "SUCCESS", transactions: [success] }) };
  const ensureAccount = vi.fn().mockResolvedValue(undefined);
  const service = createAgentService({ db: db as unknown as PrismaClient, chain, ensureAccount, encrypt: () => "encrypted-agent", decrypt: () => owner.secret(), now: () => NOW });
  return { ...service, tx, chain, ensureAccount, agent: () => agent };
}
describe("buyer agent lifecycle", () => {
  it("permits an empty provider allowlist so every provider is blocked", () => {
    expect(parseAgentPolicy({ ...policy, allowlist: [] }, NOW).allowlist).toEqual([]);
  });
  it("queues encrypted custody and a hashed one-time key without account or chain calls", async () => {
    const s = setup(); const result = await s.createAgent("buyer", { ...policy, name: "Bookkeeper 2" });
    expect(result.status).toBe("provisioning"); expect(result.apiKey).toMatch(/^stl_agent_/);
    expect(s.chain.registerDevice).not.toHaveBeenCalled(); expect(s.chain.registerAgent).not.toHaveBeenCalled();
    expect(s.ensureAccount).not.toHaveBeenCalled();
    expect(s.agent()).toMatchObject({ status: "provisioning", agentSecretEnc: "encrypted-agent", lifecycleRecovery: { version: 1, operation: "create", stage: "queued", state: "working", updatedAt: NOW.toISOString(), transactions: [] } });
    expect(s.agent()?.cachedBalance).toBeUndefined(); expect(s.agent()?.balanceUpdatedAt).toBeUndefined();
    expect(JSON.stringify(s.tx.agentApiKey.create.mock.calls)).not.toContain(result.apiKey!);
  });
  it("skips provider table lookup when allowlist is empty", async () => {
    const s = setup();
    expect((await s.createAgent("buyer", { ...policy, allowlist: [], name: "No Providers" })).status).toBe("provisioning");
    expect(s.tx.provider.findMany).not.toHaveBeenCalled();
  });
  it("retains the transport and Velo reconciliation identity for pending revocation", async () => {
    const s = setup(); const created = await s.createAgent("buyer", { ...policy, name: "Active" });
    s.chain.revokeAndSweep.mockResolvedValue({ status: "PENDING", transactions: [{ status: "PENDING", hash: "cd".repeat(32), innerHash: "ef".repeat(32), transport: "velo", recovery: { requestId: "gas-request", transactionHash: "ef".repeat(32) } }] });
    expect(await s.revoke("buyer", created.agentId)).toMatchObject({ status: "pending" });
    expect(s.agent()?.lifecycleRecovery).toMatchObject({ state: "pending", transport: "velo", recovery: { requestId: "gas-request" } });
  });
  it("blocks an owner with unresolved lifecycle work before creating another agent", async () => {
    const s = setup(); s.tx.agent.findMany.mockResolvedValue([{ lifecycleRecovery: { state: "pending" } }]);
    await expect(s.createAgent("buyer", { ...policy, name: "Other" })).rejects.toMatchObject({ code: "owner_operation_pending" });
    expect(s.tx.agent.create).not.toHaveBeenCalled();
  });
  it("does not revoke while a payment is unresolved", async () => {
    const s = setup(); const created = await s.createAgent("buyer", { ...policy, name: "Active" });
    s.tx.payment.findFirst.mockResolvedValue({ id: "pending" });
    await expect(s.revoke("buyer", created.agentId)).rejects.toMatchObject({ code: "agent_operation_pending" });
    expect(s.chain.revokeAndSweep).not.toHaveBeenCalled();
  });
  it("blocks policy replacement while a top-up is outstanding", async () => {
    const s = setup(); const created = await s.createAgent("buyer", { ...policy, name: "Active" });
    s.tx.topup.findFirst.mockResolvedValue({ id: "checkout" });
    await expect(s.updatePolicy("buyer", created.agentId, policy)).rejects.toMatchObject({ code: "agent_operation_pending" });
    expect(s.chain.revokeAgent).not.toHaveBeenCalled();
  });
  it("revokes an existing policy before registering its replacement", async () => {
    const s = setup(); const created = await s.createAgent("buyer", { ...policy, name: "Active" });
    s.chain.getPolicy.mockResolvedValue({ maxAmount: 100n }); s.chain.registerAgent.mockClear();
    expect(await s.updatePolicy("buyer", created.agentId, policy)).toEqual({ status: "active" });
    expect(s.chain.revokeAgent.mock.invocationCallOrder[0]).toBeLessThan(s.chain.registerAgent.mock.invocationCallOrder[0]);
  });
  it.each([{ ...policy, maxAmountStroops: "0" }, { ...policy, autoApproveUpToStroops: "101" }, { ...policy, expiresAt: "2000-01-01" }, { ...policy, allowlist: [7] }])("validates policy input before chain activity", (body) => { expect(() => parseAgentPolicy(body, NOW)).toThrow(); });
});
