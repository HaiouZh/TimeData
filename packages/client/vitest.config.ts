import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";
import { resolveCleanBucket } from "./test-buckets.mjs";

// 测试里把 @timedata/shared 直接解析到源码，免去先构建 shared；
// 取代 vite-tsconfig-paths（它会从 monorepo 根递归扫 参考代码/、.worktrees 等无关 tsconfig，拖慢启动）。
const sharedSrc = fileURLToPath(new URL("../shared/src/index.ts", import.meta.url));
const pwaRegisterMock = fileURLToPath(new URL("./src/test/pwaRegisterMock.ts", import.meta.url));
const clientRoot = fileURLToPath(new URL(".", import.meta.url));

// 干净桶成员（lib/quick-notes 的纯逻辑测试，node 环境、不碰 db/DOM）。唯一事实源在 ./test-buckets.mjs，
// check:test 的 dirty-file-in-clean-bucket 棘轮用同一判定守边界，防新脏文件混入。
const cleanBucket = resolveCleanBucket(clientRoot);

// define / alias 必须每个 project 各持一份新对象：vite 解析多 project 时会就地改写这些对象，
// 复用同一引用会让后一个 project 拿到被前一个消费坏的配置（实测：共享 define 会令 unit 桶丢失
// __TIMEDATA_ANDROID_VERSION_CODE__ 注入）。故用工厂函数返回全新对象。
const makeDefine = () => ({
  __TIMEDATA_ANDROID_VERSION_CODE__: JSON.stringify("260507"),
});
const makeUnitAlias = () => ({
  "@timedata/shared": sharedSrc,
  "virtual:pwa-register/react": pwaRegisterMock,
});

export default defineConfig({
  test: {
    exclude: ["src/**/__tests__/e2e/**"],
    projects: [
      {
        resolve: { alias: makeUnitAlias() },
        define: makeDefine(),
        test: {
          // 干净桶：node 环境 + isolate:false，免去每文件隔离（import + jsdom 环境）的巨额开销。
          name: "unit-clean",
          environment: "node",
          isolate: false,
          include: [...cleanBucket],
          exclude: ["src/**/__tests__/e2e/**"],
          setupFiles: ["./src/test/setup.clean.ts"],
        },
      },
      {
        resolve: { alias: makeUnitAlias() },
        define: makeDefine(),
        test: {
          // 其余测试：维持 isolate:true（默认）+ 完整 setup（db/DOM 兜底）。
          name: "unit",
          include: ["*.test.ts", "src/**/*.test.{ts,tsx}"],
          // 干净桶文件已由 unit-clean 跑，这里排除避免重复执行。
          exclude: ["src/**/__tests__/e2e/**", ...cleanBucket],
          setupFiles: ["./src/test/setup.ts"],
        },
      },
      {
        resolve: {
          alias: {
            "@timedata/shared": sharedSrc,
          },
        },
        define: makeDefine(),
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
