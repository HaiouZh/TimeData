---
type: evergreen
title: 本地开发指南
covers:
  - package.json
  - pnpm-workspace.yaml
  - tsconfig.base.json
  - packages/*/package.json
  - packages/client/vite.config.ts
  - packages/client/src/appUpdate.tsx
  - packages/client/src/lib/frontendUpdate.ts
  - packages/client/src/lib/backNavigation.ts
  - packages/mobile/README.md
  - packages/mobile/capacitor.config.ts
last-reviewed: 2026-08-16
---

# 本地开发指南

## 环境要求

```text
Node.js 22.12+   # Vite 7+ 要求
pnpm 11.0+
```

如果本机没有 pnpm，可以先启用 corepack：

```bash
corepack enable
corepack prepare pnpm@11.9.0 --activate
```

Android APK 打包还需要：

```text
JDK 21
Android SDK Platform 35
Android SDK Build-Tools 35.0.0
Android SDK Platform-Tools
Android SDK Command-line Tools
```

本机已验证可用的 Windows 路径：

```text
JAVA_HOME=<JDK 21 安装目录>
ANDROID_HOME=C:\Users\yanzh\AppData\Local\Android\Sdk
```

## 安装依赖

```bash
pnpm install
```

仓库使用 pnpm 11，`package.json` 的 `packageManager` 是唯一版本源；Corepack、CI 的 `pnpm/action-setup` 和 Dockerfile 都从这里读取当前验证版本。`pnpm-workspace.yaml` 的 `allowBuilds` 允许 `better-sqlite3` 和 `esbuild` 执行安装构建脚本，避免 pnpm 11 的构建审批在 install 阶段阻断测试。CI 和本地安装后不应出现 `Ignored build scripts: better-sqlite3`；如果出现，server 测试会因为缺少 `better_sqlite3.node` 而失败，可先跑 `pnpm rebuild better-sqlite3 esbuild`。

## Worktree 工作流

并行 / 隔离任务多在 Windows 上跑，`node_modules` 的建 / 删是主要耗时。推荐固定 1–2 个长期槽位复用，而不是每个任务新建再删整棵依赖树。

一次性建槽位：

```bash
git worktree add .worktrees/slot-a -b slot-a main
pnpm -C .worktrees/slot-a install
```

之后每个任务在槽位内切分支、增量装：

```bash
git -C .worktrees/slot-a switch -C feat/xxx main
pnpm -C .worktrees/slot-a install --frozen-lockfile --prefer-offline
```

lockfile 不变时 `install` 基本只校验 / 补链接，很快；变了也只是本地增删链接，仍比全量重建快。

要点与坑：

- **槽位的 `node_modules` 不共享、不 junction 到 main**。pnpm 把 workspace 包（`@timedata/*`）按当前 checkout 路径建软链；共享后槽位里的测试 / 构建会解析到 **main 的 `packages/`**，你以为在测分支代码、其实在测 main——静默串线，极难查。
- **pnpm store 安全且默认已共享**：store 全盘内容寻址，槽位与 main 同盘时自动 hardlink，无需任何配置。给单个槽位另设 `store-dir`、或把槽位放到别的盘，反而会退化成各自复制。
- **切分支前先确保槽位里的活已提交**：`git switch -C <分支> main` 会重置工作树，未提交改动会丢。
- **挑空闲槽位看 HEAD 而不是工作树干净**：本仓约定收工后把槽位 detach——detached HEAD = 闲置可领用；HEAD 停在带任务名的分支 = 有人在用，别碰。`.claude/worktrees/agent-*` 是 harness 托管的 worktree（locked），不参与槽位复用，也不要清理。
- **偶发 stale 构建**：`dist` / `.vite` / `*.tsbuildinfo` 跨分支留在槽位里；遇到构建产物串味时定点删它们即可，不必删 `node_modules`。
- 清理：复用槽位平时只 `git switch` / 删旧分支；真要回收一次性 worktree 才 `git worktree prune` → `git branch -D <分支>` → `rm -rf <path>`（Windows 下 `git worktree remove` 常报错，走这套）。

## 启动开发服务器

打开两个终端分别启动后端和前端。

后端：

```bash
AUTH_TOKEN=dev-token pnpm dev:server
```

默认监听 `http://localhost:3000`。`AUTH_TOKEN` 为空且未显式设 `ALLOW_UNAUTHENTICATED_DEV=1` 时，受保护的 `/api/*` 一律返回 500——这是 fail-closed，不是启动失败；前端设置页填的 token 要与它一致。

仓库没装 dotenv、dev 脚本也没有 `--env-file`，应用**不会自动读取 `.env`**。根目录 `.env`（已 gitignore）是给起服务的人 / agent 自己读取、再把 `AUTH_TOKEN`、`ALLOWED_ORIGINS`、`DIARY_VAULT_DIR` 等显式注入启动命令用的；`.env` 不存在时用命令行临时变量。完整环境变量与日记 vault 配法见 [deployment](deployment.md)。

探活走公开端点 `GET /api/health`：

```json
{"status":"ok","db":"ok"}
```

数据库 ping 不通时 `db` 变成 `"error"` 且状态码 503。`/api/health` 与 `/api/version` 是仅有的两个公开端点，根路径走静态文件与 SPA fallback，不返回 API banner。

前端：

```bash
pnpm dev:client
```

`vite.config.ts` 只固定 `server.port = 5174` 与 `/api` 代理到 `http://localhost:3000`，**不设 `server.host`**，前后端可以分开启动。

不设 host 的后果：Vite 默认可能只监听 IPv6 `[::1]`，而浏览器走 IPv4 时连不上——**`localhost` 同样中招**，它在本机多半解析成 `127.0.0.1`，那个地址上没人接。此时换 `http://127.0.0.1:5174` 无效（是同一个没人接的地址），要显式绑定：

```bash
pnpm --filter @timedata/client exec vite --host 127.0.0.1
```

Vite 打印的启动 URL 写的是 `localhost`，不反映实际绑定的地址族，据它判断「起好了」会误判。确诊看实际监听地址：`Get-NetTCPConnection -LocalPort 5174 -State Listen | Select LocalAddress,OwningProcess`——`::1` 即命中本坑，`127.0.0.1` / `0.0.0.0` 则另有原因。

## 常用命令（已外提）

全部 `pnpm` 命令、两档验证分工（聚焦验证 vs `pnpm gate`）、`--since` 的假通过陷阱、构建顺序，以及 client 三个测试 project 的分工与纪律、测试卫生棘轮与豁免登记、fake timers 与 `fake-indexeddb` 的冲突，见子文档 [development/commands-and-testing](development/commands-and-testing.md)。

## Android APK 打包

首次打包前确认 Android SDK 组件已安装。如果缺少组件，可以使用 `sdkmanager` 安装：

```bash
sdkmanager --sdk_root="C:\Users\yanzh\AppData\Local\Android\Sdk" "platform-tools" "platforms;android-35" "build-tools;35.0.0"
sdkmanager --sdk_root="C:\Users\yanzh\AppData\Local\Android\Sdk" --licenses
```

构建 debug APK：

```bash
pnpm build:mobile:apk
```

Debug APK 输出位置：

```text
packages/mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

构建 release APK 需要提供 Gradle signing 参数：

```bash
ORG_GRADLE_PROJECT_TIMEDATA_RELEASE_STORE_FILE=../timedata-release.keystore \
ORG_GRADLE_PROJECT_TIMEDATA_RELEASE_STORE_PASSWORD=... \
ORG_GRADLE_PROJECT_TIMEDATA_RELEASE_KEY_ALIAS=... \
ORG_GRADLE_PROJECT_TIMEDATA_RELEASE_KEY_PASSWORD=... \
pnpm build:mobile:release-apk
```

Release APK 输出位置：

```text
packages/mobile/android/app/build/outputs/apk/release/app-release.apk
```

GitHub Actions 的 `mobile-release` workflow 在 android job 里用仓库 Secrets 构建签名 release APK，完成后在 run 页面下载 `timedata-release-apk` artifact。该 workflow 的 Android / iOS / Windows 三个平台共用 prepare 阶段；GitHub Release 的 latest 只由新发版 android job 的「Mark release as latest」步骤落位，补包不碰 latest。workflow 会把计算出的 versionCode 同时传给 Vite 的 `TIMEDATA_ANDROID_VERSION_CODE` 和 Gradle 的 `ORG_GRADLE_PROJECT_TIMEDATA_ANDROID_VERSION_CODE`，避免在 CI 中临时改源码。

移动端构建会使用 `packages/client` 的 mobile Vite 模式：

- `base` 恒为 `/`，**mobile 模式不改成相对**。三个壳都从各自的根提供这份产物（Capacitor iOS `capacitor://localhost`、Android `https://localhost`、Tauri `tauri://localhost`），绝对路径在任何路由深度下都指向 `dist` 根。改成 `./` 的后果：路由是多段路径（底栏「统计」就是 `/stats/time`），**原地重载**时 `./assets/x.js` 会解析成 `/stats/assets/x.js`，而 Capacitor iOS 的 `Router.route(for:)` 只对**无扩展名**的路径回退 index.html、带扩展名的直接按字面找文件——JS 与 CSS 双双 404、React 从不挂载，`index.css` 又没给 `body` 背景色，屏幕就是一张纯白页。冷启动不暴露（壳总是从 `/` 起），只有原地重载才现形（`SchedulerWatchdog` 的死锁自救、`ErrorBoundary` 的「刷新」按钮），故现场表现是「iOS 长时间后台回来变纯白」，见 [ios](ios.md) §6。闸在 `packages/client/vite.config.test.ts`（按真实壳 URL 解析真实 base，改回相对即红）。
- PWA service worker 和 PWA manifest 在 mobile 模式禁用，避免 WebView 缓存和更新提示干扰；Web/PWA 构建会由 `vite-plugin-pwa` 生成 `manifest.webmanifest`，图标来自 `packages/client/public/icons/`，Android 启动图标位于 `packages/mobile/android/app/src/main/res/mipmap-*/`；这两处和 favicon 都由 `pnpm icons:generate` 从根目录 `icon.png` 生成，换图只需替换根目录源图后重跑该命令。
- Web/PWA 构建会额外注入 `__TIMEDATA_BUILD_ID__`（优先读 `TIMEDATA_BUILD_ID` 环境变量，否则使用构建时毫秒时间戳）并输出不进 precache 的 `version.json`；客户端 `AppUpdateProvider` 在页面加载、从后台切回可见和窗口重新聚焦时用网络 buildId 比对决定是否硬刷新（注销已有 service worker、清空 Cache Storage 并 reload，绕开 iOS standalone PWA 偶发不刷新缓存的问题），设置页也提供「刷新到最新前端」手动兜底。mobile 模式不输出这条 PWA 更新链路所需的 service worker 行为，APK 更新仍走 Android release 流程。
- `packages/mobile/capacitor.config.ts` 固定 `androidScheme: "https"`、`cleartext: false`、`allowMixedContent: false`，正式同步应使用 HTTPS；Android 原生环境的服务器配置会拒绝保存 `http://` API 地址，自托管开发也应先配 HTTPS 反向代理或隧道后填写 `https://` 地址。`pnpm --filter @timedata/mobile test` 会静态检查生产 Manifest 不允许明文流量，并检查 `packages/client` 与 `packages/mobile` 的 Capacitor 依赖都保持 v7。
- Android 系统返回键/边缘返回通过 `packages/mobile` 的 `@capacitor/app` 原生插件监听，并交给前端 `backNavigation` 处理。落点出自单张「层级子页 → 返回目标」语义表 `resolveBackTarget`：设置二级页（含 `/settings/more` 更多功能）回 `/settings`，数据备份历史回 `/settings/data`、分类详情回分类列表；统计子页回 `/stats`、日记回顾回 `/diary`；轨道/目标详情分别回 `/tracks`、`/goals`；新增/编辑记录与搜索页优先走 history back，兜底回时间轴；日记页同样优先 history back，兜底回速记页。**表外即非子页**：根路径退出 App，其余落兜底回时间轴——这两条是安卓返回键专属语义。同一张表导出的 `hasParentRoute` 也是 iOS 边缘返回手势的生效判据之一，见 [ios/page-stack](ios/page-stack.md)。匹配前先把 pathname 归一化（削尾斜杠 + 转小写）对齐 react-router 的匹配口径：不对齐就会出现「深链进 `/settings/data/` 页面正常、返回却当它不是子页」。
- APK 更新直链优先走 `@capacitor/app-launcher` 交给系统 URL 处理，失败时再 fallback 到 `@capacitor/browser` / Web `window.open`。
- 备份导出走 `@capacitor/filesystem` + `@capacitor/share`：在 native 端把 JSON 写入 `Directory.Documents` 后弹出系统分享面板。新增/删除这些 Capacitor 插件后必须重跑 `pnpm --filter @timedata/mobile android:sync` 把原生侧重新同步。

