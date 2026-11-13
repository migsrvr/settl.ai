import { randomBytes } from "node:crypto";
import type { PrismaClient } from "../../../apps/web/lib/generated/prisma/client";
import { seedDemo } from "../../../apps/web/prisma/seed";
import type { FakeChain } from "./fake-chain";

export interface SandboxSeedOptions {
  chain: FakeChain;
  /** Bearer key the demo agent uses; must start with stl_agent_. */
  agentKey: string;
  /** Origin that serves the demo provider routes, for example http://localhost:3001. */
  providerUrl: string;
  /** Escrow given to the demo agent on the fake chain. */
  balanceStroops: bigint;
  phpPerXlm: number;
}

/** Let every sandbox agent spend with a provider that registered after the seed. */
export async function allowProvider(prisma: PrismaClient, providerId: string): Promise<void> {
  const policies = await prisma.policy.findMany({ select: { agentId: true, allowlist: true } });
  for (const policy of policies) {
    if (!policy.allowlist.includes(providerId)) {
      await prisma.policy.update({ where: { agentId: policy.agentId }, data: { allowlist: [...policy.allowlist, providerId] } });
    }
  }
}

/** Seed the demo organizations, make the agent ready to spend, and give it fake escrow. */
export async function seedSandbox(prisma: PrismaClient, options: SandboxSeedOptions): Promise<void> {
  // Wallet secrets are encrypted at rest even in the sandbox; the key lives only for this process.
  process.env.WALLET_ENC_KEY ||= randomBytes(32).toString("hex");
  await seedDemo(prisma, { phpPerXlm: options.phpPerXlm, apiKey: options.agentKey });

  const origin = options.providerUrl.replace(/\/+$/, "");
  const agent = await prisma.$transaction(async (tx) => {
    for (const endpoint of await tx.endpoint.findMany({ select: { id: true, route: true } })) {
      await tx.endpoint.update({ where: { id: endpoint.id }, data: { url: `${origin}${endpoint.route}` } });
    }
    // The demo policy expires in 2026; a sandbox should not stop working on a date.
    await tx.policy.update({ where: { agentId: "bookkeeper" }, data: { expiresAt: new Date("2099-12-31T23:59:59Z") } });
    return tx.agent.update({ where: { id: "bookkeeper" }, data: { status: "active" } });
  });
  if (options.balanceStroops > 0n) options.chain.fund(agent.deviceHash, options.balanceStroops);
}
