---
type: evergreen
title: 本地开发 · 命令与测试
covers:
contracts:
  - package.json
  - packages/client/test-buckets.mjs
  - scripts/check-test-hygiene.mjs
last-reviewed: 2026-08-10
---

# 本地开发 · 命令与测试

> [development](../development.md) 的**命令子文档**：跑什么命令验证代码，以及测试怎么分桶、怎么写才不算假测试。
> 讲什么：全部 `pnpm` 命令与两档验证分工、`--since` 的假通过陷阱、构建顺序、client 三个测试 project 的分工与纪律、测试卫生棘轮与豁免登记、fake timers 与 `fake-indexeddb` 的冲突。
> 不讲什么：环境要求与依赖安装、Worktree 工作流、开发服务器、Android APK 打包、项目结构与技术栈、故障排查（都在 [母文档](../development.md)）。

## 承上启下

- **上游**：[母文档](../development.md) 的环境要求与依赖安装——命令要跑起来先得有那套工具链。
- **下游**：日常提交的聚焦验证与收工前的 `pnpm gate`；CI 的步骤顺序见 [deployment](../deployment.md)。
- **契约**：命令清单的单一来源是根 `package.json` 的 scripts；client 分桶的唯一事实源是 `packages/client/test-buckets.mjs`，`vitest.config.ts` 与 `scripts/check-test-hygiene.mjs` 共用它。
- **邻居**：[母文档](../development.md)、[deployment](../deployment.md)（CI 顺序与门禁在 CI 侧的对应）、[architecture](../architecture.md)（workspace 脚本编排）。

## 1. 命令清单与两档分工

```bash
pnpm dev:client        # 启动前端开发服务器
pnpm dev:server        # 启动后端开发服务器
pnpm build:shared      # 构建共享包
pnpm build:client      # 构建前端
pnpm build:client:fast # 本地快速前端打包：先构建 shared，再只跑 vite build，不做 client tsc -b
pnpm build:server      # 构建后端
pnpm build:cli         # 构建 CLI
pnpm build:mobile      # 构建并同步 Android WebView 资源
pnpm --filter @timedata/mobile test # 检查 Android 明文流量和 Capacitor v7 版本约束
pnpm build:mobile:apk          # 构建 Android debug APK
pnpm build:mobile:release-apk  # 构建 Android release APK（需要签名参数）
pnpm build             # 先构建 shared，再并行构建 Web/Server/CLI；不包含 Android APK
pnpm lint              # Biome lint（v2.4，配置在 biome.json 使用 files.includes 反向写法）；noExplicitAny / useImportType / noNonNullAssertion 均为 error，CI 与 gate 据此阻断
pnpm format            # Biome 格式化并写回
pnpm typecheck         # 根入口（= pnpm -r typecheck）：递归执行各 package TypeScript 检查
pnpm test              # 以 workspace-concurrency=2 递归执行各 package 测试，并在最后运行根目录 scripts/*.test.mjs
pnpm test:client:changed # 本地快速窄测：只让 client unit project 跑 Vitest changed 集合，不替代正式 pnpm test
pnpm --filter @timedata/client exec vitest run --project unit src/pages   # 本地只跑某一段（按路径窄测），定位慢点/失败面
pnpm --filter @timedata/client exec vitest run --project unit --shard=1/4 # 本地复现 CI 单片，排查某片专属失败
pnpm test:scripts      # 只运行根目录 Node test 脚本（如 docs 检查脚本测试）
pnpm --filter @timedata/server test routes
pnpm --filter @timedata/server test middleware/auth
pnpm --filter @timedata/client test:e2e
pnpm check:docs        # 检查本次改动是否命中需要同步的 evergreen 文档（warn，恒 exit 0）
pnpm check:docs:strict # CI 使用的严格文档检查（按 contracts 硬拦）
pnpm check:docs:stale  # 检查 evergreen 文档是否长期未审阅
pnpm check:docs:size   # evergreen 文档体量棘轮：字符绝对上限 + covers 棘轮
pnpm check:docs:coverage # 新增代码是否有 evergreen 文档认领（须带 --since=<base>）
pnpm check:docs:links  # evergreen / ADR 互链与显式锚点的目标存在性
pnpm check:design      # 设计语言棘轮：退役模块色、裸色、散装交互图标、业务 font-mono
pnpm check:ui          # UI 控件棘轮：禁新增原生 select/checkbox/radio/confirm/alert
pnpm check:test        # 测试卫生棘轮：禁新增真实等待 / 裸 createRoot / 干净桶混入脏文件
pnpm check:diary       # 日记日期闸：本地日界与 UTC 存储的换算
pnpm check:roadmap     # ROADMAP 程序门（docs_local 不入 Git，本地是唯一执行点）
pnpm gate              # 全量门禁唯一入口，本机全局互斥
pnpm icons:generate    # 从根目录 icon.png 生成 PWA / Android / favicon / iOS 全套图标
```

