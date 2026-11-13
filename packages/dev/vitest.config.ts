import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Test the same module graph the CLI ships: no real Stellar, Noir or Velo clients.
    alias: { "@settl/stellar": fileURLToPath(new URL("./src/stellar-stub.ts", import.meta.url)) },
  },
});
