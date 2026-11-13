import { createStellarClient, loadStellarConfig } from "@settl/stellar";
import type { NoirClient } from "@settl/stellar";

/** The chain operations the payment broker needs. */
export type GatewayChain = Pick<NoirClient, "authorize" | "readAuthorizeTx" | "pendingBalance" | "balanceOf">;

export interface ChainOverride {
  chain: GatewayChain;
  escrowContract: string;
}

let override: ChainOverride | undefined;

/**
 * Replace the Stellar-backed chain, for example with the sandbox's in-memory ledger.
 * Pass undefined to restore the configured Stellar client.
 */
export function setChain(next: ChainOverride | undefined): void {
  override = next;
}

export function getChainOverride(): ChainOverride | undefined {
  return override;
}

/** Read an agent device's spendable escrow balance in stroops. */
export function readBalance(deviceHash: string): Promise<bigint> {
  if (override) return override.chain.balanceOf(deviceHash);
  return createStellarClient(loadStellarConfig()).balanceOf(deviceHash);
}
