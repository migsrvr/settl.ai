// @vitest-environment node
import { VeloGasSubmissionUnknownError, VeloValidationError } from "@carts1024/velo-sdk";
import { Account, Address, Contract, Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";
import { createProvisioningSubmitter } from "./provisioning-submitter";

const config = { networkPassphrase: Networks.TESTNET, rpcUrl: "https://example.invalid", contracts: { deviceRegistry: "", agentRegistry: "", paymentEscrow: "" }, gasApiKey: "test" };
function signed() {
  const owner = Keypair.random();
  const tx = new TransactionBuilder(new Account(owner.publicKey(), "1"), { fee: "1000", networkPassphrase: Networks.TESTNET })
    .addOperation(new Contract(Address.contract(Buffer.alloc(32, 1)).toString()).call("register"))
    .setTimeout(60).build(); tx.sign(owner); return tx;
}
function setup() {
  const tx = signed(); const innerHash = Buffer.from(tx.hash()).toString("hex");
  const save = vi.fn().mockResolvedValue(undefined);
  const gas = { sponsorAndSubmit: vi.fn().mockResolvedValue({ requestId: "request", transactionHash: innerHash }), waitForResult: vi.fn().mockResolvedValue({ requestId: "request", transactionHash: innerHash, status: "succeeded" }) };
  const server = { sendTransaction: vi.fn().mockResolvedValue({ status: "PENDING", hash: innerHash }), getTransaction: vi.fn().mockResolvedValue({ status: "SUCCESS" }) };
  return { tx, innerHash, save, gas, server, submitter: createProvisioningSubmitter({ ...config, gas, rpc: server }, save) };
}
describe("provisioning-only durable submission", () => {
  it("persists signed hash before submit and Velo identity before waiting", async () => {
    const s = setup(); await s.submitter.submit(s.tx.toXdr());
    expect(s.save.mock.calls[0][0]).toMatchObject({ status: "PENDING", hash: s.innerHash, innerHash: s.innerHash });
    expect(s.save.mock.invocationCallOrder[0]).toBeLessThan(s.gas.sponsorAndSubmit.mock.invocationCallOrder[0]);
    expect(s.save.mock.calls[1][0]).toMatchObject({ recovery: { requestId: "request", transactionHash: s.innerHash } });
    expect(s.save.mock.invocationCallOrder[1]).toBeLessThan(s.gas.waitForResult.mock.invocationCallOrder[0]);
  });
  it("does not submit when the signed-hash checkpoint fails", async () => {
    const s = setup(); s.save.mockRejectedValue(new Error("lost lease"));
    await expect(s.submitter.submit(s.tx.toXdr())).rejects.toThrow(); expect(s.gas.sponsorAndSubmit).not.toHaveBeenCalled();
  });
  it("persists the recovery identity from an unknown submission before observing it", async () => {
    const s = setup(); s.gas.sponsorAndSubmit.mockRejectedValue(new VeloGasSubmissionUnknownError({ requestId: "request", transactionHash: s.innerHash }, "timeout"));
    await s.submitter.submit(s.tx.toXdr());
    expect(s.save.mock.calls[1][0]).toMatchObject({ recovery: { requestId: "request" } });
  });
  it("reconciles stored identities without sponsoring or submitting", async () => {
    const s = setup();
    await s.submitter.reconcile!({ status: "PENDING", hash: s.innerHash, innerHash: s.innerHash, transport: "velo", recovery: { requestId: "request", transactionHash: s.innerHash } });
    expect(s.gas.sponsorAndSubmit).not.toHaveBeenCalled(); expect(s.server.sendTransaction).not.toHaveBeenCalled();
  });
  it("persists a relayer outer hash before sending the fee-bump envelope", async () => {
    const s = setup();
    s.gas.sponsorAndSubmit.mockRejectedValue(new VeloValidationError("denied", { code: "contract_not_whitelisted" }));
    const submitter = createProvisioningSubmitter({ ...config, gas: s.gas, rpc: s.server, relayer: Keypair.random(), timeoutMs: 5, pollMs: 1 }, s.save);
    await submitter.submit(s.tx.toXdr());
    const outer = s.save.mock.calls[1][0]; expect(outer).toMatchObject({ status: "PENDING", transport: "relayer", innerHash: s.innerHash });
    expect(outer.hash).not.toBe(s.innerHash);
    expect(s.save.mock.invocationCallOrder[1]).toBeLessThan(s.server.sendTransaction.mock.invocationCallOrder[0]);
  });
  it("does not begin waiting if the execution identity checkpoint fails", async () => {
    const s = setup(); s.save.mockResolvedValueOnce(undefined).mockRejectedValue(new Error("lost lease"));
    expect(await s.submitter.submit(s.tx.toXdr())).toMatchObject({ status: "PENDING" });
    expect(s.gas.waitForResult).not.toHaveBeenCalled();
  });
});
