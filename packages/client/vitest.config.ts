import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

// 测试里把 @timedata/shared 直接解析到源码，免去先构建 shared；
// 取代 vite-tsconfig-paths（它会从 monorepo 根递归扫 参考代码/、.worktrees 等无关 tsconfig，拖慢启动）。
const sharedSrc = fileURLToPath(new URL("../shared/src/index.ts", import.meta.url));

export default defineConfig({
  test: {
    exclude: ["src/**/__tests__/e2e/**"],
    projects: [
      {
        resolve: {
          alias: {
            "@timedata/shared": sharedSrc,
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
          setupFiles: ["./src/test/setup.ts"],
        },
      },
      {
        resolve: {
          alias: {
            "@timedata/shared": sharedSrc,
          },
        },
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
