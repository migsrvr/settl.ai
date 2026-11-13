import { createHash } from "node:crypto";

export interface FakeAuthorizeArgs {
  agent: string;
  deviceHash: string;
  merchant: string;
  asset: string;
  amount: bigint;
  nonce: bigint;
}

export interface FakeTxResult {
  status: "SUCCESS" | "FAILED" | "PENDING";
  hash: string;
  innerHash: string;
  transport: "relayer";
  error?: string;
}

const NO_HASH = "0".repeat(64);

/**
 * In-memory stand-in for the Noir escrow. It enforces the two rules the broker relies on
 * (enough escrow, strictly increasing nonces) and nothing else. The money is not real.
 */
export class FakeChain {
  private readonly balances = new Map<string, bigint>();
  private readonly pending = new Map<string, bigint>();
  private readonly lastNonce = new Map<string, bigint>();
  private readonly evidence = new Map<string, FakeAuthorizeArgs>();
  private forcedFailure: string | undefined;
  private counter = 0;

  fund(deviceHash: string, amount: bigint): void {
    this.balances.set(deviceHash, (this.balances.get(deviceHash) ?? 0n) + amount);
  }

  /** Make the next authorize fail once, to demonstrate a blocked payment. */
  failNext(error = "sandbox_forced_failure"): void {
    this.forcedFailure = error;
  }

  /** Pay out and clear a merchant's pending earnings; returns the amount claimed. */
  claim(merchant: string): bigint {
    const amount = this.pending.get(merchant) ?? 0n;
    this.pending.delete(merchant);
    return amount;
  }

  // Arrow properties keep `this` bound when the broker destructures these methods.
  balanceOf = async (deviceHash: string): Promise<bigint> => this.balances.get(deviceHash) ?? 0n;

  pendingBalance = async (merchant: string): Promise<bigint> => this.pending.get(merchant) ?? 0n;

  authorize = async (_signer: { publicKey(): string }, args: FakeAuthorizeArgs): Promise<FakeTxResult> => {
    const failed = (error: string): FakeTxResult => ({ status: "FAILED", hash: NO_HASH, innerHash: NO_HASH, transport: "relayer", error });
    if (this.forcedFailure !== undefined) {
      const error = this.forcedFailure;
      this.forcedFailure = undefined;
      return failed(error);
    }
    const nonceKey = `${args.deviceHash}:${args.agent}`;
    const last = this.lastNonce.get(nonceKey);
    if (last !== undefined && args.nonce <= last) return failed("nonce_not_increasing");
    const balance = this.balances.get(args.deviceHash) ?? 0n;
    if (args.amount > balance) return failed("insufficient_escrow");

    this.counter += 1;
    const hash = createHash("sha256")
      .update(`${this.counter}:${args.deviceHash}:${args.agent}:${args.merchant}:${args.amount}:${args.nonce}`)
      .digest("hex");
    this.balances.set(args.deviceHash, balance - args.amount);
    this.pending.set(args.merchant, (this.pending.get(args.merchant) ?? 0n) + args.amount);
    this.lastNonce.set(nonceKey, args.nonce);
    this.evidence.set(hash, { ...args });
    return { status: "SUCCESS", hash, innerHash: hash, transport: "relayer" };
  };

  readAuthorizeTx = async (txHash: string): Promise<{ ok: boolean; args?: FakeAuthorizeArgs }> => {
    const args = this.evidence.get(txHash);
    return args ? { ok: true, args: { ...args } } : { ok: false };
  };
}
