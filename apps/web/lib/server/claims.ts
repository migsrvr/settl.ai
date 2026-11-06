import { createStellarClient, loadStellarConfig, TESTNET_XLM } from "@settl/stellar";
import type { NoirClient } from "@settl/stellar";
import { Keypair } from "@stellar/stellar-sdk";
import type { Prisma, PrismaClient } from "../generated/prisma/client";
import { getDb } from "./db";
import { decryptWalletSecret } from "./wallets";

export type ClaimResult = {
  status: "completed" | "pending" | "skipped" | "failed";
  providerId: string;
  claimId?: string;
  /** Pending balance observed before the all-pending claim, not an exact payout receipt. */
  amountStroops?: string;
  txHash?: string;
};
interface ClaimOptions {
  db: PrismaClient;
  chain: Pick<NoirClient, "pendingBalance" | "claim">;
  decrypt?: (encrypted: string) => string;
  now?: () => Date;
  onCompleted?: (result: ClaimResult) => Promise<void>;
}

export function createClaims(options: ClaimOptions) {
  const { db, chain } = options;
  const decrypt = options.decrypt ?? decryptWalletSecret;
  const now = options.now ?? (() => new Date());

  async function claimProvider(providerId: string, request: { manual?: boolean } = {}): Promise<ClaimResult> {
    const base = { providerId };
    try {
      const prepared = await db.$transaction(async (tx) => {
        // Provider identity is unique per merchant, so this serializes claims
        // across workers. The pending marker survives releasing the lock.
        await tx.$queryRaw`SELECT id FROM "providers" WHERE id = ${providerId} FOR UPDATE`;
        const provider = await tx.provider.findUnique({ where: { id: providerId }, include: { org: true, settings: true } });
        if (!provider || !request.manual && !provider.settings?.autoClaimEnabled) return { result: { ...base, status: "skipped" as const } };
        const existing = await tx.claim.findFirst({ where: { providerId, status: "pending" } });
        if (existing) return { result: { ...base, status: "pending" as const, claimId: existing.id, ...(existing.txHash ? { txHash: existing.txHash } : {}) } };
        const signer = Keypair.fromSecret(decrypt(provider.org.walletSecretEnc));
        if (signer.publicKey() !== provider.merchantWallet) return { result: { ...base, status: "failed" as const } };
        const amount = await chain.pendingBalance(provider.merchantWallet);
        if (amount <= 0n || !request.manual && amount < provider.settings!.autoClaimThreshold) return { result: { ...base, status: "skipped" as const } };
        const claim = await tx.claim.create({ data: { providerId, amount, asset: TESTNET_XLM, status: "pending" } });
        return { claim, signer, orgId: provider.orgId };
      }, { timeout: 30_000 });
      if ("result" in prepared) return prepared.result!;
      const { claim, signer, orgId } = prepared;
      const identity = { ...base, claimId: claim.id, amountStroops: claim.amount.toString() };
      let submittedHash: string | undefined;
      // Once the marker is committed, any unexpected error means submission
      // may have happened. Keep it pending for explicit reconciliation.
      try {
        const result = await chain.claim(signer);
        const txHash = result.hash || result.innerHash || undefined;
        submittedHash = txHash;
        const status = result.status === "SUCCESS" ? "completed" : result.status === "FAILED" ? "failed" : "pending";
        const recovery: Prisma.InputJsonObject = {
          ...(result.recovery ? JSON.parse(JSON.stringify(result.recovery)) : {}),
          ...(result.innerHash ? { innerHash: result.innerHash } : {}),
          ...(result.transport ? { transport: result.transport } : {}),
        };
        const update: Prisma.ClaimUpdateInput = {
          status, ...(txHash ? { txHash } : {}), recovery,
          ...(status === "completed" ? { claimedAt: now() } : {}),
        };
        if (status === "completed") {
          await db.$transaction(async (tx) => {
            await tx.claim.update({ where: { id: claim.id }, data: update });
            const eventId = `claim:${claim.id}:completed`;
            await tx.webhookEvent.upsert({ where: { source_eventId: { source: "settl", eventId } }, update: {}, create: {
              source: "settl", eventId, verified: true,
              payload: { eventId, event: "claim.completed", providerId, orgIds: [orgId], payload: { claimId: claim.id, providerId, observedPendingStroops: claim.amount.toString(), ...(txHash ? { txHash } : {}) } },
            } });
          });
        } else await db.claim.update({ where: { id: claim.id }, data: update });
        const response: ClaimResult = { ...identity, status, ...(txHash ? { txHash } : {}) };
        if (status === "completed") {
          try { await options.onCompleted?.(response); } catch { /* Confirmed claims stay completed if notification fails. */ }
        }
        return response;
      } catch { return { ...identity, status: "pending", ...(submittedHash ? { txHash: submittedHash } : {}) }; }
    } catch { return { ...base, status: "failed" }; }
  }

  async function autoClaimProviders() {
    const providers = await db.provider.findMany({ where: { settings: { is: { autoClaimEnabled: true } } }, select: { id: true } });
    const results: ClaimResult[] = [];
    // Bound chain pressure and let each provider retain its own durable marker.
    for (const provider of providers) results.push(await claimProvider(provider.id));
    return {
      completed: results.filter((r) => r.status === "completed").length,
      pending: results.filter((r) => r.status === "pending").length,
      skipped: results.filter((r) => r.status === "skipped").length,
      failed: results.filter((r) => r.status === "failed").length,
      results,
    };
  }
  return { claimProvider, autoClaimProviders };
}

let singleton: ReturnType<typeof createClaims> | undefined;
function claims() {
  if (!singleton) {
    const config = loadStellarConfig();
    const relayer = process.env.SETTL_RELAYER_SECRET || process.env.SETTL_TREASURY_SECRET;
    const clientOptions = relayer ? { relayer: Keypair.fromSecret(relayer) } : {};
    const reader = createStellarClient(config, clientOptions);
    singleton = createClaims({ db: getDb(), chain: {
      pendingBalance: reader.pendingBalance,
      claim: (signer) => createStellarClient(config, clientOptions).claim(signer),
    } });
  }
  return singleton;
}
export function claimProvider(providerId: string, request: { manual?: boolean } = {}) { return claims().claimProvider(providerId, request); }
export function autoClaimProviders() { return claims().autoClaimProviders(); }
