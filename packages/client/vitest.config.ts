import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const sharedSrc = fileURLToPath(new URL("../shared/src/index.ts", import.meta.url));

const resolveSharedSource = {
  resolve: {
    alias: {
      "@timedata/shared": sharedSrc,
    },
  },
};

export default defineConfig({
  test: {
    exclude: ["src/**/__tests__/e2e/**"],
    projects: [
      {
        ...resolveSharedSource,
        define: {
          __TIMEDATA_ANDROID_VERSION_CODE__: JSON.stringify("260507"),
        },
        test: {
          name: "unit",
          include: ["src/**/*.test.{ts,tsx}"],
          exclude: ["src/**/__tests__/e2e/**"],
        },
      },
      {
        ...resolveSharedSource,
        define: {
          __TIMEDATA_ANDROID_VERSION_CODE__: JSON.stringify("260507"),
        },
        test: {
          name: "e2e",
          include: ["src/**/__tests__/e2e/**/*.test.ts"],
          pool: "forks",
          hookTimeout: 15_000,
          testTimeout: 15_000,
        },
      },
    ],
  },
});
