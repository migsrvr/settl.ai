import { loadEnvConfig } from "@next/env";
import { phpToStroops } from "@settl/core";
import { Asset, Keypair, Networks } from "@stellar/stellar-sdk";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Prisma, PrismaClient } from "../lib/generated/prisma/client";
import { getDb } from "../lib/server/db";
import { encryptWalletSecret } from "../lib/server/wallets";
import { applyDemoUsageBilling } from "./demo-usage-billing";

export interface SeedOptions {
  phpPerXlm: number;
  apiKey: string;
}

function wallet() {
  const keypair = Keypair.random();
  return { walletPublic: keypair.publicKey(), walletSecretEnc: encryptWalletSecret(keypair.secret()) };
}

const receiptFixtures: Prisma.InputJsonValue = {
  type: "object",
  properties: {
    fixture: { type: "string", enum: ["clean", "blurry", "wrong_total"], description: "Which sample receipt to read. Defaults to clean." },
  },
  additionalProperties: false,
};

/** What agents are told about each demo service. Filled only where an existing database has none. */
export const DEMO_METADATA: Record<string, { description: string; inputSchema: Prisma.InputJsonValue; example: Prisma.InputJsonValue }> = {
  resibo_parse: {
    description: "Reads a receipt and returns the merchant, date, total, line items and a confidence score. This demo reads a sample receipt chosen with fixture.",
    inputSchema: receiptFixtures,
    example: { fixture: "clean" },
  },
  resibo_pro: {
    description: "Higher-accuracy receipt reading with the same output as Receipt OCR. This demo reads a sample receipt chosen with fixture.",
    inputSchema: receiptFixtures,
    example: { fixture: "clean" },
  },
  geoph_lookup: {
    description: "Looks up a Philippine city or municipality and returns its province and region.",
    inputSchema: {
      type: "object",
      properties: { city: { type: "string", minLength: 1, maxLength: 256, description: "City or municipality, for example Makati." } },
      additionalProperties: false,
    },
    example: { city: "Makati" },
  },
};