**两档分工**：日常提交走**聚焦验证**——按路径窄测 + 命中的那几道 check，快且够用。**收工 / 合并前走 `pnpm gate`**：它串行跑 CI 同集棘轮（lint、四道静态闸、typecheck、test、e2e、四道 docs、roadmap、build），是全量门禁的唯一入口，不必再手工挨个敲。gate 本机全局互斥，同一时刻只允许一份在跑，多 worktree 撞上会自动排队（`--no-wait` 则立即退出）；锁在主仓 `.git/timedata-gate.lock/`，进程被强杀留下的残锁 60 秒后自动接管，不用手删。

`check:docs:strict` 与 `check:docs:coverage` **不带 `--since` 等于没跑**：默认比对 `HEAD`，对已提交的改动是空 diff、必然假通过。本地自测带 `--since=main`，CI 带 `--since=origin/main`。

**验证命令的退出码不穿透管道**：`pnpm gate 2>&1 | tail -40` 这类写法拿到的退出码是管道末端那个命令的，前面的失败会被吃成 exit 0，据被截断的输出报「全绿」就是假绿。要取结论就直跑读退出码；必须接管道时 bash 读 `${PIPESTATUS[0]}`、PowerShell 读 `$LASTEXITCODE`。

按名字窄测用 `pnpm --filter @timedata/server test routes` 这类**不带 `--` 的形式**；`pnpm --filter … test -- <name>` **不做文件过滤**，会把整包套件全跑一遍。聚焦单个文件也可在该包目录下 `npx vitest run <路径>`。

`packages/shared` 的运行时契约测试使用 Vitest，覆盖 `packages/shared/src/schemas.ts` 中的 schema；改跨端类型或同步 payload 形状时先跑 `pnpm --filter @timedata/shared test` 和 `pnpm --filter @timedata/shared build`。`@timedata/cli` 的 `typecheck` 会先构建 shared，因为 CLI 在 package 解析时读取 `packages/shared/dist/index.d.ts`；干净 CI 环境不能依赖本地已有 dist。

根 `pnpm build` 的顺序是 `shared` 先构建，随后显式并行构建 `@timedata/client`、`@timedata/server`、`@timedata/cli`；排除 `shared` 的递归过滤不能替代这条脚本——会误触发 mobile 的 Android 同步构建。`pnpm build:client:fast` 只服务本地前端打包迭代，跳过 client `tsc -b`，推送前仍以正式 `pnpm build` 为准。

新增或修改同步域时优先跑窄门：`pnpm --filter @timedata/shared test -- trackSchemas entitySchemas syncDomains schemas`、`pnpm --filter @timedata/server test -- schema track-rows domains tracks-domain order backfillSeq sync`、`pnpm --filter @timedata/client test -- index clientDomains tracks exportBackup validateBackup importBackup domainLabels`，再扩到三端 typecheck、`pnpm test`、`pnpm lint`、`pnpm build` 与 docs 检查。

