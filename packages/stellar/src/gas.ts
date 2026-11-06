import { Velo, VeloError, VeloGasSubmissionUnknownError } from "@carts1024/velo-sdk";
import type { GasApi, GasExecutionIdentity, GasSubmitResult } from "@carts1024/velo-sdk";
import { Keypair, Networks, Transaction, TransactionBuilder, rpc } from "@stellar/stellar-sdk";
import type { FeeBumpTransaction } from "@stellar/stellar-sdk";
import type { StellarConfig, TxResult } from "./types";

export interface GasOptions extends StellarConfig {
  gas?: Pick<GasApi, "sponsorAndSubmit" | "waitForResult">;
  rpc?: {
    sendTransaction(tx: FeeBumpTransaction): Promise<{ status: string; hash: string }>;
    getTransaction(hash: string): Promise<{ status: string }>;
  };
  relayer?: Keypair;
  timeoutMs?: number;
  pollMs?: number;
}

export class GasSubmitter {
  private readonly gas: Pick<GasApi, "sponsorAndSubmit" | "waitForResult">;
  private readonly server: NonNullable<GasOptions["rpc"]>;
  private readonly timeoutMs: number;

  constructor(private readonly options: GasOptions) {
    if (options.networkPassphrase !== Networks.TESTNET) throw new Error("Gas submission supports testnet only");
    if (!options.gas && !options.gasApiKey) throw new Error("VELO_GAS_API_KEY is required for Gas Station");
    this.gas = options.gas ?? new Velo({ apiKey: options.gasApiKey!, environment: "testnet", timeoutMs: 30_000 }).gas;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.server = options.rpc ?? new rpc.Server(options.rpcUrl, { timeout: Math.min(this.timeoutMs, 30_000) });
  }

  async submit(signedXdr: string): Promise<TxResult> {
    const tx = TransactionBuilder.fromXdr(signedXdr, this.options.networkPassphrase);
    if (!(tx instanceof Transaction) || tx.operations.length !== 1 || tx.operations[0].type !== "invokeHostFunction") {
      throw new Error("Gas Station requires exactly one inner Soroban invocation");
    }
    if (!tx.signatures.length || !tx.signatures.some((s) => Keypair.fromPublicKey(tx.source).verify(tx.hash(), s.signature.toBytes()))) {
      throw new Error("Transaction must be signed by its source account");
    }
    const innerHash = Buffer.from(tx.hash()).toString("hex");
    let result: GasSubmitResult;
    try {
      result = await this.gas.sponsorAndSubmit(signedXdr, { idempotencyKey: `settl:${innerHash}` });
    } catch (error) {
      if (error instanceof VeloGasSubmissionUnknownError) {
        if (error.recovery.transactionHash !== innerHash) return this.identityMismatch(innerHash);
        return this.recover(error.recovery);
      }
      if (error instanceof VeloError && (error.code === "contract_not_whitelisted" || error.code === "policy_disabled") && this.options.relayer) {
        return this.submitRelayed(tx, this.options.relayer, innerHash, error.code);
      }
      // Unknown transport errors cannot prove that nothing was submitted.
      return {
        status: error instanceof VeloError && error.status !== undefined && error.status >= 400 && error.status < 500
          || error instanceof VeloError && ["contract_not_whitelisted", "daily_cap_exceeded", "wallet_rate_limited", "unauthorized"].includes(error.code ?? "")
          ? "FAILED" : "PENDING",
        hash: innerHash, innerHash, transport: "velo",
        error: error instanceof VeloError ? error.code ?? "velo_error" : "submission_unknown",
      };
    }
    if (result.transactionHash !== innerHash) return this.identityMismatch(innerHash);
    return this.recover({ requestId: result.requestId, transactionHash: result.transactionHash });
  }

