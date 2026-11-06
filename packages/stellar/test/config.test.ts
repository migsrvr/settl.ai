// @vitest-environment node
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { Keypair, Networks } from "@stellar/stellar-sdk";
import { loadStellarConfig, deviceHashForAgent, fundTestnetAccount } from "../src/index";
import { contracts } from "./fixtures";

const env = parseEnv(readFileSync(new URL("../../../.env.example", import.meta.url), "utf8"));

describe("testnet configuration and accounts", () => {
  it("uses the template IDs, never Noir SDK defaults, without needing database or Velo keys", () => {
    expect(loadStellarConfig(env)).toMatchObject({ contracts, networkPassphrase: Networks.TESTNET });
  });
  it("rejects missing IDs and non-testnet network settings", () => {
    expect(() => loadStellarConfig({ ...env, NOIR_PAYMENT_ESCROW_ID: "" })).toThrow(/NOIR_PAYMENT_ESCROW_ID/);
    expect(() => loadStellarConfig({ ...env, STELLAR_NETWORK_PASSPHRASE: Networks.PUBLIC })).toThrow(/testnet/i);
    expect(() => loadStellarConfig({ ...env, STELLAR_RPC_URL: "https://soroban.stellar.org" })).toThrow(/testnet/i);
  });
  it("computes the documented deterministic device hash", () => {
    expect(deviceHashForAgent("a1")).toMatch(/^[a-f0-9]{64}$/);
    expect(deviceHashForAgent("a1")).toBe(deviceHashForAgent("a1"));
    expect(deviceHashForAgent("a1")).not.toBe(deviceHashForAgent("a2"));
  });
  it("uses Friendbot's fixed testnet origin with only the public key", async () => {
    const key = Keypair.random();
    const fetcher = vi.fn().mockResolvedValue(new Response("{}"));
    await fundTestnetAccount(key.publicKey(), fetcher);
    expect(String(fetcher.mock.calls[0][0])).toBe(`https://friendbot.stellar.org/?addr=${key.publicKey()}`);
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain(key.secret());
  });
  it("reports faucet errors instead of declaring an account funded", async () => {
    await expect(fundTestnetAccount(Keypair.random().publicKey(), vi.fn().mockResolvedValue(new Response("no", { status: 429 })))).rejects.toThrow(/429/);
  });
});