## 项目结构

```text
TimeData/
├── package.json                 # 根项目脚本
├── pnpm-workspace.yaml          # pnpm workspace 配置
├── pnpm-lock.yaml               # 依赖锁定文件
├── docker-compose.yml           # Docker Compose 部署配置
├── tsconfig.base.json           # TypeScript 基础配置
├── packages/
│   ├── shared/                  # 前后端共享类型、常量
│   ├── server/                  # Hono + SQLite 后端 API
│   ├── client/                  # React + Vite 前端 PWA
│   ├── cli/                     # 受控 API 网关 CLI
│   ├── mobile/                  # Capacitor Android / iOS 壳
│   └── desktop/                 # Tauri Windows 壳，内嵌 client/dist
└── docs/                        # 设计和实现计划文档
```

`tsconfig.base.json` 是所有 package 共享的 TypeScript 基础配置：除了 `strict: true`，还显式开启 `noImplicitOverride`（覆盖父类成员必须写 `override`，例如 `packages/client/src/components/ErrorBoundary.tsx` 的 `state` / `componentDidCatch` / `render`）和 `noFallthroughCasesInSwitch`（`switch` 漏写 `break` / `return` 会编译失败）。各 package 的 `tsconfig.json` 只在这份配置上做最小扩展，新增 package 时直接 `extends` 它即可保证启用同一组严格选项。