  /** Identity-only recovery; this never sponsors, submits, or creates another envelope. */
  async recover(identity: GasExecutionIdentity): Promise<TxResult> {
    try {
      const result = await this.gas.waitForResult(identity, { timeoutMs: this.timeoutMs, maxAttempts: 20 });
      if (result.requestId !== identity.requestId || result.transactionHash !== identity.transactionHash) {
        return { ...this.identityMismatch(identity.transactionHash), recovery: identity };
      }
      return {
        status: result.status === "succeeded" ? "SUCCESS" : ["failed", "cancelled"].includes(result.status) ? "FAILED" : "PENDING",
        hash: result.outerTransactionHash ?? result.transactionHash,
        innerHash: result.transactionHash, transport: "velo", recovery: identity,
        actualFeeStroops: result.actualFeeStroops,
        ...(result.status === "succeeded" ? {} : { error: result.status }),
      };
    } catch {
      return { status: "PENDING", hash: identity.transactionHash, innerHash: identity.transactionHash, transport: "velo", recovery: identity, error: "observation_incomplete" };
    }
  }

  async reconcile(result: TxResult): Promise<TxResult> {
    if (result.status !== "PENDING") return result;
    if (result.transport === "relayer") return this.recoverRelayer(result.hash, result.innerHash, result.sponsorshipError);
    if (result.recovery) return this.recover(result.recovery);
    // A missing reservation identity is never a reason to send the envelope again.
    try {
      const found = await this.server.getTransaction(result.hash);
      if (found.status === "SUCCESS" || found.status === "FAILED") return { ...result, status: found.status };
    } catch { /* Preserve uncertainty while RPC is unavailable. */ }
    return result;
  }

  /** Recover a local relayer hash after a timeout. Does not submit anything. */
  async recoverRelayer(hash: string, innerHash: string, sponsorshipError: string = "contract_not_whitelisted"): Promise<TxResult> {
    const base = { hash, innerHash, transport: "relayer" as const, sponsorshipError };
    const deadline = Date.now() + this.timeoutMs;
    do {
      try {
        const result = await this.server.getTransaction(hash);
        if (result.status === "SUCCESS" || result.status === "FAILED") {
          return { ...base, status: result.status, ...(result.status === "FAILED" ? { error: "onchain_failed" } : {}) };
        }
      } catch { /* An unavailable observer does not change transaction truth. */ }
      await new Promise((resolve) => setTimeout(resolve, this.options.pollMs ?? 1_000));
    } while (Date.now() < deadline);
    return { ...base, status: "PENDING", error: "observation_incomplete" };
  }

  private async submitRelayed(tx: Transaction, relayer: Keypair, innerHash: string, sponsorshipError: string): Promise<TxResult> {
    // SDK 17 adds resource fees itself; the fee-bump base is the inclusion fee only.
    const envelope = tx.toEnvelope();
    const resourceFee = envelope.type === "envelopeTypeTx" && envelope.value.tx.ext.type === "sorobanData"
      ? BigInt(envelope.value.tx.ext.value.resourceFee.toString()) : 0n;
    const baseFee = BigInt(tx.fee) - resourceFee; // submit() enforces exactly one operation.
    const bump = TransactionBuilder.buildFeeBumpTransaction(relayer, baseFee.toString(), tx, this.options.networkPassphrase);
    bump.sign(relayer);
    const hash = Buffer.from(bump.hash()).toString("hex");
    const base = { hash, innerHash, transport: "relayer" as const, sponsorshipError };
    try {
      const sent = await this.server.sendTransaction(bump);
      if (sent.status === "ERROR") return { ...base, status: "FAILED", error: "rpc_rejected" };
    } catch {
      return { ...base, status: "PENDING", error: "submission_unknown" };
    }
    return this.recoverRelayer(hash, innerHash, sponsorshipError);
  }

  private identityMismatch(innerHash: string): TxResult {
    return { status: "PENDING", hash: innerHash, innerHash, transport: "velo", error: "identity_mismatch" };
  }
}
