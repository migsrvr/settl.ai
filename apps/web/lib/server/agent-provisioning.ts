import { randomUUID } from "node:crypto";
import { Keypair, rpc } from "@stellar/stellar-sdk";
import { createStellarClient, fundTestnetAccount, loadStellarConfig } from "@settl/stellar";
import type { NoirClient, TxResult } from "@settl/stellar";
import type { Prisma, PrismaClient } from "../generated/prisma/client";
import { isObject } from "./api-auth";
import { getDb } from "./db";
import { createProvisioningSubmitter } from "./provisioning-submitter";
import { decryptWalletSecret } from "./wallets";
import { createTimingTracker } from "./timing";
import { readProvisioningCheckpoint } from "./agent-provisioning-checkpoint";
import type { Entry, FinancialStage, ProvisioningCheckpoint } from "./agent-provisioning-checkpoint";

interface Options {
  db: PrismaClient;
  createChain: (checkpoint: (result: TxResult) => Promise<void>) => Pick<NoirClient, "registerDevice" | "registerAgent">;
  reconcile: (result: TxResult) => Promise<TxResult>;
  ensureAccount: (publicKey: string) => Promise<void>;
  decrypt?: (secret: string) => string;
  now?: () => Date;
  jobTimeoutMs?: number;
  batchSize?: number;
  batchStartBudgetMs?: number;
}
const LEASE_MS = 270_000;
const JOB_MS = 220_000;
function json(value: ProvisioningCheckpoint) { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue; }

