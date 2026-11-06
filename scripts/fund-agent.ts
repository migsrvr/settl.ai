import { loadEnvConfig } from "@next/env";
import { phpToStroops } from "@settl/core";
import { createStellarClient, loadStellarConfig, TESTNET_XLM, type NoirClient } from "@settl/stellar";
import { Keypair } from "@stellar/stellar-sdk";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type { PrismaClient } from "../apps/web/lib/generated/prisma/client";
import { getDb } from "../apps/web/lib/server/db";

const MAX = (1n << 63n) - 1n;
const HASH = /^[a-fA-F0-9]{64}$/;
class FundingError extends Error {}

export function fundingAmount(value: string | undefined, rate: number): bigint {
  if (value !== undefined && !/^[1-9]\d*$/.test(value)) throw new FundingError("Amount must be positive integer stroops");
  const amount = value === undefined ? phpToStroops(50, rate) : BigInt(value);
  if (amount <= 0n || amount > MAX) throw new FundingError("Amount exceeds the database range");
  return amount;
}

interface FundingOptions {
  db: PrismaClient;
  chain: Pick<NoirClient, "getPolicy" | "balanceOf" | "fundEscrow">;
  treasury: Keypair;
  agentId: string;
  amount: bigint;
  escrowContract: string;
  operationKey?: string;
}

/** A committed source marker survives a crash between submission and persistence. */
export async function fundAgent({ db, chain, treasury, agentId, amount, escrowContract, operationKey = "initial" }: FundingOptions) {
  if (amount <= 0n || amount > MAX || !operationKey.trim()) throw new FundingError("Invalid funding operation");
  const agent = await db.agent.findUnique({ where: { id: agentId }, include: { org: true } });
  if (!agent || agent.status !== "active") throw new FundingError("Agent must be registered and active before funding");
  const policy = await chain.getPolicy(agent.deviceHash);
  if (!policy || policy.agent !== agent.agentPublic || policy.owner !== agent.org.walletPublic || policy.asset !== TESTNET_XLM) {
    throw new FundingError("On-chain policy identity does not match this agent and owner");
  }
  const treasuryPublic = treasury.publicKey();
  const digest = createHash("sha256").update(JSON.stringify([treasuryPublic, agentId, agent.deviceHash, escrowContract, operationKey])).digest("hex");
  const id = `demo-fund-${digest.slice(0, 32)}`;
  const prior = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${treasuryPublic}, 0))::text`;
    const existing = await tx.topup.findUnique({ where: { id } });
    if (existing) {
      if (existing.amount !== amount) throw new FundingError("Recorded funding amount differs; reconcile before changing it");
      if (existing.status === "completed" && existing.fundTxHash && HASH.test(existing.fundTxHash)) return existing;
      throw new FundingError("Recorded funding is pending or failed; reconcile before another transfer");
    }
    if (await tx.topup.findFirst({ where: { status: "funding" }, select: { id: true } })) {
      throw new FundingError("Treasury has pending funding; reconcile before another transfer");
    }
    await tx.$queryRaw`SELECT id FROM "agents" WHERE id = ${agentId} FOR UPDATE`;
    const current = await tx.agent.findUnique({ where: { id: agentId } });
    if (!current || current.status !== "active" || current.deviceHash !== agent.deviceHash || current.agentPublic !== agent.agentPublic) {
      throw new FundingError("Agent changed before funding; review its registration");
    }
    await tx.topup.create({ data: {
      id, agentId, veloPaymentIntentId: `manual:${digest}`, amount, asset: TESTNET_XLM, status: "funding",
      recovery: { phase: "manual_demo_funding_started", treasuryPublic, operationKey, escrowContract },
    } });
    return null;
  });
  if (prior) return { status: "SUCCESS" as const, hash: prior.fundTxHash!, topupId: id, reused: true };

  let result;
  try { result = await chain.fundEscrow(treasury, agent.deviceHash, amount); }
  catch { return { status: "PENDING" as const, hash: "", topupId: id, reused: false }; }
  const hash = HASH.test(result.hash) ? result.hash : "";
  // Even a failed response is retained for operator reconciliation, never replayed.
  if (result.status !== "SUCCESS" || !hash) {
    await db.topup.update({ where: { id }, data: { recovery: {
      phase: "manual_demo_funding_unresolved", treasuryPublic, status: result.status, hash,
      innerHash: HASH.test(result.innerHash) ? result.innerHash : "",
      ...(result.recovery ? { execution: { ...result.recovery } } : {}),
    } } });
    return { status: "PENDING" as const, hash, topupId: id, reused: false };
  }
  try {
    await db.topup.update({ where: { id }, data: {
      status: "completed", fundTxHash: hash, completedAt: new Date(),
      recovery: { phase: "manual_demo_funding_completed", treasuryPublic, innerHash: result.innerHash, transport: result.transport },
    } });
  } catch { throw new FundingError(`Funding may have completed: ${hash}. Reconcile record ${id}; do not resubmit.`); }
  // Cache reads cannot undo a confirmed funding transaction.
  try {
    const balance = await chain.balanceOf(agent.deviceHash);
    if (balance >= 0n && balance <= MAX) await db.agent.update({ where: { id: agentId }, data: { cachedBalance: balance, balanceUpdatedAt: new Date() } });
  } catch { /* The next live budget read refreshes the balance. */ }
  return { status: "SUCCESS" as const, hash, topupId: id, reused: false };
}

async function main() {
  loadEnvConfig(resolve("apps/web"));
  if (!process.env.DATABASE_URL) throw new FundingError("DATABASE_URL is required; ask the operator to configure apps/web/.env.local");
  const secret = process.env.SETTL_TREASURY_SECRET;
  if (!secret) throw new FundingError("SETTL_TREASURY_SECRET is required; ask the operator to configure it");
  const treasury = Keypair.fromSecret(secret);
  const config = loadStellarConfig();
  const relayer = process.env.SETTL_RELAYER_SECRET ? Keypair.fromSecret(process.env.SETTL_RELAYER_SECRET) : treasury;
  const db = getDb();
  try {
    const result = await fundAgent({ db, chain: createStellarClient(config, { relayer }), treasury,
      agentId: process.argv[2] ?? "bookkeeper", amount: fundingAmount(process.argv[3], Number(process.env.PHP_PER_XLM ?? "15")),
      escrowContract: config.contracts.paymentEscrow, operationKey: process.argv[4] ?? "initial" });
    console.info(`Funding ${result.status}. Record: ${result.topupId}${result.reused ? " (already confirmed)" : ""}`);
    if (result.hash) console.info(`https://stellar.expert/explorer/testnet/tx/${result.hash}`);
    if (result.status !== "SUCCESS") throw new FundingError("Funding unresolved; reconcile the durable record before any treasury retry");
  } finally { await db.$disconnect(); }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/fund-agent.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof FundingError ? error.message : "Funding stopped. Check testnet configuration and the durable funding record; no automatic retry.");
    process.exitCode = 1;
  });
}
