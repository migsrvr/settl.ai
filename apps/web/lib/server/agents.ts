import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Keypair, rpc } from "@stellar/stellar-sdk";
import { createStellarClient, deviceHashForAgent, fundTestnetAccount, loadStellarConfig, TESTNET_XLM } from "@settl/stellar";
import type { NoirClient, TxResult } from "@settl/stellar";
import type { Prisma, PrismaClient } from "../generated/prisma/client";
import { ApiError, isObject } from "./api-auth";
import { getDb } from "./db";
import { decryptWalletSecret, encryptWalletSecret } from "./wallets";

export function parseAgentPolicy(body: Record<string, unknown>, now = new Date()) {
  const amount = (value: unknown, zero = false) => {
    if (typeof value !== "string" || !/^\d{1,19}$/.test(value)) throw new ApiError(400, "invalid_policy_amount");
    const parsed = BigInt(value);
    if (parsed < (zero ? 0n : 1n) || parsed > (1n << 63n) - 1n) throw new ApiError(400, "invalid_policy_amount");
    return parsed;
  };
  const maxAmount = amount(body.maxAmountStroops), dailyBudget = amount(body.dailyBudgetStroops), autoApproveUpTo = amount(body.autoApproveUpToStroops, true);
  const expiresAt = typeof body.expiresAt === "string" ? new Date(body.expiresAt) : new Date(NaN);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now || autoApproveUpTo > maxAmount || autoApproveUpTo > dailyBudget || !Array.isArray(body.allowlist) || body.allowlist.length > 100 || !body.allowlist.every((id) => typeof id === "string" && id.length > 0 && id.length <= 256)) throw new ApiError(400, "invalid_policy");
  return { maxAmount, dailyBudget, maxPricePerCall: maxAmount, autoApproveUpTo, expiresAt, allowlist: [...new Set(body.allowlist as string[])], asset: TESTNET_XLM };
}
type Policy = ReturnType<typeof parseAgentPolicy>;
type Chain = Pick<NoirClient, "registerDevice" | "registerAgent" | "revokeAgent" | "revokeAndSweep" | "getPolicy">;
interface Options { db: PrismaClient; chain: Chain; ensureAccount: (publicKey: string) => Promise<void>; encrypt?: (secret: string) => string; decrypt?: (secret: string) => string; now?: () => Date }
export function createAgentService(options: Options) {
  const { db, chain } = options;
  const now = options.now ?? (() => new Date());
  const encrypt = options.encrypt ?? encryptWalletSecret, decrypt = options.decrypt ?? decryptWalletSecret;
  async function ownerLane(tx: Prisma.TransactionClient, orgId: string) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`settl:owner:${orgId}`}))::text`;
    const org = await tx.org.findUnique({ where: { id: orgId } });
    if (!org || org.role !== "buyer") throw new ApiError(403, "buyer_org_unavailable");
    const jobs = await tx.agent.findMany({ where: { orgId }, select: { lifecycleRecovery: true } });
    if (jobs.some((job) => isObject(job.lifecycleRecovery) && ["working", "pending"].includes(String(job.lifecycleRecovery.state)))) throw new ApiError(409, "owner_operation_pending");
    const owner = Keypair.fromSecret(decrypt(org.walletSecretEnc));
    if (owner.publicKey() !== org.walletPublic) throw new ApiError(503, "wallet_identity_mismatch");
    return owner;
  }
  async function knownProviders(tx: Prisma.TransactionClient, policy: Policy) {
    if (!policy.allowlist.length) return;
    const rows = await tx.provider.findMany({ where: { id: { in: policy.allowlist } }, select: { id: true } });
    if (rows.length !== policy.allowlist.length) throw new ApiError(400, "unknown_provider");
  }
  async function saveStep(agentId: string, operation: string, stage: string, result?: TxResult) {
    const state = !result || result.status === "SUCCESS" ? "working" : result.status === "PENDING" ? "pending" : "failed";
    await db.agent.update({ where: { id: agentId }, data: {
      status: state === "failed" ? "error" : "provisioning",
      lifecycleRecovery: { operation, stage, state, ...(result ? { hash: result.hash, innerHash: result.innerHash, transport: result.transport, ...(result.recovery ? { recovery: { ...result.recovery } } : {}) } : {}) },
    } });
  }
  async function perform(agentId: string, operation: string, stage: string, action: () => Promise<TxResult>) {
    await saveStep(agentId, operation, stage);
    let result: TxResult | undefined;
    try { result = await action(); await saveStep(agentId, operation, stage, result); return result; }
    catch {
      await db.agent.update({ where: { id: agentId }, data: { status: "provisioning", lifecycleRecovery: { operation, stage, state: "pending", error: "submission_unknown", ...(result ? { hash: result.hash, innerHash: result.innerHash, transport: result.transport, ...(result.recovery ? { recovery: { ...result.recovery } } : {}) } : {}) } } });
      return null;
    }
  }
  async function createAgent(orgId: string, body: Record<string, unknown>) {
    if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 120) throw new ApiError(400, "invalid_agent_name");
    const policy = parseAgentPolicy(body, now());
    const id = randomUUID(), signer = Keypair.random(), apiKey = `stl_agent_${randomBytes(32).toString("hex")}`;
    await db.$transaction(async (tx) => {
      await ownerLane(tx, orgId); await knownProviders(tx, policy);
      await tx.agent.create({ data: { id, orgId, name: (body.name as string).trim(), agentPublic: signer.publicKey(), agentSecretEnc: encrypt(signer.secret()), deviceHash: deviceHashForAgent(id), status: "provisioning", lifecycleRecovery: { version: 1, operation: "create", stage: "queued", state: "working", updatedAt: now().toISOString(), transactions: [] } } });
      await tx.policy.upsert({ where: { agentId: id }, update: {}, create: { agentId: id, ...policy } });
      await tx.agentSettings.create({ data: { agentId: id, lowBudgetAlert: policy.maxAmount } });
      await tx.agentApiKey.create({ data: { agentId: id, name: "Initial agent key", keyHash: createHash("sha256").update(apiKey).digest("hex") } });
    });
    return { agentId: id, status: "provisioning" as const, apiKey };
  }
  async function prepareExisting(orgId: string, agentId: string, operation: "policy" | "revoke", policy?: Policy) {
    return db.$transaction(async (tx) => {
      const owner = await ownerLane(tx, orgId);
      await tx.$queryRaw`SELECT id FROM "agents" WHERE id = ${agentId} FOR UPDATE`;
      const agent = await tx.agent.findFirst({ where: { id: agentId, orgId } });
      if (!agent || agent.status === "revoked") throw new ApiError(404, "agent_not_found");
      if (await tx.payment.findFirst({ where: { status: "pending", quote: { agentId } } }) || await tx.reservation.findFirst({ where: { agentId, status: "held" } }) || await tx.topup.findFirst({ where: { agentId, status: { in: ["pending", "paid", "funding"] } } })) throw new ApiError(409, "agent_operation_pending");
      if (policy) await knownProviders(tx, policy);
      await tx.agent.update({ where: { id: agentId }, data: { status: "provisioning", lifecycleRecovery: { operation, stage: "start", state: "working" } } });
      return { agent, owner };
    });
  }
  async function revoke(orgId: string, agentId: string) {
    const { agent, owner } = await prepareExisting(orgId, agentId, "revoke");
    let outcome: Awaited<ReturnType<Chain["revokeAndSweep"]>>;
    try { outcome = await chain.revokeAndSweep(owner, agent.deviceHash); }
    catch { await saveStep(agentId, "revoke", "unknown"); await db.agent.update({ where: { id: agentId }, data: { lifecycleRecovery: { operation: "revoke", stage: "unknown", state: "pending" } } }); return { status: "pending" as const }; }
    const last = outcome.transactions.at(-1);
    const identity = last ? { hash: last.hash, innerHash: last.innerHash, transport: last.transport, ...(last.recovery ? { recovery: { ...last.recovery } } : {}) } : {};
    const transactions = outcome.transactions.map((result) => ({ status: result.status, hash: result.hash, innerHash: result.innerHash, transport: result.transport, ...(result.recovery ? { recovery: { ...result.recovery } } : {}) }));
    try {
      await db.$transaction(async (tx) => {
        await tx.agent.update({ where: { id: agentId }, data: { status: outcome.status === "SUCCESS" ? "revoked" : outcome.status === "FAILED" ? "error" : "provisioning", lifecycleRecovery: { operation: "revoke", state: outcome.status === "PENDING" ? "pending" : outcome.status === "FAILED" ? "failed" : "complete", ...identity, transactions }, ...(outcome.status === "SUCCESS" ? { cachedBalance: 0n, balanceUpdatedAt: now() } : {}) } });
        if (outcome.status === "SUCCESS") await tx.agentApiKey.updateMany({ where: { agentId, revokedAt: null }, data: { revokedAt: now() } });
      });
    } catch {
      try { await db.agent.update({ where: { id: agentId }, data: { status: "provisioning", lifecycleRecovery: { operation: "revoke", state: "pending", error: "persistence_unresolved", ...identity, transactions } } }); } catch { /* The pre-submission working marker still blocks writes. */ }
      return { status: "pending" as const, ...(last ? { txHash: last.hash } : {}) };
    }
    return { status: outcome.status === "SUCCESS" ? "revoked" as const : outcome.status === "FAILED" ? "failed" as const : "pending" as const, ...(last ? { txHash: last.hash } : {}) };
  }
  async function updatePolicy(orgId: string, agentId: string, body: Record<string, unknown>) {
    const policy = parseAgentPolicy(body, now());
    const { agent, owner } = await prepareExisting(orgId, agentId, "policy", policy);
    // Revoke first, then register the replacement; do not assume the registry
    // supports overwriting an existing policy in register_agent.
    let current: Awaited<ReturnType<Chain["getPolicy"]>>;
    try { current = await chain.getPolicy(agent.deviceHash); }
    catch { await db.agent.update({ where: { id: agentId }, data: { status: agent.status, lifecycleRecovery: { operation: "policy", stage: "read", state: "failed" } } }); throw new ApiError(503, "policy_unavailable"); }
    if (current) { const removed = await perform(agentId, "policy", "revoke_policy", () => chain.revokeAgent(owner, agent.deviceHash)); if (!removed || removed.status !== "SUCCESS") return { status: removed?.status === "FAILED" ? "failed" as const : "pending" as const }; }
    const registered = await perform(agentId, "policy", "register_policy", () => chain.registerAgent(owner, { deviceHash: agent.deviceHash, agent: agent.agentPublic, maxAmount: policy.maxAmount, asset: policy.asset, expiresAt: BigInt(Math.floor(policy.expiresAt.getTime() / 1000)) }));
    if (!registered || registered.status !== "SUCCESS") return { status: registered?.status === "FAILED" ? "failed" as const : "pending" as const };
    await db.$transaction(async (tx) => { await tx.policy.upsert({ where: { agentId }, update: policy, create: { agentId, ...policy } }); await tx.agent.update({ where: { id: agentId }, data: { status: "active", lifecycleRecovery: { operation: "policy", state: "complete" } } }); });
    return { status: "active" as const };
  }
  return { createAgent, revoke, updatePolicy };
}
let singleton: ReturnType<typeof createAgentService> | undefined;
function service() {
  if (!singleton) {
    const config = loadStellarConfig(); const secret = process.env.SETTL_RELAYER_SECRET || process.env.SETTL_TREASURY_SECRET;
    const relayer = secret ? Keypair.fromSecret(secret) : undefined;
    const fresh = () => createStellarClient(config, relayer ? { relayer } : {});
    const reader = fresh(), server = new rpc.Server(config.rpcUrl);
    singleton = createAgentService({ db: getDb(), chain: { registerDevice: (...args) => fresh().registerDevice(...args), registerAgent: (...args) => fresh().registerAgent(...args), revokeAgent: (...args) => fresh().revokeAgent(...args), revokeAndSweep: (...args) => fresh().revokeAndSweep(...args), getPolicy: reader.getPolicy }, ensureAccount: async (publicKey) => {
      try { await server.getAccount(publicKey); return; } catch { /* Check Friendbot, then confirm existence. */ }
      try { await fundTestnetAccount(publicKey); } catch { await server.getAccount(publicKey); }
    } });
  }
  return singleton;
}
export function createAgent(orgId: string, body: Record<string, unknown>) { return service().createAgent(orgId, body); }
export function revokeAgent(orgId: string, agentId: string) { return service().revoke(orgId, agentId); }
export function updateAgentPolicy(orgId: string, agentId: string, body: Record<string, unknown>) { return service().updatePolicy(orgId, agentId, body); }