## 技术栈

- 前端：React、TypeScript、Vite、Tailwind CSS、Dexie、React Router、Recharts、React Flow（`@xyflow/react`）、dnd-kit、d3-force、react-markdown/remark-gfm/rehype-sanitize
  - d3-force 只服务 `/goals` 全局星图的可选 settle 引擎，必须由 `useGalaxySettleEngine` 动态 import；默认确定性星图路径不静态引入它。
  - dnd-kit 用于设置页下的分类管理拖拽排序：`packages/client/src/pages/settings/SettingsCategoriesPage.tsx` 组织一级分类 DnD 作用域，`SettingsCategoryDetailPage.tsx` 组织子分类 DnD 作用域，`SortableCategoryItem.tsx` 封装拖拽手柄，`useCategories.ts` 负责持久化 `sortOrder` 和 `syncLog`。
  - react-markdown/remark-gfm/rehype-sanitize 只用于 Quick Notes 的安全 Markdown 展示；速记仍保存原始文本，编辑、复制、导出和同步不依赖渲染结果。
- 后端：Node.js、Hono、better-sqlite3、Zod、TypeScript
- CLI：Node.js、TypeScript、受控 API 命令
- Android：Capacitor、Gradle、Android SDK
- iOS：Capacitor、CocoaPods、Xcode——**macOS-only**，本机（Windows）编不了；原生工程不入库、CI 现场生成，验收只能走 CI 出包 + 侧载装机，见 [ios](ios.md)
- 包管理：pnpm workspaces

## 故障排查

- `http://localhost:3000` 显示 JSON 是正常的，表示后端运行正常；前端页面应访问 `http://localhost:5174`。
- 如果 `5174` 无法访问，确认 `pnpm dev:client` 终端没有关闭，检查 Vite 实际输出的地址。端口被占用时 Vite 会自动切换到 `5175` 等。
- 同步失败时，检查设置页中的 API 地址是否包含协议（`http://` 或 `https://`），并确认 Token 和服务器 `AUTH_TOKEN` 一致。
- Android 同步的 API 地址只填写服务器根地址，例如 `https://timedata.yanzhou.icu`，不要填写 `/api` 后缀。
- Android Token 原样粘贴，不要加 `Bearer ` 前缀，客户端会自动添加。
- 如果 Android 提示无法连接某个 URL，先检查错误里显示的域名是否拼写正确，例如 `timedata` 不要写成 `timedate`。

## 子文档索引

| 子文档 | 拥有什么 |
|---|---|
| [development/commands-and-testing](development/commands-and-testing.md) | 命令清单与两档验证分工、client 测试三桶分工与卫生棘轮、fake timers 陷阱 |
