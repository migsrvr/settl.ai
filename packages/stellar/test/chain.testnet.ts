// @vitest-environment node
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Velo } from "@carts1024/velo-sdk";
import { Keypair, Networks, StrKey, rpc } from "@stellar/stellar-sdk";
import { beforeAll, describe, expect, it } from "vitest";
import { createStellarClient, deviceHashForAgent, fundTestnetAccount, loadStellarConfig, TESTNET_XLM } from "../src/index";
import type { StellarConfig, TxResult } from "../src/index";

let config: StellarConfig;
let checkout: Velo;

beforeAll(() => {
  const envPath = fileURLToPath(new URL("../../../apps/web/.env.local", import.meta.url));
  if (existsSync(envPath)) process.loadEnvFile(envPath);
  const missing = ["VELO_GAS_API_KEY", "VELO_API_KEY"].filter((name) => !process.env[name]?.trim());
  if (missing.length) throw new Error(`Live tests stopped before any network writes. Populate ${missing.join(", ")} in apps/web/.env.local using .env.example. DATABASE_URL is not required.`);
  config = loadStellarConfig();
  checkout = new Velo({ apiKey: process.env.VELO_API_KEY!, environment: "testnet", timeoutMs: 30_000 });
});

function confirmed(operation: string, result: TxResult) {
  // This projection contains public evidence only; never log keys, envelopes, or raw errors.
  console.info(JSON.stringify({ at: new Date().toISOString(), operation, ...result }));
  expect(result.status, `${operation}: ${result.error ?? result.status}`).toBe("SUCCESS");
}

describe("explicit Stellar testnet gate", () => {
  it("registers, funds, authorizes, claims, and safely revokes using real contracts", async () => {
    const server = new rpc.Server(config.rpcUrl);
    expect((await server.getNetwork()).passphrase).toBe(Networks.TESTNET);
    const owner = Keypair.random();
    const agent = Keypair.random();
    const merchant = Keypair.random();
    const funder = Keypair.random();
    const relayer = Keypair.random();
    const deviceHash = deviceHashForAgent(`testnet:${randomUUID()}`);
    console.info(JSON.stringify({ operation: "testnet_setup", deviceHash, owner: owner.publicKey(), agent: agent.publicKey(), merchant: merchant.publicKey(), contracts: config.contracts }));
    for (const wallet of [owner, agent, merchant, funder, relayer]) await fundTestnetAccount(wallet.publicKey());
    const client = createStellarClient(config, { relayer });
    confirmed("registerDevice", await client.registerDevice(owner, deviceHash, agent.publicKey()));
    confirmed("registerAgent", await client.registerAgent(owner, {
      deviceHash, agent: agent.publicKey(), maxAmount: 10_000_000n,
      asset: TESTNET_XLM, expiresAt: BigInt(Math.floor(Date.now() / 1000) + 3600),
    }));
    expect(await client.getPolicy(deviceHash)).toMatchObject({ owner: owner.publicKey(), agent: agent.publicKey(), maxAmount: 10_000_000n, asset: TESTNET_XLM });
    confirmed("fundEscrow", await client.fundEscrow(funder, deviceHash, 20_000_000n));
    expect(await client.escrowToken(deviceHash)).toBe(TESTNET_XLM);
    expect(await client.balanceOf(deviceHash)).toBe(20_000_000n);
    const args = { agent: agent.publicKey(), deviceHash, merchant: merchant.publicKey(), asset: TESTNET_XLM, amount: 2_000_000n, nonce: 1n };
    const paid = await client.authorize(agent, args);
    confirmed("authorize", paid);
    expect(await client.readAuthorizeTx(paid.hash)).toEqual({ ok: true, args });
    expect(await client.balanceOf(deviceHash)).toBe(18_000_000n);
    expect(await client.pendingBalance(merchant.publicKey())).toBe(2_000_000n);
    confirmed("claim", await client.claim(merchant));
    expect(await client.pendingBalance(merchant.publicKey())).toBe(0n);
    const revoked = await client.revokeAndSweep(owner, deviceHash);
    revoked.transactions.forEach((tx, index) => confirmed(["revokeAgent", "sweepOnRevoke", "revokeDevice"][index], tx));
    expect(revoked.status).toBe("SUCCESS");
    expect(await client.balanceOf(deviceHash)).toBe(0n);
    expect(await client.getPolicy(deviceHash)).toBeNull();
  });

  it("records the project's live Velo checkout receiver without assuming treasury control", async () => {
    const created = await checkout.checkout.sessions.create({
      amount: "1.00", asset: "native", anchor: "inhouse", description: "Settl testnet routing spike",
      successUrl: "http://localhost:3000/buyer", cancelUrl: "http://localhost:3000/buyer",
    }, { idempotencyKey: `settl-checkout-spike:${randomUUID()}` });
    let intent = await checkout.paymentIntents.retrieve(created.paymentIntentId);
    for (let attempt = 0; !intent.receiverAddress && intent.status === "awaiting_route" && attempt < 20; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      intent = await checkout.paymentIntents.retrieve(created.paymentIntentId);
    }
    console.info(JSON.stringify({
      at: new Date().toISOString(), operation: "checkout_route", paymentIntentId: intent.paymentIntentId,
      receiverAddress: intent.receiverAddress, receiverMemo: intent.receiverMemo, asset: intent.asset,
      amount: intent.amount, anchor: intent.anchor, status: intent.status, checkoutUrl: intent.checkoutUrl,
      settlementVerified: intent.status === "paid",
    }));
    expect(intent.anchor).toBe("inhouse");
    expect(intent.asset).toMatch(/^(native|XLM)$/);
    expect(typeof intent.receiverAddress === "string" && StrKey.isValidEd25519PublicKey(intent.receiverAddress)).toBe(true);
    // The public SDK creates/retrieves checkout. Hosted wallet payment + scanner confirmation
    // must be observed separately; a receiver address alone never proves funds arrived.
  });
});
