// @vitest-environment node
import { Account, Contract, Keypair, Networks, TransactionBuilder, nativeToScVal, rpc } from "@stellar/stellar-sdk";
import { toCall } from "@noirx402/agent-sdk";
import { describe, expect, it, vi } from "vitest";
import { readAuthorizeTx } from "../src/proof";
import { agent, asset, contracts, deviceHash, merchant } from "./fixtures";

function proof(contract = contracts.paymentEscrow, method = "authorize") {
  const call = toCall(agent.publicKey(), { kind: "authorize", deviceHash, merchant: merchant.publicKey(), asset, amount: 20n, nonce: 9n });
  const tx = new TransactionBuilder(new Account(agent.publicKey(), "1"), { fee: "100", networkPassphrase: Networks.TESTNET })
    .addOperation(new Contract(contract).call(method, ...call.args)).setTimeout(300).build();
  tx.sign(agent);
  return tx;
}

describe("authorize transaction evidence", () => {
  it.each([false, true])("decodes only confirmed payments, including fee bump=%s", async (feeBump) => {
    const inner = proof();
    const tx = feeBump ? TransactionBuilder.buildFeeBumpTransaction(Keypair.random(), "100", inner, Networks.TESTNET) : inner;
    const server = { getTransaction: vi.fn().mockResolvedValue({ status: rpc.Api.GetTransactionStatus.SUCCESS, envelopeXdr: tx.toEnvelope() }) };
    const hash = Buffer.from(tx.hash()).toString("hex");
    expect(await readAuthorizeTx(server, hash, contracts.paymentEscrow)).toEqual({ ok: true, args: {
      agent: agent.publicKey(), deviceHash, merchant: merchant.publicKey(), asset, amount: 20n, nonce: 9n,
    } });
  });
  it.each(["FAILED", "NOT_FOUND"])("rejects %s without inventing payment evidence", async (status) => {
    expect(await readAuthorizeTx({ getTransaction: vi.fn().mockResolvedValue({ status }) }, "ab".repeat(32), contracts.paymentEscrow)).toEqual({ ok: false });
  });
  it.each([
    [contracts.deviceRegistry, "authorize"],
    [contracts.paymentEscrow, "claim"],
  ])("rejects a different contract or method", async (contract, method) => {
    const tx = proof(contract, method);
    expect(await readAuthorizeTx({ getTransaction: vi.fn().mockResolvedValue({ status: "SUCCESS", envelopeXdr: tx.toEnvelope() }) }, Buffer.from(tx.hash()).toString("hex"), contracts.paymentEscrow)).toEqual({ ok: false });
  });
  it("rejects mismatched hashes and malformed argument types", async () => {
    const tx = proof();
    const server = { getTransaction: vi.fn().mockResolvedValue({ status: "SUCCESS", envelopeXdr: tx.toEnvelope() }) };
    expect(await readAuthorizeTx(server, "ab".repeat(32), contracts.paymentEscrow)).toEqual({ ok: false });
    const bad = new TransactionBuilder(new Account(agent.publicKey(), "1"), { fee: "100", networkPassphrase: Networks.TESTNET })
      .addOperation(new Contract(contracts.paymentEscrow).call("authorize", nativeToScVal("bad"))).setTimeout(300).build();
    server.getTransaction.mockResolvedValue({ status: "SUCCESS", envelopeXdr: bad.toEnvelope() });
    expect(await readAuthorizeTx(server, Buffer.from(bad.hash()).toString("hex"), contracts.paymentEscrow)).toEqual({ ok: false });
  });
});