export function createProvisioningService(options: Options) {
  const { db } = options;
  const now = options.now ?? (() => new Date());
  const decrypt = options.decrypt ?? decryptWalletSecret;
  const timeoutMs = Math.min(options.jobTimeoutMs ?? JOB_MS, JOB_MS);
  async function claim(agentId: string) {
    return db.$transaction(async (tx) => {
      const initial = await tx.agent.findUnique({ where: { id: agentId }, select: { orgId: true } });
      if (!initial) return null;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`settl:owner:${initial.orgId}`}))::text`;
      await tx.$queryRaw`SELECT id FROM "agents" WHERE id = ${agentId} FOR UPDATE`;
      const agent = await tx.agent.findUnique({ where: { id: agentId }, include: { org: true, policy: true } });
      if (!agent || agent.status !== "provisioning") return null;
      const raw = agent.lifecycleRecovery;
      if (!isObject(raw) || raw.version !== 1 || raw.automaticRecoveryBlocked === true) return null;
      const recovery = readProvisioningCheckpoint(agent.lifecycleRecovery);
      if (!recovery || !["working", "pending"].includes(recovery.state) || agent.org.role !== "buyer" || !agent.policy) {
        // Preserve the original evidence and owner blocker. Malformed versioned
        // records need explicit review, not repeated automatic batch attempts.
        await tx.agent.updateMany({ where: { id: agentId, status: "provisioning", lifecycleRecovery: { equals: raw } }, data: {
          lifecycleRecovery: { ...raw, state: "pending", automaticRecoveryBlocked: true, needsReview: true, errorCode: "invalid_provisioning_checkpoint", updatedAt: now().toISOString() },
        } });
        return null;
      }
      // A malformed lease is unresolved too; never silently steal it.
      if (recovery.lease && (!Number.isFinite(Date.parse(recovery.lease.expiresAt)) || Date.parse(recovery.lease.expiresAt) > now().getTime())) return null;
      const siblings = await tx.agent.findMany({ where: { orgId: agent.orgId }, select: { id: true, lifecycleRecovery: true } });
      if (siblings.some((sibling) => sibling.id !== agentId && isObject(sibling.lifecycleRecovery) && ["working", "pending"].includes(String(sibling.lifecycleRecovery.state)))) return null;
      const checkpoint: ProvisioningCheckpoint = { ...recovery, lease: { token: randomUUID(), expiresAt: new Date(now().getTime() + LEASE_MS).toISOString() }, updatedAt: now().toISOString() };
      const changed = await tx.agent.updateMany({ where: { id: agentId, status: "provisioning", lifecycleRecovery: { equals: agent.lifecycleRecovery! } }, data: { lifecycleRecovery: json(checkpoint) } });
      return changed.count === 1 ? { agent, checkpoint } : null;
    });
  }
  async function provisionAgent(agentId: string) {
    const timing = createTimingTracker("agent.provisioning");
    let claimed: Awaited<ReturnType<typeof claim>>;
    try { claimed = await timing.measure("db", () => claim(agentId)); }
    catch { timing.finish("error", { stage: "claim" }); throw new Error("provisioning_claim_failed"); }
    if (!claimed) { timing.finish("skipped"); return { status: "skipped" as const }; }
    const { agent } = claimed;
    let current = claimed.checkpoint;
    let cancelled = false;
    const startedAt = Date.now();
    async function save(next: ProvisioningCheckpoint, release = false) {
      if (cancelled || Date.now() - startedAt >= timeoutMs || !current.lease || Date.parse(current.lease.expiresAt) <= now().getTime()) throw new Error("provisioning_lease_lost");
      const updated = { ...next, updatedAt: now().toISOString() };
      if (release) delete updated.lease;
      const changed = await db.agent.updateMany({ where: { id: agentId, status: "provisioning", lifecycleRecovery: { equals: json(current) } }, data: {
        lifecycleRecovery: json(updated), status: updated.state === "complete" ? "active" : updated.state === "failed" ? "error" : "provisioning",
      } });
      if (changed.count !== 1) throw new Error("provisioning_lease_lost");
      current = updated;
    }
    async function record(stage: FinancialStage, result: TxResult) {
      // Retain only the transaction identity and fixed status, never provider errors.
      const entry: Entry = { stage, status: result.status, hash: result.hash, innerHash: result.innerHash, transport: result.transport, ...(result.recovery ? { recovery: { ...result.recovery } } : {}), ...(result.sponsorshipError ? { sponsorshipError: result.sponsorshipError } : {}) };
      await save({ ...current, stage, state: "pending", transactions: [...current.transactions.filter((item) => item.stage !== stage), entry] });
    }
    async function run() {
      let owner: Keypair;
      try {
        owner = Keypair.fromSecret(decrypt(agent.org.walletSecretEnc));
        const signer = Keypair.fromSecret(decrypt(agent.agentSecretEnc));
        if (owner.publicKey() !== agent.org.walletPublic || signer.publicKey() !== agent.agentPublic) throw new Error("identity mismatch");
      } catch {
        await save({ ...current, state: "failed", errorCode: "wallet_identity_mismatch", needsReview: true }, true);
        return { status: "failed" as const };
      }
      if (current.stage === "queued" || current.stage === "accounts") {
        if (agent.policy!.expiresAt <= now()) {
          await save({ ...current, state: "failed", errorCode: "policy_expired", needsReview: false }, true);
          return { status: "failed" as const };
        }
        await save({ ...current, stage: "accounts", state: "working", errorCode: undefined });
        try { await timing.measure("rpc_prep", () => Promise.all([options.ensureAccount(owner.publicKey()), options.ensureAccount(agent.agentPublic)])); }
        catch {
          await save({ ...current, state: "pending", errorCode: "account_setup_incomplete" }, true);
          return { status: "pending" as const };
        }
        // Queued/accounts are the only stages allowed to start device registration.
        await save({ ...current, stage: "register_device", state: "working", errorCode: undefined });
      } else if (current.stage !== "complete") {
        const stored = current.transactions.find((item) => item.stage === current.stage);
        if (!stored) {
          await save({ ...current, state: "pending", errorCode: "submission_identity_missing", needsReview: true, automaticRecoveryBlocked: true }, true);
          return { status: "pending" as const };
        }
        if (stored.status === "PENDING") {
          const result = await timing.measure("settlement", () => options.reconcile(stored));
          if (result.innerHash !== stored.innerHash || (stored.recovery && result.recovery && stored.recovery.requestId !== result.recovery.requestId)) {
            await save({ ...current, state: "pending", errorCode: "transaction_identity_mismatch", needsReview: true }, true);
            return { status: "pending" as const };
          }
          await record(stored.stage, result);
        }
      }
      for (const stage of ["register_device", "register_policy"] as const) {
        const stored = current.transactions.find((item) => item.stage === stage);
        if (stored?.status === "FAILED") {
          await save({ ...current, stage, state: "failed", errorCode: "registration_failed", needsReview: false }, true);
          return { status: "failed" as const };
        }
        if (stored?.status === "PENDING") {
          await save({ ...current, stage, state: "pending", errorCode: "confirmation_pending", needsReview: !stored.recovery && stored.transport === "velo" }, true);
          return { status: "pending" as const };
        }
        if (stored?.status === "SUCCESS") continue;
        if (agent.policy!.expiresAt <= now()) {
          await save({ ...current, stage, state: "failed", errorCode: "policy_expired", needsReview: false }, true);
          return { status: "failed" as const };
        }
        // This marker survives preparation exceptions or a process dying before
        // its signed-envelope checkpoint. It may only be reconciled thereafter.
        await save({ ...current, stage, state: "pending", errorCode: "submission_unknown" });
        const chain = options.createChain((result) => record(stage, result));
        const result = await timing.measure("settlement", () => stage === "register_device"
          ? chain.registerDevice(owner, agent.deviceHash, agent.agentPublic)
          : chain.registerAgent(owner, { deviceHash: agent.deviceHash, agent: agent.agentPublic, maxAmount: agent.policy!.maxAmount, asset: agent.policy!.asset, expiresAt: BigInt(Math.floor(agent.policy!.expiresAt.getTime() / 1000)) }));
        await record(stage, result);
        if (result.status !== "SUCCESS") {
          await save({ ...current, stage, state: result.status === "FAILED" ? "failed" : "pending", errorCode: result.status === "FAILED" ? "registration_failed" : "confirmation_pending", needsReview: result.status === "PENDING" && !result.recovery && result.transport === "velo" }, true);
          return { status: result.status === "FAILED" ? "failed" as const : "pending" as const };
        }
      }
      await save({ ...current, stage: "complete", state: "complete", errorCode: undefined, needsReview: false }, true);
      return { status: "active" as const };
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        run(),
        new Promise<{ status: "pending" }>((resolve) => { timer = setTimeout(() => { cancelled = true; resolve({ status: "pending" }); }, timeoutMs); }),
      ]);
      timing.finish(result.status, { stage: current.stage });
      return result;
    } catch {
      // A durable stage/identity remains. Never retry an uncertain submission.
      // Releasing a lease here could let a successor race an in-flight call.
      timing.finish("pending", { stage: current.stage, errorCode: "provisioning_unresolved" });
      return { status: "pending" as const };
    } finally { cancelled = true; if (timer) clearTimeout(timer); }
  }
  async function processAgentProvisioning() {
    const counts = { processed: 0, active: 0, pending: 0, failed: 0, errors: 0 };
    const startedAt = Date.now();
    const limit = Math.max(1, Math.min(options.batchSize ?? 5, 10));
    const observedAt = now().toISOString();
    // JSON text comparisons avoid throwing date/boolean casts on malformed
    // records. Only canonical future leases are skipped before applying LIMIT;
    // malformed leases reach claim's validator and are durably review-blocked.
    const candidates = await db.$queryRaw<{ id: string }[]>`
      SELECT candidate.id FROM "agents" AS candidate
      WHERE candidate.status = 'provisioning'
        AND candidate.lifecycle_recovery -> 'version' = '1'::jsonb
        AND COALESCE(candidate.lifecycle_recovery ->> 'automaticRecoveryBlocked', 'false') <> 'true'
        AND NOT (
          COALESCE(candidate.lifecycle_recovery #>> '{lease,expiresAt}', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$'
          AND candidate.lifecycle_recovery #>> '{lease,expiresAt}' > ${observedAt}
        )
        AND NOT EXISTS (
          SELECT 1 FROM "agents" AS sibling
          WHERE sibling.org_id = candidate.org_id AND sibling.id <> candidate.id
            AND sibling.lifecycle_recovery ->> 'state' IN ('working', 'pending')
        )
      ORDER BY candidate.updated_at ASC, candidate.id ASC
      LIMIT ${limit}
    `;
    for (const agent of candidates) {
      // A sequential batch may start another job only while the total remaining
      // function budget can still contain one full bounded job.
      if (Date.now() - startedAt >= (options.batchStartBudgetMs ?? 10_000)) break;
      try {
        const result = await provisionAgent(agent.id);
        if (result.status === "skipped") continue;
        counts.processed++;
        counts[result.status]++;
      } catch { counts.errors++; }
    }
    return counts;
  }
  return { provisionAgent, processAgentProvisioning };
}
let singleton: ReturnType<typeof createProvisioningService> | undefined;
function service() {
  if (!singleton) {
    const config = loadStellarConfig();
    const secret = process.env.SETTL_RELAYER_SECRET || process.env.SETTL_TREASURY_SECRET;
    const relayer = secret ? Keypair.fromSecret(secret) : undefined;
    const submitterOptions = { ...config, relayer, timeoutMs: 45_000, pollMs: 1_000 };
    const server = new rpc.Server(config.rpcUrl, { timeout: 20_000 });
    singleton = createProvisioningService({ db: getDb(),
      createChain: (checkpoint) => createStellarClient(config, { submitter: createProvisioningSubmitter(submitterOptions, checkpoint) }),
      reconcile: (result) => createProvisioningSubmitter(submitterOptions, async () => {}).reconcile!(result),
      ensureAccount: async (publicKey) => {
        try { await server.getAccount(publicKey); return; } catch { /* Friendbot, then independently confirm. */ }
        try { await fundTestnetAccount(publicKey); } catch { /* Confirm even when Friendbot response was lost. */ }
        await server.getAccount(publicKey);
      },
    });
  }
  return singleton;
}
export function provisionAgent(agentId: string): Promise<unknown> { return service().provisionAgent(agentId); }
export function processAgentProvisioning() { return service().processAgentProvisioning(); }
