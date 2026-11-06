import { loadEnvConfig } from "@next/env";
import { resolve } from "node:path";
loadEnvConfig(resolve("apps/web"));

import { Keypair } from "@stellar/stellar-sdk";
import { createStellarClient, fundTestnetAccount, loadStellarConfig } from "@settl/stellar";
import { getDb } from "../apps/web/lib/server/db";
import { decryptWalletSecret } from "../apps/web/lib/server/wallets";

async function activate(agentId = "bookkeeper") {
  const db = getDb();
  try {
    const agent = await db.agent.findUnique({
      where: { id: agentId },
      include: { org: true, policy: true },
    });
    if (!agent) throw new Error(`Agent ${agentId} not found`);
    if (!agent.policy) throw new Error(`Agent ${agentId} has no policy`);

    const owner = Keypair.fromSecret(decryptWalletSecret(agent.org.walletSecretEnc));
    const signer = Keypair.fromSecret(decryptWalletSecret(agent.agentSecretEnc));
    console.log(`Owner public: ${owner.publicKey()}`);
    console.log(`Agent public: ${signer.publicKey()}`);

    console.log("Ensuring accounts are funded on testnet...");
    await fundTestnetAccount(owner.publicKey());
    await fundTestnetAccount(signer.publicKey());

    const config = loadStellarConfig();
    const relayer = process.env.SETTL_TREASURY_SECRET ? Keypair.fromSecret(process.env.SETTL_TREASURY_SECRET) : undefined;
    const client = createStellarClient(config, relayer ? { relayer } : {});

    console.log("Registering device on Noir device_registry...");
    const deviceResult = await client.registerDevice(owner, agent.deviceHash, signer.publicKey());
    console.log(`registerDevice status: ${deviceResult.status}, hash: ${deviceResult.hash}`);

    console.log("Registering policy on Noir agent_registry...");
    const policyResult = await client.registerAgent(owner, {
      deviceHash: agent.deviceHash,
      agent: signer.publicKey(),
      maxAmount: agent.policy.maxAmount,
      asset: agent.policy.asset,
      expiresAt: BigInt(Math.floor(agent.policy.expiresAt.getTime() / 1000)),
    });
    console.log(`registerAgent status: ${policyResult.status}, hash: ${policyResult.hash}`);

    console.log("Marking agent active in database...");
    await db.agent.update({
      where: { id: agent.id },
      data: {
        status: "active",
        lifecycleRecovery: {
          operation: "activate",
          stage: "complete",
          state: "complete",
          deviceHash: deviceResult.hash,
          policyHash: policyResult.hash,
        },
      },
    });

    console.log(`Agent ${agent.id} is now ACTIVE on Stellar testnet!`);
  } finally {
    await db.$disconnect();
  }
}

const target = process.argv[2] ?? "bookkeeper";
activate(target).catch((err) => {
  console.error("Activation failed:", err);
  process.exitCode = 1;
});
