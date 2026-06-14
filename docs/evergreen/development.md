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
  - packages/mobile/README.md
  - packages/mobile/capacitor.config.ts
last-reviewed: 2026-06-15
---

# 本地开发指南

## 环境要求

```text
Node.js 22.12+   # Vite 7+ 要求
pnpm 10.10+
```

如果本机没有 pnpm，可以先启用 corepack：

```bash
corepack enable
corepack prepare pnpm@latest --activate
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

仓库使用 pnpm 10 的 `onlyBuiltDependencies` 允许 `better-sqlite3` 和 `esbuild` 执行安装构建脚本。CI 和本地安装后不应出现 `Ignored build scripts: better-sqlite3`；如果出现，server 测试会因为缺少 `better_sqlite3.node` 而失败。

## 启动开发服务器

打开两个终端分别启动后端和前端。

后端：

```bash
pnpm dev:server
```

默认监听 `http://localhost:3000`。访问时如果看到类似下面的 JSON，说明后端正常运行：

```json
{"name":"TimeData API","status":"running","hint":"Client dev server is on http://localhost:5173/"}
```

前端：

```bash
pnpm dev:client
```

默认监听 `http://localhost:5173`。Vite 已配置 `/api` 代理到 `http://localhost:3000`，前后端可以分开启动。

如果浏览器访问 `localhost:5173` 失败，可以尝试 `http://127.0.0.1:5173`，或显式指定 host：

```bash
pnpm --filter @timedata/client dev -- --host 127.0.0.1
```

## 常用命令

```bash
pnpm dev:client        # 启动前端开发服务器
pnpm dev:server        # 启动后端开发服务器
pnpm build:shared      # 构建共享包
pnpm build:client      # 构建前端
pnpm build:server      # 构建后端
pnpm build:cli         # 构建 CLI
pnpm build:mobile      # 构建并同步 Android WebView 资源
pnpm --filter @timedata/mobile test # 检查 Android 明文流量和 Capacitor v7 版本约束
pnpm build:mobile:apk          # 构建 Android debug APK
pnpm build:mobile:release-apk  # 构建 Android release APK（需要签名参数）
pnpm build             # 构建 Web/Server/CLI，不包含 Android APK
pnpm lint              # Biome lint（v2.4，配置在 biome.json 使用 files.includes 反向写法），当前用于报告存量 any/import type warning，不因 warning 阻塞
pnpm -r typecheck      # 递归执行各 package TypeScript 检查
pnpm test              # 递归执行各 package 测试；根脚本串行执行 workspace，避免本地全量测试资源争用导致 Vitest hook 超时
pnpm --filter @timedata/server test routes
pnpm --filter @timedata/server test middleware/auth
pnpm --filter @timedata/client test:e2e
pnpm check:docs        # 检查本次改动是否命中需要同步的 evergreen 文档
pnpm check:docs:strict # CI 使用的严格文档检查
pnpm icons:generate    # 从根目录 icon.png 生成 PWA / Android / favicon 全套图标
```

`packages/shared` 的运行时契约测试使用 Vitest，覆盖 `packages/shared/src/schemas.ts` 中的 schema；改跨端类型或同步 payload 形状时先跑 `pnpm --filter @timedata/shared test` 和 `pnpm --filter @timedata/shared build`。`@timedata/cli` 的 `typecheck` 会先构建 shared，因为 CLI 在 package 解析时读取 `packages/shared/dist/index.d.ts`；干净 CI 环境不能依赖本地已有 dist。

> 测试阶段 Vitest 直接解析 `packages/shared/src/index.ts`，因此全新 clone 后无需先 `pnpm build:shared` 即可 `pnpm test`。构建 / dev / 部署仍读 `packages/shared/dist`。

`packages/server` 的路由级测试直接装配 Hono route + 内存 better-sqlite3，通用 helper 在 `packages/server/src/__tests__/helpers.ts`；认证中间件测试在 `packages/server/src/middleware/auth.test.ts`。

`packages/client` 的测试使用 Vitest project 配置：默认 `pnpm --filter @timedata/client test` 会跑 unit + e2e，单独跑同步端到端链路用 `pnpm --filter @timedata/client test:e2e`。e2e 测试入口是 `packages/client/src/__tests__/e2e/sync-roundtrip.e2e.test.ts`，它通过 `packages/server/src/__tests__/e2e/helpers.ts` 在同一 Node 进程里启动内存 Hono server，并用 fake-indexeddb 作为 Dexie 后端。默认多数组件测试走 React server rendering；需要真实 DOM 的交互测试使用 `@vitest-environment jsdom`，依赖由 `packages/client/package.json` 的 devDependency `jsdom` 提供。

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

