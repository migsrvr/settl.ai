import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Tests start the sandbox gateway, which must never load the real Stellar, Noir or Velo clients.
    alias: { "@settl/stellar": fileURLToPath(new URL("../dev/src/stellar-stub.ts", import.meta.url)) },
  },
});
