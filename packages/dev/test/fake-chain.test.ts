import { describe, expect, it } from "vitest";
import { FakeChain } from "../src/fake-chain";

const device = "d".repeat(64);
const agent = { publicKey: () => "GAGENT" };
const args = (nonce: bigint, amount = 2_000_000n) => ({
  agent: "GAGENT", deviceHash: device, merchant: "GMERCHANT", asset: "native", amount, nonce,
});

describe("FakeChain", () => {
  it("starts with empty balances", async () => {
    const chain = new FakeChain();
    expect(await chain.balanceOf(device)).toBe(0n);
    expect(await chain.pendingBalance("GMERCHANT")).toBe(0n);
  });

  it("moves value from escrow to the merchant pending balance and returns a 64-hex hash", async () => {
    const chain = new FakeChain();
    chain.fund(device, 10_000_000n);
    const result = await chain.authorize(agent, args(1n));
    expect(result.status).toBe("SUCCESS");
    expect(result.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.innerHash).toBe(result.hash);
    expect(await chain.balanceOf(device)).toBe(8_000_000n);
    expect(await chain.pendingBalance("GMERCHANT")).toBe(2_000_000n);
  });

  it("produces distinct hashes per payment and the same evidence on read", async () => {
    const chain = new FakeChain();
    chain.fund(device, 10_000_000n);
    const first = await chain.authorize(agent, args(1n));
    const second = await chain.authorize(agent, args(2n));
    expect(second.hash).not.toBe(first.hash);
    expect(await chain.readAuthorizeTx(first.hash)).toEqual({ ok: true, args: args(1n) });
    expect(await chain.readAuthorizeTx("0".repeat(64))).toEqual({ ok: false });
  });

  it("rejects a payment above the escrow balance without changing anything", async () => {
    const chain = new FakeChain();
    chain.fund(device, 1_000_000n);
    const result = await chain.authorize(agent, args(1n));
    expect(result).toMatchObject({ status: "FAILED", error: "insufficient_escrow" });
    expect(await chain.balanceOf(device)).toBe(1_000_000n);
    expect(await chain.pendingBalance("GMERCHANT")).toBe(0n);
  });

  it("requires strictly increasing nonces per device and agent but allows gaps", async () => {
    const chain = new FakeChain();
    chain.fund(device, 10_000_000n);
    expect((await chain.authorize(agent, args(5n))).status).toBe("SUCCESS");
    expect(await chain.authorize(agent, args(5n))).toMatchObject({ status: "FAILED", error: "nonce_not_increasing" });
    expect(await chain.authorize(agent, args(3n))).toMatchObject({ status: "FAILED", error: "nonce_not_increasing" });
    expect((await chain.authorize(agent, args(9n))).status).toBe("SUCCESS");
  });

  it("can be told to fail exactly the next payment", async () => {
    const chain = new FakeChain();
    chain.fund(device, 10_000_000n);
    chain.failNext("sandbox_forced_failure");
    expect(await chain.authorize(agent, args(1n))).toMatchObject({ status: "FAILED", error: "sandbox_forced_failure" });
    expect(await chain.balanceOf(device)).toBe(10_000_000n);
    expect((await chain.authorize(agent, args(1n))).status).toBe("SUCCESS");
  });

  it("pays out a merchant's pending balance on claim", async () => {
    const chain = new FakeChain();
    chain.fund(device, 10_000_000n);
    await chain.authorize(agent, args(1n));
    expect(chain.claim("GMERCHANT")).toBe(2_000_000n);
    expect(await chain.pendingBalance("GMERCHANT")).toBe(0n);
    expect(chain.claim("GMERCHANT")).toBe(0n);
  });
});
