import { loadEnvConfig } from "@next/env";
import { fileURLToPath } from "node:url";
import { defineConfig } from "prisma/config";

// Prisma runs outside Next.js; load the same ignored apps/web/.env.local.
loadEnvConfig(fileURLToPath(new URL(".", import.meta.url)));

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  // Generation needs no live credentials; migrations require the real URL.
  datasource: { url: process.env.DATABASE_URL ?? "" },
});
