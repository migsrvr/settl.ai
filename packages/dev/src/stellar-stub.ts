// The sandbox replaces `@settl/stellar` with this module (tsconfig paths, vitest alias and the bundler alias).
// The broker only needs these types; the real Noir/Velo/Stellar clients are never loaded and never constructed,
// because the sandbox installs a FakeChain through setChain().
import type { Keypair } from "@stellar/stellar-sdk";

export interface AuthorizeArgs {
  agent: string;
  deviceHash: string;
  merchant: string;
  asset: string;
  amount: bigint;
  nonce: bigint;
}

export interface TxResult {
  status: "SUCCESS" | "FAILED" | "PENDING";
  hash: string;
  innerHash: string;
  transport: "velo" | "relayer";
  actualFeeStroops?: string | null;
  error?: string;
  sponsorshipError?: string;
  /** Opaque string fields stored with a pending payment so it can be reconciled later. */
  recovery?: Record<string, string>;
}

export interface StellarConfig {
  contracts: { paymentEscrow: string };
}

export interface NoirClient {
  authorize(agent: Keypair, args: AuthorizeArgs): Promise<TxResult>;
  readAuthorizeTx(txHash: string): Promise<{ ok: boolean; args?: AuthorizeArgs }>;
  balanceOf(deviceHash: string): Promise<bigint>;
  pendingBalance(merchant: string): Promise<bigint>;
}

const unavailable = () => new Error("The sandbox has no Stellar connection. It uses an in-memory ledger.");

export function loadStellarConfig(): StellarConfig {
  throw unavailable();
}

export function createStellarClient(_config?: StellarConfig, _options?: { relayer?: unknown }): NoirClient {
  throw unavailable();
}
