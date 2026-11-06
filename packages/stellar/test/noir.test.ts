// @vitest-environment node
import { Account, Address, Networks, Transaction, TransactionBuilder, scValToNative } from "@stellar/stellar-sdk";
import type { NoirOperation } from "@noirx402/agent-sdk";
import { describe, expect, it, vi } from "vitest";
import { createStellarClient, type TxResult } from "../src/index";
import { PreparedNoirClient } from "../src/rpc";
import { agent, asset, config, contracts, deviceHash, merchant, owner } from "./fixtures";

const success: TxResult = { status: "SUCCESS", hash: "12".repeat(32), innerHash: "34".repeat(32), transport: "velo" };
const args = { agent: agent.publicKey(), deviceHash, merchant: merchant.publicKey(), asset, amount: 20_000_000n, nonce: 1n };

function setup() {
  const sdk = new PreparedNoirClient({ network: config });
  vi.spyOn(sdk.server, "getAccount").mockImplementation(async (source) => new Account(source, "1"));
  // Preserve actual Noir call encoding + Stellar 17 XDR, while avoiding network I/O.
  vi.spyOn(sdk.server, "prepareTransaction").mockImplementation(async (tx) => {
    if (!(tx instanceof Transaction)) throw new Error("Expected inner transaction");
    return tx;
  });
  vi.spyOn(sdk, "getEscrowBalance").mockResolvedValue(0n);
  vi.spyOn(sdk, "getEscrowToken").mockResolvedValue(asset);
  vi.spyOn(sdk, "getDeviceOwner").mockResolvedValue(owner.publicKey());
  vi.spyOn(sdk, "getDeviceAgent").mockResolvedValue(agent.publicKey());
  vi.spyOn(sdk, "getPolicy").mockResolvedValue({ agent: agent.publicKey(), maxAmount: 10n, asset, expiresAt: new Date(2_000_000_000_000) });
  vi.spyOn(sdk, "getPendingBalance").mockResolvedValue(45n);
  const submitter = { submit: vi.fn().mockResolvedValue(success), reconcile: vi.fn().mockResolvedValue(success) };
  const client = createStellarClient(config, { sdk, submitter });
  return { sdk, client, submitter };
}

