import { Networks, StrKey } from "@stellar/stellar-sdk";
import type { StellarConfig } from "./types";

export function loadStellarConfig(env: Record<string, string | undefined> = process.env): StellarConfig {
  const required = (name: string) => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`${name} is required`);
    return value;
  };
  const networkPassphrase = required("STELLAR_NETWORK_PASSPHRASE");
  if (networkPassphrase !== Networks.TESTNET) throw new Error("Settl's chain adapter supports testnet only");
  const rpcUrl = required("STELLAR_RPC_URL");
  const url = new URL(rpcUrl);
  // Keep testnet secrets off a mainnet RPC by requiring an explicit testnet endpoint.
  if (url.protocol !== "https:" || !url.hostname.includes("testnet") || url.username || url.password) {
    throw new Error("STELLAR_RPC_URL must be an HTTPS testnet endpoint");
  }
  const contract = (name: string) => {
    const value = required(name);
    if (!StrKey.isValidContract(value)) throw new Error(`${name} must be a contract address`);
    return value;
  };
  return {
    rpcUrl, networkPassphrase,
    contracts: {
      deviceRegistry: contract("NOIR_DEVICE_REGISTRY_ID"),
      agentRegistry: contract("NOIR_AGENT_REGISTRY_ID"),
      paymentEscrow: contract("NOIR_PAYMENT_ESCROW_ID"),
    },
    gasApiKey: env.VELO_GAS_API_KEY?.trim() || undefined,
  };
}