GitHub Actions 的 `android-apk` workflow 会使用仓库 Secrets 构建签名 release APK，完成后在 run 页面下载 `timedata-release-apk` artifact，main 分支还会发布到最新 GitHub Release。workflow 会把计算出的 versionCode 同时传给 Vite 的 `TIMEDATA_ANDROID_VERSION_CODE` 和 Gradle 的 `ORG_GRADLE_PROJECT_TIMEDATA_ANDROID_VERSION_CODE`，避免在 CI 中临时改源码。

移动端构建会使用 `packages/client` 的 mobile Vite 模式：

- `base` 使用 `./`，保证 Android WebView 能加载相对路径资源。
- PWA service worker 和 PWA manifest 在 mobile 模式禁用，避免 WebView 缓存和更新提示干扰；Web/PWA 构建会由 `vite-plugin-pwa` 生成 `manifest.webmanifest`，图标来自 `packages/client/public/icons/`，Android 启动图标位于 `packages/mobile/android/app/src/main/res/mipmap-*/`；这两处和 favicon 都由 `pnpm icons:generate` 从根目录 `icon.png` 生成，换图只需替换根目录源图后重跑该命令。
- Web/PWA 构建会额外注入 `__TIMEDATA_BUILD_ID__` 并输出不进 precache 的 `version.json`；客户端恢复可见或重新聚焦时会用网络 buildId 比对决定是否硬刷新，设置页也提供「刷新到最新前端」手动兜底。mobile 模式不输出这条 PWA 更新链路所需的 service worker 行为，APK 更新仍走 Android release 流程。
- `packages/mobile/capacitor.config.ts` 固定 `androidScheme: "https"`、`cleartext: false`、`allowMixedContent: false`，正式同步应使用 HTTPS；Android 原生环境的服务器配置会拒绝保存 `http://` API 地址，自托管开发也应先配 HTTPS 反向代理或隧道后填写 `https://` 地址。`pnpm --filter @timedata/mobile test` 会静态检查生产 Manifest 不允许明文流量，并检查 `packages/client` 与 `packages/mobile` 的 Capacitor 依赖都保持 v7。
- Android 系统返回键/边缘返回通过 `packages/mobile` 的 `@capacitor/app` 原生插件监听，并交给前端路由处理，二级页应先回应用上一层级，首页才退出 App。
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
│   └── mobile/                  # Capacitor Android Shell
└── docs/                        # 设计和实现计划文档
```

`tsconfig.base.json` 是所有 package 共享的 TypeScript 基础配置：除了 `strict: true`，还显式开启 `noImplicitOverride`（覆盖父类成员必须写 `override`，例如 `packages/client/src/components/ErrorBoundary.tsx` 的 `state` / `componentDidCatch` / `render`）和 `noFallthroughCasesInSwitch`（`switch` 漏写 `break` / `return` 会编译失败）。各 package 的 `tsconfig.json` 只在这份配置上做最小扩展，新增 package 时直接 `extends` 它即可保证启用同一组严格选项。

## 技术栈

- 前端：React、TypeScript、Vite、Tailwind CSS、Dexie、React Router、Recharts、dnd-kit、react-markdown/remark-gfm/rehype-sanitize
  - dnd-kit 目前用于设置页下的分类管理拖拽排序：`packages/client/src/pages/settings/SettingsCategoriesPage.tsx` 组织一级分类 DnD 作用域，`SettingsCategoryDetailPage.tsx` 组织子分类 DnD 作用域，`SortableCategoryItem.tsx` 封装拖拽手柄，`useCategories.ts` 负责持久化 `sortOrder` 和 `syncLog`。
  - react-markdown/remark-gfm/rehype-sanitize 只用于 Quick Notes 的安全 Markdown 展示；速记仍保存原始文本，编辑、复制、导出和同步不依赖渲染结果。
- 后端：Node.js、Hono、better-sqlite3、Zod、TypeScript
- CLI：Node.js、TypeScript、受控 API 命令
- Android：Capacitor、Gradle、Android SDK
- 包管理：pnpm workspaces

## 故障排查

- `http://localhost:3000` 显示 JSON 是正常的，表示后端运行正常；前端页面应访问 `http://localhost:5173`。
- 如果 `5173` 无法访问，确认 `pnpm dev:client` 终端没有关闭，检查 Vite 实际输出的地址。端口被占用时 Vite 会自动切换到 `5174` 等。
- 同步失败时，检查设置页中的 API 地址是否包含协议（`http://` 或 `https://`），并确认 Token 和服务器 `AUTH_TOKEN` 一致。
- Android 同步的 API 地址只填写服务器根地址，例如 `https://timedata.yanzhou.icu`，不要填写 `/api` 后缀。
- Android Token 原样粘贴，不要加 `Bearer ` 前缀，客户端会自动添加。
- 如果 Android 提示无法连接某个 URL，先检查错误里显示的域名是否拼写正确，例如 `timedata` 不要写成 `timedate`。
