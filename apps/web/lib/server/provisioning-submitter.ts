import { Velo } from "@carts1024/velo-sdk";
import { Transaction, TransactionBuilder, rpc } from "@stellar/stellar-sdk";
import { GasSubmitter } from "@settl/stellar";
import type { GasOptions, TransactionSubmitter, TxResult } from "@settl/stellar";

/** Only provisioning opts into these checkpoints. Never persist an envelope or secret. */
export function createProvisioningSubmitter(options: GasOptions, checkpoint: (result: TxResult) => Promise<void>): TransactionSubmitter {
  const gas = options.gas ?? new Velo({ apiKey: options.gasApiKey!, environment: "testnet", timeoutMs: 30_000 }).gas;
  const server = options.rpc ?? new rpc.Server(options.rpcUrl, { timeout: 20_000 });
  let signedHash: string | undefined;
  const submitter = new GasSubmitter({
    ...options,
    gas: {
      sponsorAndSubmit: (...args) => gas.sponsorAndSubmit(...args),
      // GasSubmitter calls this for both a successful reservation and an unknown
      // submission carrying its reservation identity, before waiting on Velo.
      waitForResult: async (identity, waitOptions) => {
        if (signedHash && identity.transactionHash !== signedHash) throw new Error("provisioning_identity_mismatch");
        await checkpoint({ status: "PENDING", hash: identity.transactionHash, innerHash: identity.transactionHash, transport: "velo", recovery: identity });
        return gas.waitForResult(identity, waitOptions);
      },
    },
    rpc: {
      sendTransaction: async (tx) => {
        if (!signedHash) throw new Error("provisioning_identity_missing");
        // The outer fee-bump identity is known locally before its network call.
        await checkpoint({ status: "PENDING", hash: Buffer.from(tx.hash()).toString("hex"), innerHash: signedHash, transport: "relayer" });
        return server.sendTransaction(tx);
      },
      getTransaction: (hash) => server.getTransaction(hash),
    },
  });
  return {
    async submit(xdr) {
      const tx = TransactionBuilder.fromXdr(xdr, options.networkPassphrase);
      if (!(tx instanceof Transaction)) throw new Error("provisioning_invalid_transaction");
      signedHash = Buffer.from(tx.hash()).toString("hex");
      await checkpoint({ status: "PENDING", hash: signedHash, innerHash: signedHash, transport: "velo" });
      return submitter.submit(xdr);
    },
    reconcile: (result) => submitter.reconcile(result),
  };
}
