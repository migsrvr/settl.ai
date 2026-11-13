import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startSandboxDatabase, type SandboxDatabase } from "../src/database";
import { FakeChain } from "../src/fake-chain";
import { seedSandbox } from "../src/seed";

let database: SandboxDatabase;
const chain = new FakeChain();
const agentKey = "stl_agent_sandbox_test";

beforeAll(async () => {
  database = await startSandboxDatabase();
  await seedSandbox(database.prisma, {
    chain, agentKey, providerUrl: "http://127.0.0.1:4100", balanceStroops: 500_000_000n, phpPerXlm: 15,
  });
}, 60_000);

afterAll(async () => { await database.close(); });

describe("sandbox seed", () => {
  it("creates a usable agent: active, long-dated policy, hashed API key", async () => {
    const agent = await database.prisma.agent.findUniqueOrThrow({ where: { id: "bookkeeper" }, include: { policy: true } });
    expect(agent.status).toBe("active");
    expect(agent.policy?.expiresAt.getUTCFullYear()).toBeGreaterThanOrEqual(2099);
    const key = await database.prisma.agentApiKey.findUnique({ where: { keyHash: createHash("sha256").update(agentKey).digest("hex") } });
    expect(key?.agentId).toBe("bookkeeper");
  });

  it("funds the agent device on the fake chain", async () => {
    const agent = await database.prisma.agent.findUniqueOrThrow({ where: { id: "bookkeeper" } });
    expect(await chain.balanceOf(agent.deviceHash)).toBe(500_000_000n);
  });

  it("points every demo endpoint at the configured provider origin", async () => {
    const endpoints = await database.prisma.endpoint.findMany({ orderBy: { id: "asc" } });
    expect(endpoints.map((endpoint) => endpoint.id)).toEqual(["geoph_lookup", "resibo_parse", "resibo_pro"]);
    for (const endpoint of endpoints) expect(endpoint.url).toBe(`http://127.0.0.1:4100${endpoint.route}`);
  });

  it("is safe to run twice", async () => {
    await seedSandbox(database.prisma, { chain, agentKey, providerUrl: "http://127.0.0.1:4100", balanceStroops: 0n, phpPerXlm: 15 });
    expect(await database.prisma.agent.count()).toBe(1);
  });
});
