// @vitest-environment node
import { createHash } from "node:crypto";
import type { PrismaClient } from "../lib/generated/prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decryptWalletSecret } from "../lib/server/wallets";
import { seedDemo } from "./seed";

vi.mock("../lib/server/db", () => ({ getDb: vi.fn() }));

function database() {
  const orgs = new Map<string, Record<string, unknown>>();
  const agents = new Map<string, Record<string, unknown>>();
  const upsert = (rows = new Map<string, Record<string, unknown>>()) => vi.fn(async (args: {
    where: Record<string, unknown>; create: Record<string, unknown>; update: Record<string, unknown>;
  }) => {
    const id = Object.values(args.where).join(":");
    const row = rows.get(id) ?? { ...args.create };
    rows.set(id, { ...row, ...args.update });
    return rows.get(id)!;
  });
  const tx = {
    org: { upsert: upsert(orgs) }, provider: { upsert: upsert() },
    endpoint: { upsert: upsert() }, agent: { upsert: upsert(agents) },
    policy: { upsert: upsert() }, agentApiKey: { upsert: upsert() },
    providerSettings: { upsert: upsert() }, agentSettings: { upsert: upsert() },
  };
  const client = { $transaction: vi.fn(async (work: (transaction: typeof tx) => Promise<void>) => work(tx)) };
  return { tx, client: client as unknown as PrismaClient, orgs, agents };
}

afterEach(() => vi.unstubAllEnvs());

describe("database demo seed", () => {
  it("stores encrypted wallets and a SHA-256 API-key hash without claiming chain provisioning", async () => {
    vi.stubEnv("WALLET_ENC_KEY", "12".repeat(32));
    const { tx, client, orgs, agents } = database();
    await seedDemo(client, { phpPerXlm: 15, apiKey: "stl_agent_bookkeeper_demo" });
    expect(orgs.get("org_resibo")?.email).toBe("mara@example.com");
    expect(orgs.get("org_juan")?.email).toBe("juan@example.com");
    for (const row of orgs.values()) {
      expect(decryptWalletSecret(row.walletSecretEnc as string)).toMatch(/^S[A-Z2-7]{55}$/);
      expect(row.walletSecretEnc).toMatch(/^v1:/);
    }
    const agent = agents.get("bookkeeper")!;
    expect(agent.status).toBe("provisioning");
    expect(decryptWalletSecret(agent.agentSecretEnc as string)).toMatch(/^S[A-Z2-7]{55}$/);
    expect(agent.deviceHash).toBe(createHash("sha256").update(`settl:agent:bookkeeper:${agent.agentPublic}`).digest("hex"));
    expect(tx.agentApiKey.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { keyHash: createHash("sha256").update("stl_agent_bookkeeper_demo").digest("hex") },
      create: expect.objectContaining({ agentId: "bookkeeper" }),
    }));
    const storedWrites = JSON.stringify(tx.agentApiKey.upsert.mock.calls);
    expect(storedWrites).not.toContain("stl_agent_bookkeeper_demo");
    expect(tx.endpoint.upsert).toHaveBeenCalledTimes(3);
    expect(tx.endpoint.upsert.mock.calls.map(([args]) => args.create.price)).toEqual([1333334n, 10000000n, 5333334n]);
  });

  it("preserves existing wallet identities, revocations and policies when rerun", async () => {
    vi.stubEnv("WALLET_ENC_KEY", "12".repeat(32));
    const { tx, client, orgs, agents } = database();
    await seedDemo(client, { phpPerXlm: 15, apiKey: "stl_agent_bookkeeper_demo" });
    const org = { ...orgs.get("org_juan")! };
    const agent = { ...agents.get("bookkeeper")! };
    agents.set("bookkeeper", { ...agent, status: "revoked", lastNonce: 8n });
    await seedDemo(client, { phpPerXlm: 15, apiKey: "stl_agent_bookkeeper_demo" });
    expect(orgs.get("org_juan")).toEqual(org);
    expect(agents.get("bookkeeper")).toEqual({ ...agent, status: "revoked", lastNonce: 8n });
    expect(tx.policy.upsert.mock.calls.every(([args]) => Object.keys(args.update).length === 0)).toBe(true);
    expect(tx.agentApiKey.upsert.mock.calls.every(([args]) => Object.keys(args.update).length === 0)).toBe(true);
  });

  it("rejects invalid seed settings before opening a transaction", async () => {
    const { client } = database();
    await expect(seedDemo(client, { phpPerXlm: 0, apiKey: "stl_agent_demo" })).rejects.toThrow(/PHP_PER_XLM/);
    await expect(seedDemo(client, { phpPerXlm: 15, apiKey: "wrong" })).rejects.toThrow(/API key/);
    expect(client.$transaction).not.toHaveBeenCalled();
  });

  it("accepts a centavo exchange rate despite binary floating point rounding", async () => {
    vi.stubEnv("WALLET_ENC_KEY", "12".repeat(32));
    const { client } = database();
    await expect(seedDemo(client, { phpPerXlm: 1.1, apiKey: "stl_agent_bookkeeper_demo" })).resolves.toBeUndefined();
  });

  it("gives separate demo databases distinct global testnet device identities", async () => {
    vi.stubEnv("WALLET_ENC_KEY", "12".repeat(32));
    const first = database();
    const second = database();
    const options = { phpPerXlm: 15, apiKey: "stl_agent_bookkeeper_demo" };
    await seedDemo(first.client, options);
    await seedDemo(second.client, options);
    expect(first.agents.get("bookkeeper")?.deviceHash).not.toBe(second.agents.get("bookkeeper")?.deviceHash);
  });
});
