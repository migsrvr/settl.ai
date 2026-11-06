import type { GasExecutionIdentity } from "@carts1024/velo-sdk";
import type { NoirNetworkConfig } from "@noirx402/agent-sdk";

export interface StellarConfig extends NoirNetworkConfig {
  gasApiKey?: string;
}

/** PENDING is unresolved, not a payment failure. Reconcile before another write. */
export interface TxResult {
  status: "SUCCESS" | "FAILED" | "PENDING";
  /** Ledger lookup hash: outer fee-bump hash when available, otherwise inner hash. */
  hash: string;
  innerHash: string;
  transport: "velo" | "relayer";
  recovery?: GasExecutionIdentity;
  actualFeeStroops?: string | null;
  error?: string;
  sponsorshipError?: string;
}

export interface AuthorizeArgs {
  agent: string;
  deviceHash: string;
  merchant: string;
  asset: string;
  amount: bigint;
  nonce: bigint;
}

export interface PolicyView {
  owner: string;
  agent: string;
  maxAmount: bigint;
  asset: string;
  /** Unix seconds; 0 means no expiry. */
  expiresAt: bigint;
}

export interface TransactionSubmitter {
  submit(signedXdr: string): Promise<TxResult>;
  reconcile?(result: TxResult): Promise<TxResult>;
}
