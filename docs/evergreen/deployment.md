---
type: evergreen
title: 部署与自更新
covers:
  - docker-compose.yml
  - Dockerfile
  - packages/server/Dockerfile
  - packages/server/src/lib/version.ts
  - packages/server/src/lib/update.ts
  - packages/server/src/routes/version.ts
  - packages/server/src/routes/update.ts
  - packages/server/src/index.ts
  - packages/server/src/middleware/auth.ts
  - packages/server/src/middleware/cors.ts
  - packages/client/vite.config.ts
  - packages/client/src/appUpdate.tsx
  - packages/client/src/lib/frontendUpdate.ts
  - packages/client/src/pages/SettingsPage.tsx
  - packages/mobile/capacitor.config.ts
  - packages/mobile/package.json
  - packages/mobile/scripts/**
  - packages/mobile/android/build.gradle
  - packages/mobile/android/app/build.gradle
  - packages/mobile/android/app/capacitor.build.gradle
  - packages/mobile/android/app/proguard-rules.pro
  - packages/mobile/android/settings.gradle
  - packages/mobile/android/gradle.properties
  - packages/mobile/android/variables.gradle
  - packages/mobile/android/app/src/main/AndroidManifest.xml
  - .env.example
  - .github/workflows/**
last-reviewed: 2026-06-18
---

# 部署与自更新

> 部署形态：单进程 Hono + SQLite，跑在 Docker 里。镜像走 GHCR，支持一键自更新。
> 用户视角的部署步骤在 [`README.md`](../../README.md)。本文档讲**机制**，不重复操作步骤。

## 1. 运行时拓扑

```
┌─────────────────────────────────────────────┐
│ Linux host                                  │
│                                             │
│  ┌────────────────────────────────────────┐ │
│  │ timedata 容器                           │ │
│  │  - Hono on :3000                        │ │
│  │  - 挂 ./data → /app/data                │ │
│  │  - 不挂 docker.sock，不安装 docker CLI  │ │
│  │  - 带 Watchtower enable label           │ │
│  └────────────────────┬───────────────────┘ │
│                       │ internal network     │
│  ┌────────────────────▼───────────────────┐ │
│  │ watchtower 容器                         │ │
│  │  - 挂载 docker.sock                     │ │
│  │  - 开启受 token 保护的 HTTP API         │ │
│  │  - 只更新带 Watchtower label 的容器      │ │
│  │  - 不向 host 暴露端口                   │ │
│  └────────────────────────────────────────┘ │
│                                             │
│  ./data/timedata.db    SQLite 主库          │
│  ./data/backups/*.db   sync push 备份       │
│  ./data/update.log     自更新日志           │
│  ./data/update-status.json  自更新状态       │
│                                             │
│  docker-compose.yml + .env                  │
└─────────────────────────────────────────────┘
```

默认部署有两个长期容器：`timedata` 跑应用服务，`watchtower` 负责按需更新带 label 的 TimeData 容器。应用容器以非 root 用户运行，不挂载 `/var/run/docker.sock`，也不安装 docker CLI；自更新只通过内部网络触发 Watchtower 的受鉴权 HTTP API。Docker socket 权限集中在 `watchtower` 容器内，应用进程即便被攻陷也无法直接调用 Docker Engine API。

## 2. 关键环境变量

定义见 `.env.example`，**重点变量**：

| 变量 | 必填 | 用途 |
|---|---|---|
| `AUTH_TOKEN` | 生产必填 | API 鉴权。所有 `/api/*` 请求都要带 `Authorization: Bearer <TOKEN>`，除了 `/api/health` 和 `/api/version` |
| `AGENT_TOKEN` | 否 | 窄域 agent 鉴权。仅 `/api/agent/*` 接受，当前用于任务状态回写与任务轨道 ingest；未设置时该作用域仍可用 `AUTH_TOKEN` |
| `ALLOW_UNAUTHENTICATED_DEV` | 否 | 仅本地开发旁路。设为 `1` 且 `AUTH_TOKEN` 缺失时，放行所有 `/api/*` 并打印一次 warning；生产不要设置 |
| `ALLOWED_ORIGINS` | 生产必填 | CORS 允许来源白名单，逗号分隔；未配置时所有跨域 `/api/*` 请求会被拒绝（fail-closed） |
| `MAX_BODY_BYTES` | 否 | `/api/*` 请求体大小上限（字节），默认 `5242880`（5 MB）；超出返回 HTTP 413 |
| `SYNC_RATE_MAX` | 否 | `/api/sync/*` 每 60 秒最大请求次数（按 token 标识），默认 `60`；超出返回 HTTP 429 |
| `ADMIN_RATE_MAX` | 否 | `/api/admin/*` 每 60 秒最大请求次数，默认 `120`；超出返回 HTTP 429。`/api/admin/sync-logs` 的读写清空也使用该限流，其中清空必须发送 `X-Confirm: true` |
| `DB_PATH` | 否 | 容器内 SQLite 路径，默认 `/app/data/timedata.db` |
| `PORT` | 否 | 监听端口，默认 3000 |
| `UPDATE_REPO` | 否 | 查最新版本的 GitHub 仓库，默认 `HaiouZh/TimeData` |
| `GITHUB_TOKEN` | 否 | 提高 GitHub API 限额（匿名 60 次/小时，带 token 5000） |
| `WATCHTOWER_URL` | 否 | Watchtower HTTP API 地址，默认由 compose 注入 `http://watchtower:8080` |
| `WATCHTOWER_TOKEN` | 生产必填 | Watchtower HTTP API token；`/api/update` 用它触发内部 Watchtower 更新。缺失时 `/api/update` 返回 503 `SELF_UPDATE_DISABLED` |
| `TIMEDATA_IMAGE_TAG` | 否 | TimeData 镜像 tag，默认 `latest`，可 pin 到指定版本；生产环境建议在 `.env` 中固定为已验证的提交 tag，例如 `TIMEDATA_IMAGE_TAG=sha-abcdef1` |
| `UPDATE_STATE_DIR` | 否 | 自更新状态文件目录，默认 `/app/data`；一般不需要配置 |

`AUTH_TOKEN` 缺失时：auth 中间件默认对受保护的 `/api/*` 返回 HTTP 500，不再按 `NODE_ENV` 区分开发/生产。只有显式设置 `ALLOW_UNAUTHENTICATED_DEV=1` 时，才会放行所有 `/api/*` 并且每个进程只输出一次警告；这个旁路只用于本地开发，不能用于生产部署。

受保护业务路由包括 `/api/categories`、`/api/entries`、`/api/quick-notes`、`/api/sync/*`、`/api/export`、`/api/update`、`/api/data/*` 和 `/api/admin/*`；只有 `/api/health` 与 `/api/version` 在 auth middleware 前注册。`/api/agent/*` 在全局 auth 前单独挂 scoped auth，接受 `AUTH_TOKEN` 或 `AGENT_TOKEN`，但只暴露封闭的 agent 动作集合。

`ALLOWED_ORIGINS` 由 `packages/server/src/middleware/cors.ts` 解析，`packages/server/src/index.ts` 在 `/api/*` CORS 中间件里使用。自 2026-05-19 起，未配置时解析为**空数组**，所有跨域 `/api/*` 请求都会被拒绝；生产部署必须显式填写 Web 前端域名，例如 `ALLOWED_ORIGINS=https://timedata.example.com`。多域名用逗号分隔，例如 `ALLOWED_ORIGINS=https://timedata.example.com,https://timedata-staging.example.com`。Android/Capacitor 壳（`androidScheme: "https"`）的 origin 是 `https://localhost`，必须显式加入白名单；兼容旧 scheme 时一并加 `capacitor://localhost`。保留 `ALLOWED_ORIGINS=*` 可以通配来源，但 `*` 配合 `credentials: true` 等于反射任意来源请求，server 启动期会打印 WARN，不推荐用于生产环境。

**部署陷阱**：`docker-compose.yml` 的 `environment:` 块**必须**显式列出 `- ALLOWED_ORIGINS=${ALLOWED_ORIGINS:-}`，否则就算 `.env` 写了值，变量也进不到容器里。Web 前端走同源不触发 CORS，所以这种漏配通常要等到 Android App 第一次跨域请求 `/api/sync/status` 才会暴露，表现为 App 内提示"网络请求失败：无法连接 https://&lt;your-host&gt;/api/sync/status"。

**自部署排错**：当 Android App 报上述错误而 PC 浏览器访问正常时，95% 是 `ALLOWED_ORIGINS` 没生效（要么 `.env` 漏了 `https://localhost`，要么 `docker-compose.yml` 漏了那一行）。一行 curl 即可验证：

```bash
curl -sS -i -H "Origin: https://localhost" https://<your-host>/api/health \
  | grep -i "access-control-allow-origin"
```

输出应包含 `access-control-allow-origin: https://localhost`。没有这一行就是 CORS 未放行，需要同时检查 `.env` 和 `docker-compose.yml`。修改后 `docker compose up -d` 重建容器（不需要 `down`），用 `docker compose exec timedata sh -c 'echo $ALLOWED_ORIGINS'` 再次确认变量已注入。

## 3. 镜像与发布流程

```
git push main
  → GitHub Actions（.github/workflows/）
  → docker buildx 构建多架构镜像
  → push 到 ghcr.io/haiouzh/timedata:latest（带 GIT_SHA tag）
```

Dockerfile 构建镜像时会临时安装构建工具（python3、make、g++），从源码重建 better-sqlite3 的原生 `.node` 绑定，验证产物存在后立即卸载构建工具。这是因为 pnpm install 在 Alpine 上拉取的预编译二进制可能与容器 musl libc 不兼容，需要针对当前容器环境从源码编译。运行时阶段另外安装 Python 3 + pip 并通过 pip 安装 `garminconnect` 和 `garth`，供 Garmin 健康数据抓取服务使用；生产镜像把抓取脚本放在 `/app/garminFetch.py`，服务启动 Python 子进程时优先使用该路径，再回退开发路径。相关代码入口：`packages/server/Dockerfile`、`packages/server/src/garmin/garminService.ts`。

具体 workflow yaml 文件名和构建参数详见 `.github/workflows/`。其中：

- `ci.yml`：push / PR 的基础 CI，安装依赖后先运行 `pnpm audit --audit-level=high --prod`，生产依赖存在 high/critical advisory 时直接阻断；随后依次运行 `pnpm lint`、`pnpm -r typecheck`、`pnpm -r --parallel test`、`pnpm test:scripts`、evergreen 文档一致性检查、`pnpm check:docs:size` 和 `pnpm build`，不发布产物。文档一致性检查只在 `pull_request` 事件下运行（main 的 push 不重跑，因为同样的 diff 在 PR 阶段已经查过），按发起人区分：dependabot 触发的 PR 走 `pnpm check:docs`（warn，不阻塞），其余走 `pnpm check:docs:strict`。体量棘轮不依赖 PR diff，push 和 PR 都会跑，要求 `scripts/evergreen-size-baseline.json` 覆盖当前所有 evergreen 文档，且字符数 / `covers:` 不超过基线。
- `build.yml`：main 分支发布镜像到 GHCR，自更新机制读取它的成功运行记录。
- `android-apk.yml`：Android 签名 release APK 构建与 GitHub Release 发布流程；`pnpm/action-setup`（v6，自身运行在 Node 24）必须先于 `actions/setup-node`，因为 setup-node v5 的 pnpm 缓存逻辑会在步骤执行时查找 `pnpm`。`ci.yml` 同此约定。

## 3.1 Android APK 发布

`android-apk.yml` 发布的是 `app-release.apk`，不是 debug APK。workflow 需要以下 GitHub Secrets：

| Secret | 用途 |
|---|---|
| `TIMEDATA_RELEASE_KEYSTORE_BASE64` | release keystore 文件的 base64 内容 |
| `TIMEDATA_RELEASE_STORE_PASSWORD` | keystore 密码 |
| `TIMEDATA_RELEASE_KEY_ALIAS` | key alias |
| `TIMEDATA_RELEASE_KEY_PASSWORD` | key 密码 |

workflow 会先检查 `TIMEDATA_RELEASE_KEYSTORE_BASE64` 是否已配置，缺失时在 `Decode release keystore` 步骤明确失败；配置存在后把 keystore 解码到 `packages/mobile/android/timedata-release.keystore`，通过 `ORG_GRADLE_PROJECT_*` 传给 Gradle，并把同一个 versionCode 传给 Gradle 与 Vite（`TIMEDATA_ANDROID_VERSION_CODE`），然后运行 `pnpm build:mobile:release-apk`。构建步骤之后固定执行 `Cleanup release keystore`（`if: always()`），在上传 artifact 或发布 Release 前删除 workspace 内的 `packages/mobile/android/timedata-release.keystore`，即使前面的构建失败也会清理。`packages/mobile` 的 release APK 构建和 `pnpm build:mobile:release-apk` 始终保持一致，文档里的构建步骤以这个脚本为准。产物路径是：

```text
packages/mobile/android/app/build/outputs/apk/release/app-release.apk
```

构建完成后，workflow 先上传 APK artifact，再用 `gh release` 创建或更新 `android-<versionCode>` GitHub Release，并对 GitHub Release API 的临时超时做最多 3 次重试。Release 发布失败不代表 APK 编译失败；排查时先看 `Build signed release APK` 和 `Upload release APK` 两步是否成功，再看 `Publish latest release APK release` 的 GitHub API 错误。

设置页的「APK 更新」读取最新 GitHub Release；发现新版本时打开该 Release 里的 APK asset 下载链接。Android 原生环境优先通过 `@capacitor/app-launcher` 把 APK 直链交给系统 URL 处理，失败时再 fallback 到 `@capacitor/browser` / Web `window.open`。Android 仍会要求用户确认安装，首次从旧 debug 签名包迁移到 release 签名包时不能覆盖安装，需要先备份数据、卸载旧包，再安装 release 包；后续 release 包之间可以覆盖安装。

Capacitor 7 版本的 Android 构建要求：Node 22+、Java 21、Android SDK Platform 35 / Build-tools 35.0.0、Gradle 8.11.1、Android Gradle Plugin 8.7.2。`packages/mobile/android/variables.gradle` 中 `minSdkVersion = 24`，因此 APK 支持 Android 7.0（API 24）及以上设备；`compileSdkVersion` 和 `targetSdkVersion` 均为 35。CI 的 `android-apk.yml` 也按这些版本安装 Java 与 Android SDK。

Android 端依赖的 Capacitor 插件清单：`@capacitor/app`（返回键）、`@capacitor/app-launcher`（把 APK 下载直链交给系统处理）、`@capacitor/browser`（外链浏览器 fallback）、`@capacitor/filesystem` + `@capacitor/share`（备份导出落盘和分享）。新增或升级这些插件后必须重跑 `pnpm --filter @timedata/mobile android:sync`，让 `packages/mobile/android/capacitor.settings.gradle` 与 `packages/mobile/android/app/capacitor.build.gradle` 同步注册原生插件，否则原生工程拿不到新插件。

Android 生产 Manifest 显式设置 `android:usesCleartextTraffic="false"`，并且 `packages/mobile/capacitor.config.ts` 保持 `server.cleartext: false`、`android.allowMixedContent: false`。App 内服务器配置在原生 Android 环境会拒绝保存 `http://` API 地址；自托管服务器需要先通过 Caddy / Nginx / Tunnel 等方式暴露 HTTPS，再在 App 中填写 `https://` 地址。`pnpm --filter @timedata/mobile test` 会静态检查这些安全配置，避免 release APK 默认允许 HTTP 明文流量或混合内容。

### 3.1.1 本地生成 release keystore

CI 用的 keystore 是一次性生成，长期复用。本地需要时可以用 JDK 自带的 `keytool`：

```bash
keytool -genkeypair -v \
  -keystore timedata-release.keystore \
  -alias timedata-release \
  -keyalg RSA -keysize 2048 -validity 36500 \
  -storetype JKS
```

生成后把 keystore 移到 `packages/mobile/android/timedata-release.keystore`（已在 `.gitignore`），并把以下变量传给 Gradle：

```bash
ORG_GRADLE_PROJECT_TIMEDATA_RELEASE_STORE_FILE=../timedata-release.keystore \
ORG_GRADLE_PROJECT_TIMEDATA_RELEASE_STORE_PASSWORD=... \
ORG_GRADLE_PROJECT_TIMEDATA_RELEASE_KEY_ALIAS=timedata-release \
ORG_GRADLE_PROJECT_TIMEDATA_RELEASE_KEY_PASSWORD=... \
pnpm build:mobile:release-apk
```

要把 keystore 注入 GitHub Actions，做一次 `base64 -w0 timedata-release.keystore` 拿到单行字符串，存进 `TIMEDATA_RELEASE_KEYSTORE_BASE64` secret；再分别把密码、alias、密码存进对应 secret。**绝不要**把 keystore 提交进仓库；丢失后所有用户都需要卸载重装。

APK 只包含构建时的 client/mobile 代码；自托管服务器镜像由 `build.yml` 另行发布和自更新。生产移动端构建禁止 cleartext：`packages/mobile/capacitor.config.ts` 固定 `androidScheme: "https"`、`cleartext: false`、`allowMixedContent: false`，正式同步必须使用 HTTPS。客户端新增 API 调用后，最新 APK 可能要求服务器也更新到对应版本。排查移动端“连不上服务器”时按顺序确认：`/api/health` 是否可访问、API 地址是否只填域名根、Token 是否正确、反向代理 HTTPS 是否正常、带鉴权的 `/api/sync/status` 是否存在。`/api/health` 正常但 `/api/sync/status` 404 通常表示服务器镜像旧于 APK。

Android 壳入口是 `packages/mobile/android/app/src/main/java/app/timedata/mobile/MainActivity.java`。Activity 启动时关闭 decor 自动适配，并在根内容视图上显式应用 `systemBars` + `displayCutout` 的 inset padding，让 Capacitor WebView 避开状态栏、导航栏和刘海区域，避免 APK 在全面屏设备上把页面顶部绘制到通知栏下面。

## 4. 版本检查（`/api/version`）

**不需要鉴权**（在 auth middleware 之前注册）。

逻辑（`packages/server/src/lib/version.ts`）：

1. 当前版本 = `process.env.GIT_SHA`（运行时环境变量），取前 7 位。`dev` 表示开发模式。
2. 最新版本 = 调 GitHub API 查 `actions/workflows/build.yml/runs?status=success&branch=main&per_page=1`，取最新成功 run 的 `head_sha` 前 7 位。
3. `hasUpdate = current !== 'dev' && latest !== 'unknown' && current !== latest`。
4. 结果缓存 5 分钟（`CACHE_TTL_MS`）。

返回：

```ts
{ current, latest, hasUpdate, checkedAt }
```

## 5. 自更新（`/api/update`）

**需要鉴权**（POST，token 必须正确）。

流程（`packages/server/src/lib/update.ts`）：

```
client POST /api/update
  ↓
triggerUpdate({
  stateDir: UPDATE_STATE_DIR || '/app/data',
  watchtowerUrl: WATCHTOWER_URL,
  watchtowerToken: WATCHTOWER_TOKEN
})
  ↓
原子创建 /app/data/update.lock；如果锁已存在，返回 409，不启动第二次更新
  ↓
后台任务通过内部网络调用 Watchtower HTTP API：
  POST /v1/update
  Authorization: Bearer <WATCHTOWER_TOKEN>
  ↓
Watchtower 拉取镜像、比较 digest，并在有新镜像时用旧容器 spec 重新创建带 label 的 timedata 容器
  ↓
服务端把 Watchtower 接受触发请求的结果写入 update-status.json / update.log，并释放 update.lock
```

关键点：

1. **服务端互斥是强约束**：`data/update.lock` 通过原子创建保护同一部署；重复 `POST /api/update` 会返回 `409 Conflict`，不会启动第二次更新。锁创建成功后，如果状态文件初始化或后台任务启动前的同步步骤抛错，服务端会立即删除本次 `update.lock` 并把错误抛回调用方；后台 Watchtower 触发失败则写入 `failed` 状态并释放锁。
2. **应用容器不挂 Docker socket**：`timedata` 不直接接触 Docker API，也不安装 docker CLI；它只调用内部网络里的 Watchtower HTTP API，攻击面收敛到“触发更新”一个动作。
3. **更新范围由 Watchtower label 限定**：compose 使用 `--label-enable`，默认只有 `timedata` 带 `com.centurylinklabs.watchtower.enable=true`，因此按需更新只作用于 TimeData 容器，不会波及 host 上其它容器。
4. **Watchtower 负责真正的 recreate**：Watchtower 拉取镜像、比较 digest，并在有新镜像时使用旧容器 spec 重新创建 `timedata`；这比单纯 restart 更符合"更新到新镜像"的目标。
5. **状态语义是触发结果**：服务端的 `succeeded` 表示 Watchtower 已接受 `/v1/update` 请求，不保证新容器已经完成健康启动；部署排查仍以 `data/update.log` 和 `docker compose ps` 为准。
6. **缺配置 fail closed**：`WATCHTOWER_URL` 或 `WATCHTOWER_TOKEN` 缺失时 `/api/update` 返回 503 `SELF_UPDATE_DISABLED`，不会跑空触发，也不会留下假成功状态。
7. 更新状态写到 `/app/data/update-status.json`，前端轮询 `/api/update/status` 获取进度和日志尾部。

### 5.1 更新状态（`/api/update/status`）

返回：

```ts
{
  updateId: string;
  status: "running" | "succeeded" | "failed" | "unknown";
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  logTail: string;   // update.log 的最后 4000 字符
}
```

状态语义：

- `running`：服务端已接受更新请求，后台任务正在调用 Watchtower。
- `succeeded`：Watchtower 已接受 `/v1/update` 触发请求；后续是否拉到新镜像、是否需要 recreate、容器是否健康，以 Watchtower 行为和 `docker compose ps` 为准。
- `failed`：Watchtower token、URL、网络或 HTTP 响应失败；此时看 `update.log` 和 `docker compose ps` 排查。
- `unknown`：还没有状态文件。

如果 `POST /api/update` 返回 `409 Conflict`，说明已有更新锁；不要手动重复触发。只有确认 `update.log` 显示流程已经结束、且没有正在重启的容器时，才考虑在 host 上删除残留的 `data/update.lock`。

## 6. 静态前端服务

服务端的 `app.use("/*", serveStatic({ root: "./public" }))` 把 `public/` 目录暴露成静态资源，其中：

- `/index.html` 是客户端入口
- `*.js` / `*.css` 是 Vite 打包产物
- 所有未匹配 API 的路径 fallback 到 `index.html`（SPA 路由）
- 设置页的 `/settings/admin-insights` 是服务端数据洞察入口，会调用 `/api/admin/*` 读取服务器概览、最近记录、分类汇总、同步诊断、服务端备份、健康检查和基础分析；它仍受 `AUTH_TOKEN` 保护。

打开方式：先在客户端 `设置 → 服务器配置` 保存 API 地址和 Token，再进入 `设置 → 服务端数据洞察`，或直接访问前端域名下的 `/settings/admin-insights`。该面板只读，不修改 SQLite，也不提供任意 SQL。

代码入口：`packages/client/src/pages/SettingsPage.tsx`、`packages/client/src/pages/settings/SettingsAdminInsightsPage.tsx`、`packages/client/src/lib/adminApi.ts`、`packages/server/src/routes/admin.ts`

相关测试：`packages/client/src/pages/SettingsPage.test.tsx`、`packages/client/src/pages/settings/SettingsAdminInsightsPage.test.tsx`、`packages/client/src/lib/adminApi.test.ts`、`packages/server/src/routes/admin.test.ts`

`public/` 里的内容来自 Dockerfile：构建时把 `packages/client/dist/*` 拷过来。所以**部署一次同时更新前端和后端**。

Web PWA 的 Workbox 配置只预缓存静态资源，并把 `/api/**` 配置为 `NetworkOnly`。同步、导出、自更新和管理接口不能被 service worker 返回陈旧缓存；相关入口是 `packages/client/vite.config.ts` 的 `createPwaOptions()`，测试在 `packages/client/src/lib/pwaConfig.test.ts`。

Web/PWA 构建还会通过 Vite `define` 注入 `__TIMEDATA_BUILD_ID__`（优先读 `TIMEDATA_BUILD_ID` 环境变量，否则使用构建时毫秒时间戳），并在 `dist/` 根目录输出同值的 `version.json`。`version.json` 是 JSON 文件，不在 Workbox `globPatterns` 内，因此不会被 precache；客户端用 `fetch("/version.json", { cache: "no-store" })` 做网络版本比对。`AppUpdateProvider` 在页面加载、从后台切回可见和窗口重新聚焦时检查 buildId，发现服务端前端版本更新后会注销已有 service worker、清空 Cache Storage 并 reload，绕开 iOS standalone PWA 偶发不刷新缓存的问题。设置页的「刷新到最新前端」走同一条硬刷新路径，作为手动逃生口。Android mobile 构建不注册 PWA service worker，这套网页前端刷新机制对 APK 壳无副作用。

## 7. 反向代理（HTTPS）

推荐 Caddy 一行：

```caddyfile
timedata.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

客户端设置页填 `https://timedata.example.com`（不要带 `/api`）。**API 地址只填域名根**，因为客户端会自动拼 `/api/...`。

## 8. 数据卷与备份

容器内 `/app/data` ↔ host 上 `./data`：

```
data/
├── timedata.db              主库
├── timedata.db-wal          WAL
├── timedata.db-shm          共享内存
├── backups/                 sync push 前的服务端备份
│   ├── sync_push-2026-05-08T...-...-...db
│   └── ...
├── update.log               自更新日志
└── update-status.json       自更新状态
```

**用户运维必读**：

- `data/` 目录是所有用户数据所在，定期 host 侧备份。
- 升级前备份这整个目录最稳。
- `backups/` 是服务端自动生成的，服务启动时会跑一次清理，每次创建 server backup 后也会异步清理旧普通备份；具体保留窗口见 [`backup.md` 第 6 节](./backup.md#6-server-backup服务端写入前)。

## 9. 改部署相关代码前的清单

- [ ] 跑 `packages/server/src/lib/version.test.ts`、`update.test.ts`：用 mock 测过版本查询和 Watchtower 更新触发流程。
- [ ] 改 `WATCHTOWER_URL`、`WATCHTOWER_TOKEN` 或 Watchtower compose 参数：确认 Watchtower 不暴露 host 端口，且只更新带 `com.centurylinklabs.watchtower.enable=true` label 的容器。
- [ ] 改 `serveStatic` 的 root：影响生产 Dockerfile 的拷贝路径，需要同步改。
- [ ] 改自更新流程：要在 staging 完整跑一次“拉镜像后服务能正常重启 + 接续提供服务”。
- [ ] 改 `/api/version` 缓存 TTL：太短会打 GitHub API 限额，太长用户看不到新版本。
