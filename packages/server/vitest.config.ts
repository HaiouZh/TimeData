import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const sharedSrc = fileURLToPath(new URL("../shared/src/index.ts", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@timedata/shared": sharedSrc,
    },
  },
  test: {
    hookTimeout: 15_000,
    testTimeout: 15_000,
  },
});
