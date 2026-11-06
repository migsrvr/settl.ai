// @vitest-environment node
import { VeloGasSubmissionUnknownError, VeloGasWaitError, VeloValidationError } from "@carts1024/velo-sdk";
import { Account, Contract, Keypair, Networks, SorobanDataBuilder, TransactionBuilder } from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";
import { GasSubmitter } from "../src/index";
import { agent, config, contracts, envelope, gasResult } from "./fixtures";

function setup() {
  const gas = { sponsorAndSubmit: vi.fn().mockResolvedValue(gasResult("submitted")), waitForResult: vi.fn().mockResolvedValue(gasResult()) };
  const rpc = { sendTransaction: vi.fn(), getTransaction: vi.fn() };
  const relayer = Keypair.random();
  const submitter = new GasSubmitter({ ...config, gas, rpc, relayer, pollMs: 0, timeoutMs: 10 });
  return { gas, rpc, relayer, submitter };
}

describe("fee sponsorship and recovery", () => {
  it("submits once using a hash-derived idempotency key, then waits for ledger success", async () => {
    const { gas, submitter } = setup();
    const signed = envelope();
    const innerHash = Buffer.from(TransactionBuilder.fromXdr(signed, Networks.TESTNET).hash()).toString("hex");
    gas.waitForResult.mockResolvedValue({ ...gasResult(), transactionHash: innerHash });
    gas.sponsorAndSubmit.mockResolvedValue({ ...gasResult("submitted"), transactionHash: innerHash });
    const result = await submitter.submit(signed);
    expect(gas.sponsorAndSubmit).toHaveBeenCalledWith(signed, { idempotencyKey: `settl:${innerHash}` });
    expect(gas.waitForResult).toHaveBeenCalledWith({ requestId: "gas-request-1", transactionHash: innerHash }, expect.any(Object));
    expect(result).toMatchObject({ status: "SUCCESS", hash: "cd".repeat(32), innerHash, transport: "velo", actualFeeStroops: "1234" });
  });
  it.each(["submitted", "submission_unknown"] as const)("keeps %s pending instead of recording a payment", async (status) => {
    const { gas, rpc, submitter } = setup();
    gas.waitForResult.mockResolvedValue(gasResult(status));
    expect(await submitter.submit(envelope())).toMatchObject({ status: "PENDING", recovery: { requestId: "gas-request-1" } });
    expect(rpc.sendTransaction).not.toHaveBeenCalled();
  });
  it.each(["failed", "cancelled"] as const)("treats %s as non-success", async (status) => {
    const { gas, rpc, submitter } = setup();
    gas.waitForResult.mockResolvedValue(gasResult(status));
    expect(await submitter.submit(envelope())).toMatchObject({ status: "FAILED", error: status });
    expect(rpc.sendTransaction).not.toHaveBeenCalled();
  });
  it("recovers uncertain handoffs by identity without resubmitting or falling back", async () => {
    const { gas, rpc, submitter } = setup();
    const identity = { requestId: "r1", transactionHash: gasResult().transactionHash };
    gas.sponsorAndSubmit.mockRejectedValue(new VeloGasSubmissionUnknownError(identity, "timeout"));
    gas.waitForResult.mockRejectedValue(new VeloGasWaitError(identity, "timeout"));
    expect(await submitter.submit(envelope())).toMatchObject({ status: "PENDING", recovery: identity });
    expect(gas.sponsorAndSubmit).toHaveBeenCalledTimes(1);
    expect(gas.waitForResult).toHaveBeenCalledWith(identity, expect.any(Object));
    expect(rpc.sendTransaction).not.toHaveBeenCalled();
    gas.waitForResult.mockResolvedValue({ ...gasResult(), requestId: identity.requestId });
    expect(await submitter.recover(identity)).toMatchObject({ status: "SUCCESS" });
    expect(gas.sponsorAndSubmit).toHaveBeenCalledTimes(1);
  });
  it.each(["contract_not_whitelisted", "policy_disabled"])("uses a relayer-signed fee bump for %s", async (code) => {
    const { gas, rpc, relayer, submitter } = setup();
    gas.sponsorAndSubmit.mockRejectedValue(new VeloValidationError("denied", { code }));
    rpc.sendTransaction.mockImplementation(async (tx) => ({ status: "PENDING", hash: Buffer.from(tx.hash()).toString("hex") }));
    rpc.getTransaction.mockResolvedValue({ status: "SUCCESS" });
    const signed = envelope();
    const result = await submitter.submit(signed);
    const bump = rpc.sendTransaction.mock.calls[0][0];
    expect(bump.feeSource).toBe(relayer.publicKey());
    expect(bump.innerTransaction.toXdr()).toBe(signed);
    expect(relayer.verify(bump.hash(), bump.signatures[0].signature.toBytes())).toBe(true);
    expect(result).toMatchObject({ status: "SUCCESS", transport: "relayer", sponsorshipError: code });
    expect(gas.waitForResult).not.toHaveBeenCalled();
  });
  it.each(["daily_cap_exceeded", "wallet_rate_limited", "unauthorized"])("never falls back for %s", async (code) => {
    const { gas, rpc, submitter } = setup();
    gas.sponsorAndSubmit.mockRejectedValue(new VeloValidationError("denied", { code }));
    expect(await submitter.submit(envelope())).toMatchObject({ status: "FAILED", error: code });
    expect(rpc.sendTransaction).not.toHaveBeenCalled();
  });
  it.each(["contract_not_whitelisted", "policy_disabled"])("retains a relayer transaction hash when RPC submission is uncertain after %s", async (code) => {
    const { gas, rpc, submitter } = setup();
    gas.sponsorAndSubmit.mockRejectedValue(new VeloValidationError("denied", { code }));
    rpc.sendTransaction.mockRejectedValue(new Error("network timeout"));
    const result = await submitter.submit(envelope());
    expect(result).toMatchObject({ status: "PENDING", transport: "relayer", sponsorshipError: code });
    expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(rpc.sendTransaction).toHaveBeenCalledTimes(1);
  });
  it("rejects unsigned or non-Soroban envelopes before contacting Velo", async () => {
    const { gas, submitter } = setup();
    const tx = TransactionBuilder.fromXdr(envelope(), Networks.TESTNET);
    tx.signatures.splice(0);
    await expect(submitter.submit(tx.toXdr())).rejects.toThrow(/signed/i);
    expect(gas.sponsorAndSubmit).not.toHaveBeenCalled();
  });
  it("reconciles a pending relayer hash using RPC alone", async () => {
    const { gas, rpc, submitter } = setup();
    rpc.getTransaction.mockResolvedValue({ status: "SUCCESS" });
    expect(await submitter.reconcile({ status: "PENDING", hash: "12".repeat(32), innerHash: "34".repeat(32), transport: "relayer" })).toMatchObject({ status: "SUCCESS" });
    expect(gas.sponsorAndSubmit).not.toHaveBeenCalled();
    expect(rpc.sendTransaction).not.toHaveBeenCalled();
  });
  it.each(["contract_not_whitelisted", "policy_disabled"])("preserves %s when reconciling a pending relayer transaction", async (sponsorshipError) => {
    const { gas, rpc, submitter } = setup();
    rpc.getTransaction.mockResolvedValue({ status: "SUCCESS" });
    const pending = { status: "PENDING" as const, hash: "12".repeat(32), innerHash: "34".repeat(32), transport: "relayer" as const, sponsorshipError };
    expect(await submitter.reconcile(pending)).toMatchObject({ ...pending, status: "SUCCESS" });
    expect(gas.sponsorAndSubmit).not.toHaveBeenCalled();
    expect(rpc.sendTransaction).not.toHaveBeenCalled();
  });
  it("does not mistake a different transaction's sponsorship result for this payment", async () => {
    const { gas, rpc, submitter } = setup();
    gas.sponsorAndSubmit.mockResolvedValue({ ...gasResult(), transactionHash: "ff".repeat(32) });
    expect(await submitter.submit(envelope())).toMatchObject({ status: "PENDING", error: "identity_mismatch" });
    expect(gas.waitForResult).not.toHaveBeenCalled();
    expect(rpc.sendTransaction).not.toHaveBeenCalled();
  });
  it("refuses a mismatched identity returned during observation", async () => {
    const { gas, submitter } = setup();
    gas.waitForResult.mockResolvedValue({ ...gasResult(), requestId: "different" });
    expect(await submitter.submit(envelope())).toMatchObject({ status: "PENDING", error: "identity_mismatch" });
  });
  it("counts Soroban resource fees once in the relayer fee bump", async () => {
    const { gas, rpc, submitter } = setup();
    gas.sponsorAndSubmit.mockRejectedValue(new VeloValidationError("denied", { code: "contract_not_whitelisted" }));
    rpc.sendTransaction.mockResolvedValue({ status: "PENDING", hash: "ab".repeat(32) });
    rpc.getTransaction.mockResolvedValue({ status: "SUCCESS" });
    const tx = new TransactionBuilder(new Account(agent.publicKey(), "1"), { fee: "100", networkPassphrase: Networks.TESTNET })
      .addOperation(new Contract(contracts.paymentEscrow).call("authorize"))
      .setSorobanData(new SorobanDataBuilder().setResourceFee("900").build()).setTimeout(300).build();
    tx.sign(agent);
    await submitter.submit(tx.toXdr());
    expect(rpc.sendTransaction.mock.calls[0][0].fee).toBe("1100");
  });
});
