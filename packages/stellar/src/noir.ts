import { Asset, Keypair, Networks, StrKey, Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import type { NoirAgentClient, NoirOperation } from "@noirx402/agent-sdk";
import { GasSubmitter } from "./gas";
import { PreparedNoirClient } from "./rpc";
import { readAuthorizeTx } from "./proof";
import type { AuthorizeArgs, PolicyView, StellarConfig, TransactionSubmitter, TxResult } from "./types";

export const TESTNET_XLM = Asset.native().contractId(Networks.TESTNET);
const I128_MAX = (1n << 127n) - 1n;
const U64_MAX = (1n << 64n) - 1n;

function hash(value: string) {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("deviceHash must be 32 bytes of lowercase hex");
}
function amount(value: bigint, allowZero = false) {
  if (typeof value !== "bigint" || value < (allowZero ? 0n : 1n) || value > I128_MAX) throw new Error("Invalid i128 amount");
}
function address(value: string) {
  if (!StrKey.isValidEd25519PublicKey(value)) throw new Error("Invalid account address");
}

export interface StellarClientOptions {
  sdk?: NoirAgentClient;
  submitter?: TransactionSubmitter;
  relayer?: Keypair;
}

export function createStellarClient(config: StellarConfig, options: StellarClientOptions = {}) {
  if (config.networkPassphrase !== Networks.TESTNET) throw new Error("Settl supports testnet only");
  const sdk = options.sdk ?? new PreparedNoirClient({ network: config });
  let submitter = options.submitter;
  const getSubmitter = () => submitter ??= new GasSubmitter({ ...config, relayer: options.relayer });
  const queues = new Map<string, Promise<unknown>>();
  const unresolved = new Map<string, TxResult>();

  async function write(signer: Keypair, op: NoirOperation): Promise<TxResult> {
    const source = signer.publicKey();
    const previous = queues.get(source) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(async () => {
      if (unresolved.has(source)) throw new Error("Account has an unresolved pending transaction; reconcile it before another write");
      if (op.kind === "revokeDevice" && await sdk.getEscrowBalance(op.deviceHash) !== 0n) throw new Error("Cannot revoke device while escrow balance is nonzero");
      const unsigned = await sdk.prepare(source, op);
      const tx = TransactionBuilder.fromXdr(unsigned, config.networkPassphrase);
      if (!(tx instanceof Transaction) || tx.source !== source) throw new Error("Prepared transaction source mismatch");
      tx.sign(signer);
      const result = await getSubmitter().submit(tx.toXdr());
      if (result.status === "PENDING") unresolved.set(source, result);
      return result;
    });
    queues.set(source, current);
    try { return await current; }
    finally { if (queues.get(source) === current) queues.delete(source); }
  }

  const client = {
    async registerDevice(owner: Keypair, deviceHash: string, agent: string) {
      hash(deviceHash); address(agent);
      return write(owner, { kind: "registerDevice", deviceHash, agent });
    },
    async registerAgent(owner: Keypair, p: { deviceHash: string; agent: string; maxAmount: bigint; asset: string; expiresAt: bigint }) {
      hash(p.deviceHash); address(p.agent); amount(p.maxAmount, true);
      if (p.asset !== TESTNET_XLM) throw new Error("Settl escrow supports native testnet XLM only");
      if (p.expiresAt < 0n || p.expiresAt > 8_640_000_000_000n) throw new Error("Expiry must be representable as Unix seconds in a Date");
      return write(owner, { kind: "registerAgent", ...p, expiresAt: p.expiresAt === 0n ? null : new Date(Number(p.expiresAt) * 1000) });
    },
    async fundEscrow(funder: Keypair, deviceHash: string, value: bigint) {
      hash(deviceHash); amount(value);
      return write(funder, { kind: "fundEscrow", deviceHash, token: TESTNET_XLM, amount: value });
    },
    async authorize(agent: Keypair, a: AuthorizeArgs) {
      hash(a.deviceHash); amount(a.amount); address(a.merchant);
      if (a.agent !== agent.publicKey()) throw new Error("Agent signer mismatch");
      if (typeof a.nonce !== "bigint" || a.nonce < 0n || a.nonce > U64_MAX) throw new Error("Invalid u64 nonce");
      if (a.asset !== TESTNET_XLM) throw new Error("Settl escrow supports native testnet XLM only");
      return write(agent, { kind: "authorize", deviceHash: a.deviceHash, merchant: a.merchant, asset: a.asset, amount: a.amount, nonce: a.nonce });
    },
    async claim(merchant: Keypair) { return write(merchant, { kind: "claim", token: TESTNET_XLM }); },
    balanceOf(deviceHash: string) { hash(deviceHash); return sdk.getEscrowBalance(deviceHash); },
    pendingBalance(merchant: string) { address(merchant); return sdk.getPendingBalance(merchant); },
    escrowToken(deviceHash: string) { hash(deviceHash); return sdk.getEscrowToken(deviceHash); },
    async getPolicy(deviceHash: string): Promise<PolicyView | null> {
      hash(deviceHash);
      const policy = await sdk.getPolicy(deviceHash);
      if (!policy) return null;
      const owner = await sdk.getDeviceOwner(deviceHash);
      if (!owner) throw new Error("Policy has no registered device owner");
      return { ...policy, owner, expiresAt: policy.expiresAt ? BigInt(Math.floor(policy.expiresAt.getTime() / 1000)) : 0n };
    },
    async revokeAgent(owner: Keypair, deviceHash: string) {
      hash(deviceHash);
      return write(owner, { kind: "revokeAgent", deviceHash });
    },
    async sweepOnRevoke(owner: Keypair, deviceHash: string, agent: string) {
      hash(deviceHash); address(agent);
      return write(owner, { kind: "sweepOnRevoke", deviceHash, token: TESTNET_XLM, agent });
    },
    async revokeDevice(owner: Keypair, deviceHash: string) {
      hash(deviceHash);
      if (await sdk.getEscrowBalance(deviceHash) !== 0n) throw new Error("Cannot revoke device while escrow balance is nonzero");
      return write(owner, { kind: "revokeDevice", deviceHash });
    },
    async revokeAndSweep(owner: Keypair, deviceHash: string): Promise<{ status: TxResult["status"]; transactions: TxResult[] }> {
      hash(deviceHash);
      const transactions: TxResult[] = [];
      const registeredOwner = await sdk.getDeviceOwner(deviceHash);
      if (registeredOwner && registeredOwner !== owner.publicKey()) throw new Error("Device belongs to another owner");
      const policy = await sdk.getPolicy(deviceHash);
      if (policy) {
        const revoked = await client.revokeAgent(owner, deviceHash);
        transactions.push(revoked);
        if (revoked.status !== "SUCCESS") return { status: revoked.status, transactions };
      }
      if (await sdk.getEscrowBalance(deviceHash) > 0n) {
        const agent = policy?.agent ?? await sdk.getDeviceAgent(deviceHash);
        if (!registeredOwner || !agent) throw new Error("Cannot resolve device ownership for sweep");
        const swept = await client.sweepOnRevoke(owner, deviceHash, agent);
        transactions.push(swept);
        if (swept.status !== "SUCCESS") return { status: swept.status, transactions };
      }
      if (registeredOwner) {
        const removed = await client.revokeDevice(owner, deviceHash);
        transactions.push(removed);
        return { status: removed.status, transactions };
      }
      return { status: "SUCCESS", transactions };
    },
    /** In-process guard only. The broker must persist pending results and hold its DB lock. */
    pendingTransaction(publicKey: string) { return unresolved.get(publicKey) ?? null; },
    async reconcilePending(publicKey: string): Promise<TxResult | null> {
      const pending = unresolved.get(publicKey);
      if (!pending) return null;
      const transport = getSubmitter();
      if (!transport.reconcile) throw new Error("Configured submitter does not support reconciliation");
      const result = await transport.reconcile(pending);
      if (result.status !== "PENDING" && unresolved.get(publicKey) === pending) unresolved.delete(publicKey);
      return result;
    },
    readAuthorizeTx(txHash: string) { return readAuthorizeTx(sdk.server, txHash, config.contracts.paymentEscrow); },
  };
  return client;
}

export type NoirClient = ReturnType<typeof createStellarClient>;