describe("Noir adapter", () => {
  it("prepares against the explicit contract IDs instead of the SDK defaults", () => {
    const { sdk } = setup();
    expect(sdk.contracts).toEqual(contracts);
  });
  it.each([
    [{ kind: "registerDevice", deviceHash, agent: agent.publicKey() }, "register", "deviceRegistry", [owner.publicKey(), deviceHash, agent.publicKey()]],
    [{ kind: "registerAgent", deviceHash, agent: agent.publicKey(), asset, maxAmount: 10n, expiresAt: new Date(2_000_000_000_000) }, "register_agent", "agentRegistry", [owner.publicKey(), deviceHash, agent.publicKey(), 10n, asset, 2_000_000_000n]],
    [{ kind: "fundEscrow", deviceHash, token: asset, amount: 10n }, "fund_escrow", "paymentEscrow", [asset, owner.publicKey(), deviceHash, 10n]],
    [{ kind: "authorize", deviceHash, merchant: merchant.publicKey(), asset, amount: 10n, nonce: 9_007_199_254_740_993n }, "authorize", "paymentEscrow", [owner.publicKey(), deviceHash, merchant.publicKey(), asset, 10n, 9_007_199_254_740_993n]],
    [{ kind: "claim", token: asset }, "claim", "paymentEscrow", [asset, owner.publicKey()]],
    [{ kind: "revokeAgent", deviceHash }, "revoke_agent", "agentRegistry", [owner.publicKey(), deviceHash]],
    [{ kind: "sweepOnRevoke", deviceHash, token: asset, agent: agent.publicKey() }, "sweep_on_revoke", "paymentEscrow", [asset, deviceHash, agent.publicKey()]],
    [{ kind: "revokeDevice", deviceHash }, "revoke", "deviceRegistry", [owner.publicKey(), deviceHash]],
  ] as const)("encodes call %# with the actual Noir SDK and Stellar SDK 17", async (op, method, contract, expected) => {
    const { sdk } = setup();
    const xdr = await sdk.prepare(owner.publicKey(), op as NoirOperation);
    const tx = TransactionBuilder.fromXdr(xdr, Networks.TESTNET);
    if (!(tx instanceof Transaction)) throw new Error("Expected an inner transaction");
    expect(tx.operations).toHaveLength(1);
    const fn = tx.operations[0];
    if (fn.type !== "invokeHostFunction") throw new Error("Expected a contract invocation");
    if (fn.func.type !== "hostFunctionTypeInvokeContract") throw new Error("Expected invokeContract");
    const invoke = fn.func.invokeContract;
    expect(Address.fromScAddress(invoke.contractAddress).toString()).toBe(contracts[contract]);
    expect(invoke.functionName.toString()).toBe(method);
    const decoded = invoke.args.map(scValToNative).map((v) => v instanceof Uint8Array ? Buffer.from(v).toString("hex") : v);
    expect(decoded).toEqual(expected);
    if (method === "authorize") {
      expect(invoke.args[4].type).toBe("scvI128");
      expect(invoke.args[5].type).toBe("scvU64");
    }
  });
  it("signs with the acting wallet and routes every write through the submitter", async () => {
    const { client, sdk, submitter } = setup();
    vi.mocked(sdk.server.getAccount).mockResolvedValue(new Account(agent.publicKey(), "1"));
    expect(await client.authorize(agent, args)).toEqual(success);
    const signed = TransactionBuilder.fromXdr(submitter.submit.mock.calls[0][0], Networks.TESTNET);
    expect(agent.verify(signed.hash(), signed.signatures[0].signature.toBytes())).toBe(true);
    expect(sdk.server.getAccount).toHaveBeenCalledWith(agent.publicKey());
  });
  it("rejects a mismatched signer, invalid device hash, nonpositive amounts and invalid nonces before preparing", async () => {
    const { client, sdk } = setup();
    const prepare = vi.spyOn(sdk, "prepare");
    for (const patch of [{ agent: owner.publicKey() }, { deviceHash: "bad" }, { amount: 0n }, { nonce: -1n }, { nonce: 2n ** 64n }]) {
      await expect(client.authorize(agent, { ...args, ...patch })).rejects.toThrow();
    }
    expect(prepare).not.toHaveBeenCalled();
  });
  it("funds from a wallet other than the device owner", async () => {
    const { client, sdk } = setup();
    const prepare = vi.spyOn(sdk, "prepare");
    await client.fundEscrow(merchant, deviceHash, 10n);
    expect(prepare).toHaveBeenCalledWith(merchant.publicKey(), { kind: "fundEscrow", deviceHash, token: asset, amount: 10n });
  });
  it("reads balances and nullable per-device token and policy without submission", async () => {
    const { client, sdk, submitter } = setup();
    expect(await client.balanceOf(deviceHash)).toBe(0n);
    expect(await client.pendingBalance(merchant.publicKey())).toBe(45n);
    expect(await client.escrowToken(deviceHash)).toBe(asset);
    expect(await client.getPolicy(deviceHash)).toEqual({ owner: owner.publicKey(), agent: agent.publicKey(), maxAmount: 10n, asset, expiresAt: 2_000_000_000n });
    vi.mocked(sdk.getPolicy).mockResolvedValue(null);
    vi.mocked(sdk.getEscrowToken).mockResolvedValue(null);
    expect(await client.getPolicy(deviceHash)).toBeNull();
    expect(await client.escrowToken(deviceHash)).toBeNull();
    expect(submitter.submit).not.toHaveBeenCalled();
  });
  it("revokes, sweeps, confirms zero balance, then removes identity", async () => {
    const { client, sdk, submitter } = setup();
    vi.mocked(sdk.getEscrowBalance).mockResolvedValueOnce(50n).mockResolvedValue(0n);
    const prepare = vi.spyOn(sdk, "prepare");
    const result = await client.revokeAndSweep(owner, deviceHash);
    expect(result.status).toBe("SUCCESS");
    expect(prepare.mock.calls.map(([, op]) => op.kind)).toEqual(["revokeAgent", "sweepOnRevoke", "revokeDevice"]);
    expect(submitter.submit).toHaveBeenCalledTimes(3);
  });
  it.each(["FAILED", "PENDING"] as const)("stops the revoke sequence on %s", async (status) => {
    const { client, submitter } = setup();
    submitter.submit.mockResolvedValueOnce({ ...success, status, error: "not_confirmed" });
    expect((await client.revokeAndSweep(owner, deviceHash)).status).toBe(status);
    expect(submitter.submit).toHaveBeenCalledTimes(1);
  });
  it("refuses identity removal if a sweep leaves funds behind", async () => {
    const { client, sdk, submitter } = setup();
    vi.mocked(sdk.getEscrowBalance).mockResolvedValue(50n);
    await expect(client.revokeAndSweep(owner, deviceHash)).rejects.toThrow(/balance/i);
    expect(submitter.submit).toHaveBeenCalledTimes(2);
    await expect(client.revokeDevice(owner, deviceHash)).rejects.toThrow(/balance/i);
  });
  it("resumes a revoked policy using the device's recorded agent", async () => {
    const { client, sdk } = setup();
    vi.mocked(sdk.getPolicy).mockResolvedValue(null);
    vi.mocked(sdk.getEscrowBalance).mockResolvedValueOnce(50n).mockResolvedValue(0n);
    const prepare = vi.spyOn(sdk, "prepare");
    await client.revokeAndSweep(owner, deviceHash);
    expect(prepare.mock.calls.map(([, op]) => op.kind)).toEqual(["sweepOnRevoke", "revokeDevice"]);
  });
  it("serializes operations sharing a signing account and blocks reuse after an uncertain outcome", async () => {
    const { client, submitter } = setup();
    let finish!: (value: TxResult) => void;
    submitter.submit.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const first = client.authorize(agent, args);
    const second = client.authorize(agent, { ...args, nonce: 2n });
    await vi.waitFor(() => expect(submitter.submit).toHaveBeenCalledTimes(1));
    finish({ ...success, status: "PENDING" });
    expect((await first).status).toBe("PENDING");
    await expect(second).rejects.toThrow(/pending|unresolved/i);
    expect(submitter.submit).toHaveBeenCalledTimes(1);
  });
  it("unblocks a source only after its saved pending result is reconciled", async () => {
    const { client, submitter } = setup();
    submitter.submit.mockResolvedValueOnce({ ...success, status: "PENDING" });
    await client.authorize(agent, args);
    submitter.reconcile.mockResolvedValueOnce({ ...success, status: "PENDING" });
    expect((await client.reconcilePending(agent.publicKey()))?.status).toBe("PENDING");
    await expect(client.authorize(agent, { ...args, nonce: 2n })).rejects.toThrow(/pending|unresolved/i);
    expect((await client.reconcilePending(agent.publicKey()))?.status).toBe("SUCCESS");
    expect(await client.authorize(agent, { ...args, nonce: 2n })).toEqual(success);
    expect(submitter.reconcile).toHaveBeenCalledTimes(2);
  });
});
