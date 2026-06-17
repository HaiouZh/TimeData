import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

// 把 @timedata/shared 直接解析到源码，取代 vite-tsconfig-paths
// （它会从 monorepo 根递归扫 参考代码/、.worktrees 等无关 tsconfig，拖慢启动）。
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
