import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["src/**/__tests__/e2e/**"],
    projects: [
      {
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
        define: {
          __TIMEDATA_ANDROID_VERSION_CODE__: JSON.stringify("260507"),
        },
        test: {
          name: "e2e",
          include: ["src/**/__tests__/e2e/**/*.test.ts"],
          pool: "forks",
        },
      },
    ],
  },
});
