import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  test: {
    exclude: ["src/**/__tests__/e2e/**"],
    projects: [
      {
        plugins: [tsconfigPaths()],
        resolve: {
          alias: {
            "virtual:pwa-register/react": fileURLToPath(new URL("./src/test/pwaRegisterMock.ts", import.meta.url)),
          },
        },
        define: {
          __TIMEDATA_ANDROID_VERSION_CODE__: JSON.stringify("260507"),
        },
        test: {
          name: "unit",
          include: ["*.test.ts", "src/**/*.test.{ts,tsx}"],
          exclude: ["src/**/__tests__/e2e/**"],
        },
      },
      {
        plugins: [tsconfigPaths()],
        define: {
          __TIMEDATA_ANDROID_VERSION_CODE__: JSON.stringify("260507"),
        },
        test: {
          name: "e2e",
          include: ["src/**/__tests__/e2e/**/*.test.ts"],
          pool: "forks",
          hookTimeout: 30_000,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
