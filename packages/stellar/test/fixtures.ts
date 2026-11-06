import { Account, Asset, Contract, Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";

export const contracts = {
  deviceRegistry: "CAC4KOLHDLDYDWBOKXNKRN5KVHO56PLOIFXDLTBUWGVN6GVDEB7FQHU5",
  agentRegistry: "CCMZDSPTLX7IIJWCYEUM5DJUHOSOYSTHGK777S2TXZWEMC5ZZGPJ3EBV",
  paymentEscrow: "CC7EAW5FNJEDBS7THM5IT6XIOHO4AOYMLXT3KSZ3HWUIKEACTW7E5BFS",
};
export const owner = Keypair.random();
export const agent = Keypair.random();
export const merchant = Keypair.random();
export const deviceHash = "ab".repeat(32);
export const asset = Asset.native().contractId(Networks.TESTNET);
export const config = { rpcUrl: "https://soroban-testnet.stellar.org", networkPassphrase: Networks.TESTNET, contracts };

export function envelope(signer = agent) {
  const tx = new TransactionBuilder(new Account(signer.publicKey(), "1"), {
    fee: "100000", networkPassphrase: Networks.TESTNET,
  }).addOperation(new Contract(contracts.paymentEscrow).call("authorize"))
    .setTimebounds(0, 4_000_000_000).build();
  tx.sign(signer);
  return tx.toXdr();
}

export function gasResult(status: "submitted" | "submission_unknown" | "succeeded" | "failed" | "cancelled" = "succeeded") {
  const tx = TransactionBuilder.fromXdr(envelope(), Networks.TESTNET);
  return {
    object: "gas_submit_result" as const,
    requestId: "gas-request-1", transactionHash: Buffer.from(tx.hash()).toString("hex"),
    outerTransactionHash: "cd".repeat(32), status,
    reservedStroops: "100000", actualFeeStroops: status === "succeeded" ? "1234" : null,
    expiresAt: "2026-11-05T00:00:00Z", reconciliationRequired: status === "submission_unknown",
  };
}