## 2. 测试组织与纪律

> 测试阶段 Vitest 直接解析 `packages/shared/src/index.ts`，因此全新 clone 后无需先 `pnpm build:shared` 即可 `pnpm test`。构建 / dev / 部署仍读 `packages/shared/dist`。

根目录 `scripts/*.test.mjs` 使用 Node 内置 test runner，通过 `pnpm test:scripts` 单独运行，也会被 `pnpm test` 串起来，覆盖 docs 检查脚本、设计语言棘轮脚本等不属于 workspace package 的工具。根 `pnpm test` 让 workspace package 以 `workspace-concurrency=2` 有限并行；server 测试使用内存 SQLite 或独立临时目录，已按这一级并行度验证。client unit 测试仍是全量耗时大头，日常修改可先用明确文件名窄测或 `pnpm test:client:changed`，但不能替代提交前全量测试。

`packages/server` 的路由级测试直接装配 Hono route + 内存 better-sqlite3，通用 helper 在 `packages/server/src/__tests__/helpers.ts`；认证中间件测试在 `packages/server/src/middleware/auth.test.ts`。

`packages/client` 的测试使用 Vitest project 配置：默认 `pnpm --filter @timedata/client test` 跑 unit、unit-clean、unit-clean-jsdom 三个 project。**三桶分工**：`unit-clean`（node + `isolate:false`，**派生**——全 `src` 测试减去命中脏标记者 = 纯逻辑 / `renderToStaticMarkup` / 已洗白的 node-db，挂精简 `src/test/setup.clean.ts`，其提供桶级内存 localStorage + afterEach 清空，prefs 类测试无需自带 defineProperty 注入）、`unit-clean-jsdom`（jsdom + `isolate:false`，**显式 allowlist** `packages/client/test-buckets.fast-jsdom.json`，挂 `src/test/setup.clean-jsdom.ts`，afterEach 统一 `unstubAllGlobals` + `cleanupRoots` + 动态 import `db/index.js` 后逐表 `clear()`——**走的不是 `src/test/dbReset.ts` 的 `resetDb()`**）、`unit`（`isolate:true` 默认 + 完整 `src/test/setup.ts` 的全局清理——含 `cleanupRoots()`：只清 `document.body.innerHTML` 不卸 React root，页面级用例任一断言先失败就走不到末行 `unmount(root)`，留活的页面连同 `useLiveQuery` 订阅会被后续用例开头的 `db.*.clear()` 反复唤醒重渲染，把一条真失败放大成别的用例的连带超时，契约由 `src/test/rootCleanupContract.test.tsx` 钉住；收纳未洗白残留：用 `vi.mock` / `defineProperty(globalThis)` 的文件（isolate:false 下会跨文件泄漏）、真 schema 测试、未转 domHarness 的裸 createRoot）。两个 isolate:false 快桶免去每文件隔离的 import/jsdom 开销，是提速主力。**纪律**：db 测试统一走 `src/test/dbReset.ts`（open + 逐表 clear，绝不 `db.delete()` 重建 schema）；需真实 DOM 的测试走 `src/test/domHarness.tsx`（`renderDom` / `unmount`，活跃 root 登记 + afterEach `cleanupRoots()` 自动卸载，三桶皆然）。三个桶的 setup **`restoreAllMocks` 与 `clearAllMocks` 都要调**：Vitest 3 起前者只还原 `vi.spyOn` 装的间谍、不再清 `vi.fn()` 的调用历史（含 `vi.mock` 工厂里造的），少了后者就会让「上一条用例调用过某 mock」泄漏成下一条的 `toHaveBeenCalled` 脏数据——按声明顺序跑时可能恒绿，`--sequence.shuffle` 换序即随机翻车，契约由 `src/test/mockResetContract.test.ts` 钉住。分桶唯一事实源是 `packages/client/test-buckets.mjs`（node 派生 `resolveCleanBucket` + jsdom `resolveFastJsdomBucket`），`vitest.config.ts` 与 `scripts/check-test-hygiene.mjs` 共用它。按路径窄测纯逻辑时省略 `--project`（或 `--project unit-clean`），jsdom 快桶文件用 `--project unit-clean-jsdom`，其余 `--project unit`。同步端到端链路单独用 `pnpm --filter @timedata/client test:e2e`（CI 也分两步跑，避免 e2e 拖慢日常 test）。e2e 测试入口是 `packages/client/src/__tests__/e2e/sync-roundtrip.e2e.test.ts`，它通过 `packages/server/src/__tests__/e2e/helpers.ts` 在同一 Node 进程里启动内存 Hono server，并用 fake-indexeddb 作为 Dexie 后端。默认多数组件测试走 React server rendering；需要真实 DOM 的交互测试使用 `@vitest-environment jsdom`，依赖由 `packages/client/package.json` 的 devDependency `jsdom` 提供。测试卫生由 `pnpm check:test`（CI 步骤 + `scripts/check-test-hygiene.mjs` 文件级棘轮）守护：禁新增真实定时等待、裸 `createRoot`、干净桶目录混入新脏文件（`dirty-in-clean-bucket`），以及 jsdom 快桶 allowlist 成员含裸 createRoot（`bare-createroot-in-fast-jsdom`）或直接 `fake-indexeddb/auto` / `db.delete(`（`unsafe-db-in-fast`），存量豁免在 `scripts/test-hygiene-baseline.json`。**登记豁免只走 `node scripts/check-test-hygiene.mjs --add <路径>`**——只收编你指定路径下的违规、合并进现有基线（只增不删）；文件修好后用 `--prune` 洗白已失效条目；`--rewrite-baseline` 才整体重写，且会把新收编的条目逐条打印出来。旧的 `--write-baseline` 已移除：它按当前工作树整体覆盖写，会把与本次改动无关的违规一并收编，diff 里只表现为基线多几行、review 极易放过（`scripts/check-evergreen-docs.mjs --write-size-baseline` 因为要重建新增/删除文档条目仍是整体重写，但同样会把被抬高的 covers 逐条喊出来）。CI 不再用一步 `pnpm -r --parallel test` 跑 client unit，而是单独的 `client-unit` 矩阵 job 用 vitest 原生 `--shard=i/4` 并行切成 4 片（`fail-fast: false`，每片一个独立检查），既缩短反馈墙钟又能一眼定位是哪一片挂；主 `test` job 仅跑非 client 包的测试。本地复现某片用 `--shard=i/4`，按路径窄测用 `vitest run --project unit <路径>`；提交前仍以根 `pnpm test` 为最终 gate。

**假测试甄别法**：怀疑某条测试不承重时，把实现故意改坏后重跑、看哪条变红——不变红的就是假测试。

**`fake-indexeddb` 依赖真实 `setImmediate` 驱动事务完成**：它的 IDB 事务回调靠 Node 的 `setImmediate` 排队执行，若整页测试对 `vi.useFakeTimers()` 不传参数（等价于把包括 `setImmediate` 在内的全部计时器一并伪造），`resetDb()`（`src/test/dbReset.ts`）或任何 `useLiveQuery` 背后的事务永远等不到回调，`beforeEach` 会直接卡死到 hook 超时。解法是白名单式收窄：只伪造需要**推进**的计时器，把 `setImmediate` 留作真实——

```ts
vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
```

这不违反本仓「禁真实定时等待」的棘轮本意：棘轮防的是测试代码自己写 `setTimeout(fn, n>0)` 空等真实时间流逝，不防第三方库内部排队机制依赖的宏任务本身仍是真实的。实例见 `packages/client/src/pages/SearchPage.test.tsx` 的 `beforeEach`。