/** Database records only. Registration and funding are a separate live step. */
export async function seedDemo(db: PrismaClient, { phpPerXlm, apiKey }: SeedOptions): Promise<void> {
  if (!Number.isFinite(phpPerXlm) || phpPerXlm < 0.01 || !Number.isSafeInteger(Math.round(phpPerXlm * 100)) || Number(phpPerXlm.toFixed(2)) !== phpPerXlm) {
    throw new Error("PHP_PER_XLM must be a positive rate with at most two decimal places");
  }
  if (!apiKey.startsWith("stl_agent_") || apiKey.length <= "stl_agent_".length) throw new Error("Demo API key must start with stl_agent_ and have a suffix");
  const amount = (php: number) => phpToStroops(php, phpPerXlm);
  const asset = Asset.native().contractId(Networks.TESTNET);
  const keyHash = createHash("sha256").update(apiKey).digest("hex");

  await db.$transaction(async (tx) => {
    const mara = await tx.org.upsert({
      where: { id: "org_resibo" }, update: {},
      create: { id: "org_resibo", name: "ResiboAI", contactName: "Mara", email: "mara@example.com", role: "provider", ...wallet() },
    });
    await tx.org.upsert({
      where: { id: "org_juan" }, update: {},
      create: { id: "org_juan", name: "Juan's Accounting Firm", contactName: "Juan", email: "juan@example.com", role: "buyer", ...wallet() },
    });
    await tx.org.upsert({
      where: { id: "org_acme" }, update: {},
      create: { id: "org_acme", name: "Acme AI Corp", contactName: "Carlos Mendez", email: "acme@example.com", role: "buyer", ...wallet() },
    });
    const geoph = await tx.org.upsert({
      where: { id: "org_geoph" }, update: {},
      create: { id: "org_geoph", name: "GeoPH", contactName: "GeoPH demo", email: "geoph@example.com", role: "provider", ...wallet() },
    });
    for (const provider of [
      { id: "resibo", orgId: mara.id, displayName: "ResiboAI", merchantWallet: mara.walletPublic },
      { id: "geoph", orgId: geoph.id, displayName: "GeoPH", merchantWallet: geoph.walletPublic },
    ]) {
      await tx.provider.upsert({ where: { id: provider.id }, update: {}, create: provider });
      await tx.providerSettings.upsert({
        where: { providerId: provider.id }, update: {},
        create: { providerId: provider.id, autoClaimEnabled: true, autoClaimThreshold: amount(50) },
      });
    }
    for (const endpoint of [
      { id: "resibo_parse", providerId: "resibo", name: "Receipt OCR", route: "/parse-receipt", url: "http://localhost:3001/parse-receipt", price: amount(2), mode: "per_call" as const },
      { id: "resibo_pro", providerId: "resibo", name: "Receipt OCR Pro", route: "/parse-receipt-pro", url: "http://localhost:3001/parse-receipt-pro", price: amount(15), mode: "per_call" as const },
      { id: "geoph_lookup", providerId: "geoph", name: "GeoPH lookup", route: "/lookup", url: "http://localhost:3001/lookup", price: amount(8), mode: "per_call" as const },
    ]) {
      const metadata = DEMO_METADATA[endpoint.id];
      await tx.endpoint.upsert({ where: { id: endpoint.id }, update: {}, create: { ...endpoint, ...metadata } });
      // Older demo databases predate metadata: fill only what is missing, never replace a provider's own text.
      const current = await tx.endpoint.findUnique({ where: { id: endpoint.id }, select: { description: true, inputSchema: true, example: true } });
      if (current && metadata) {
        const missing = Object.fromEntries((["description", "inputSchema", "example"] as const)
          .filter((key) => current[key] === null).map((key) => [key, metadata[key]]));
        if (Object.keys(missing).length > 0) await tx.endpoint.update({ where: { id: endpoint.id }, data: missing });
      }
      // Repair old demo seeds without replacing an intentionally configured origin.
      await tx.endpoint.updateMany({ where: { id: endpoint.id, url: null }, data: { url: endpoint.url } });
    }
    await applyDemoUsageBilling(tx);
    const agentKeypair = Keypair.random();
    await tx.agent.upsert({
      where: { id: "bookkeeper" }, update: {},
      create: {
        id: "bookkeeper", orgId: "org_juan", name: "Juan's Bookkeeper", status: "provisioning",
        agentPublic: agentKeypair.publicKey(), agentSecretEnc: encryptWalletSecret(agentKeypair.secret()),
        // The demo ID is reused across databases; include its wallet identity
        // to avoid assigning different owners to the same global testnet device.
        deviceHash: createHash("sha256").update(`settl:agent:bookkeeper:${agentKeypair.publicKey()}`).digest("hex"),
      },
    });
    await tx.policy.upsert({
      where: { agentId: "bookkeeper" }, update: {},
      create: {
        agentId: "bookkeeper", asset, maxAmount: amount(10), maxPricePerCall: amount(10),
        dailyBudget: amount(50), autoApproveUpTo: amount(5), allowlist: ["resibo", "geoph"],
        expiresAt: new Date("2026-12-31T23:59:59Z"),
      },
    });
    await tx.agentSettings.upsert({
      where: { agentId: "bookkeeper" }, update: {},
      create: { agentId: "bookkeeper", lowBudgetAlert: amount(10) },
    });
    const storedKey = await tx.agentApiKey.upsert({
      where: { keyHash }, update: {},
      create: { agentId: "bookkeeper", name: "Bookkeeper demo", keyHash },
    });
    if (storedKey.agentId !== "bookkeeper") throw new Error("Demo API key is already assigned to a different agent");
  }, { maxWait: 20_000, timeout: 30_000 });
}

async function main() {
  loadEnvConfig(fileURLToPath(new URL("..", import.meta.url)));
  const db = getDb();
  try {
    await seedDemo(db, {
      phpPerXlm: Number(process.env.PHP_PER_XLM ?? "15"),
      // Public testnet demo credential. Override for deployments; never log it.
      apiKey: process.env.DEMO_AGENT_API_KEY ?? "stl_agent_bookkeeper_demo",
    });
    console.info("Demo database seeded. Bookkeeper requires testnet registration and funding before use.");
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    // Prisma errors may contain data or connection details; do not print them.
    console.error("Demo seed failed. Check database availability, migrations, encryption key, and seed settings.");
    process.exitCode = 1;
  });
}
