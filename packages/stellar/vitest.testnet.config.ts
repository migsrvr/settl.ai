import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/*.testnet.ts"],
    testTimeout: 300_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
