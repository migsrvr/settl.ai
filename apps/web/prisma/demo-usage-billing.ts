import { loadEnvConfig } from "@next/env";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Prisma } from "../lib/generated/prisma/client";
import { getDb } from "../lib/server/db";

/** Change the demo product's future quotes only; never rewrite past payments or policy. */
export function applyDemoUsageBilling(db: Pick<Prisma.TransactionClient, "endpoint">) {
  return db.endpoint.updateMany({
    where: { id: "resibo_parse", providerId: "resibo", mode: "outcome" },
    data: { mode: "per_call", criteriaId: null, criteria: Prisma.DbNull },
  });
}

async function main() {
  if (!process.argv.includes("--apply")) {
    console.info("No changes made. Pass --apply to change only resibo_parse to per-call billing; prices, URLs, wallets, policies and historical payments are preserved.");
    return;
  }
  loadEnvConfig(fileURLToPath(new URL("..", import.meta.url)));
  const db = getDb();
  try {
    const result = await applyDemoUsageBilling(db);
    console.info(`Mock Receipt OCR billing update: ${result.count} matching endpoint updated. No payment was submitted.`);
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error("Demo billing update failed. Check database configuration; no payment was submitted.");
    process.exitCode = 1;
  });
}
