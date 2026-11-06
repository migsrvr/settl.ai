import { Address, FeeBumpTransaction, Networks, TransactionBuilder, scValToNative } from "@stellar/stellar-sdk";
import type { xdr } from "@stellar/stellar-sdk";
import type { AuthorizeArgs } from "./types";

interface TransactionReader {
  getTransaction(hash: string): Promise<{ status: string; envelopeXdr?: xdr.TransactionEnvelope }>;
}

/** Ledger evidence only. Quote matching and payment reuse checks belong to the broker. */
export async function readAuthorizeTx(server: TransactionReader, hash: string, escrowContract: string): Promise<{ ok: boolean; args?: AuthorizeArgs }> {
  if (!/^[a-f0-9]{64}$/.test(hash)) return { ok: false };
  const found = await server.getTransaction(hash);
  if (found.status !== "SUCCESS" || !found.envelopeXdr) return { ok: false };
  try {
    const envelope = TransactionBuilder.fromXdr(found.envelopeXdr, Networks.TESTNET);
    const inner = envelope instanceof FeeBumpTransaction ? envelope.innerTransaction : envelope;
    if (![envelope, inner].some((tx) => Buffer.from(tx.hash()).toString("hex") === hash)) return { ok: false };
    if (inner.operations.length !== 1) return { ok: false };
    const op = inner.operations[0];
    if (op.type !== "invokeHostFunction" || op.func.type !== "hostFunctionTypeInvokeContract") return { ok: false };
    const call = op.func.invokeContract;
    if (Address.fromScAddress(call.contractAddress).toString() !== escrowContract || call.functionName.toString() !== "authorize") return { ok: false };
    const a = call.args;
    if (a.length !== 6 || a[0].type !== "scvAddress" || a[1].type !== "scvBytes" || a[2].type !== "scvAddress" || a[3].type !== "scvAddress" || a[4].type !== "scvI128" || a[5].type !== "scvU64") return { ok: false };
    const [agent, device, merchant, asset, amount, nonce] = a.map(scValToNative);
    if (!(device instanceof Uint8Array) || device.length !== 32 || typeof agent !== "string" || typeof merchant !== "string" || typeof asset !== "string" || typeof amount !== "bigint" || amount <= 0n || typeof nonce !== "bigint") return { ok: false };
    return { ok: true, args: { agent, deviceHash: Buffer.from(device).toString("hex"), merchant, asset, amount, nonce } };
  } catch { return { ok: false }; }
}
