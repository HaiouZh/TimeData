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
  - packages/mobile/**
  - .env.example
  - .github/workflows/**
last-reviewed: 2026-05-17
---

# 部署与自更新

> 部署形态：单进程 Hono + SQLite，跑在 Docker 里。镜像走 GHCR，支持一键自更新。
> 用户视角的部署步骤在 [`README.md`](../../README.md)。本文档讲**机制**，不重复操作步骤。

## 1. 运行时拓扑

```
┌─────────────────────────────────────────┐
│ Linux host                              │
│                                         │
│  ┌────────────────────────────────────┐ │
│  │ timedata 容器                       │ │
│  │  - Hono on :3000                    │ │
│  │  - 挂 ./data → /app/data            │ │
│  │  - 挂 docker.sock → /var/run/...    │ │
│  └────────────────────────────────────┘ │
│                                         │
│  ./data/timedata.db    SQLite 主库      │
│  ./data/backups/*.db   sync push 备份   │
│  ./data/update.log     自更新日志       │
│  ./data/update-status.json  自更新状态   │
│                                         │
│  docker-compose.yml + .env              │
└─────────────────────────────────────────┘
```

只有一个长期容器（`timedata`）。自更新会临时拉起一个 `updater` 容器（`docker:24-cli`）执行 compose 命令再退出。

## 2. 关键环境变量

定义见 `.env.example`，**重点变量**：

| 变量 | 必填 | 用途 |
|---|---|---|
| `AUTH_TOKEN` | 生产必填 | API 鉴权。所有 `/api/*` 请求都要带 `Authorization: Bearer <TOKEN>`，除了 `/api/health` 和 `/api/version` |
| `ALLOWED_ORIGINS` | 否 | CORS 允许来源白名单，逗号分隔；默认 `*` 等同通配 |
| `MAX_BODY_BYTES` | 否 | `/api/*` 请求体大小上限（字节），默认 `5242880`（5 MB）；超出返回 HTTP 413 |
| `SYNC_RATE_MAX` | 否 | `/api/sync/*` 每 60 秒最大请求次数（按 token 标识），默认 `60`；超出返回 HTTP 429 |
| `ADMIN_RATE_MAX` | 否 | `/api/admin/*` 每 60 秒最大请求次数，默认 `120`；超出返回 HTTP 429 |
| `HOST_COMPOSE_DIR` | 是 | **host 上** docker-compose.yml 所在的绝对路径。`updater` 容器需要它来定位 compose 文件。**容器内的路径不行**——updater 容器跟 timedata 容器是同级 |
| `DB_PATH` | 否 | 容器内 SQLite 路径，默认 `/app/data/timedata.db` |
| `PORT` | 否 | 监听端口，默认 3000 |
| `UPDATE_REPO` | 否 | 查最新版本的 GitHub 仓库，默认 `HaiouZh/TimeData` |
| `GITHUB_TOKEN` | 否 | 提高 GitHub API 限额（匿名 60 次/小时，带 token 5000） |
| `UPDATER_IMAGE` | 否 | updater 容器镜像，默认 `docker:24-cli` |

`AUTH_TOKEN` 缺失时（开发模式）：auth 中间件直接放行**所有请求**，并且每个进程只输出一次警告，见 `packages/server/src/middleware/auth.ts`。生产镜像和 `docker-compose.yml` 都设置 `NODE_ENV=production`，服务端启动前会强制检查 `AUTH_TOKEN`，未设置会拒绝启动。

`ALLOWED_ORIGINS` 由 `packages/server/src/middleware/cors.ts` 解析，`packages/server/src/index.ts` 在 `/api/*` CORS 中间件里使用。生产环境建议填明确来源，例如 Web 前端域名 `https://timedata.example.com`；Android/Capacitor 壳常见来源包括 `https://localhost`、`capacitor://localhost`，需要按实际客户端来源加入白名单。保留 `ALLOWED_ORIGINS=*` 可以兼容当前通配行为，但不推荐用于生产环境。

## 3. 镜像与发布流程

```
git push main
  → GitHub Actions（.github/workflows/）
  → docker buildx 构建多架构镜像
  → push 到 ghcr.io/haiouzh/timedata:latest（带 GIT_SHA tag）
```

Dockerfile 构建镜像时会临时安装构建工具（python3、make、g++），从源码重建 better-sqlite3 的原生 `.node` 绑定，验证产物存在后立即卸载构建工具。这是因为 pnpm install 在 Alpine 上拉取的预编译二进制可能与容器 musl libc 不兼容，需要针对当前容器环境从源码编译。相关代码入口：`packages/server/Dockerfile` 中的 `apk add --virtual .native-build-deps` 和 `npm rebuild better-sqlite3 --build-from-source` 段落。

具体 workflow yaml 文件名和构建参数详见 `.github/workflows/`。其中：

- `ci.yml`：push / PR 的基础 CI，安装依赖后依次运行 `pnpm lint`、`pnpm -r typecheck`、`pnpm -r --parallel test`、`pnpm check:docs:strict` 和 `pnpm build`，不发布产物。
- `build.yml`：main 分支发布镜像到 GHCR，自更新机制读取它的成功运行记录。
- `android-apk.yml`：Android 签名 release APK 构建与 GitHub Release 发布流程。

## 3.1 Android APK 发布

`android-apk.yml` 发布的是 `app-release.apk`，不是 debug APK。workflow 需要以下 GitHub Secrets：

| Secret | 用途 |
|---|---|
| `TIMEDATA_RELEASE_KEYSTORE_BASE64` | release keystore 文件的 base64 内容 |
| `TIMEDATA_RELEASE_STORE_PASSWORD` | keystore 密码 |
| `TIMEDATA_RELEASE_KEY_ALIAS` | key alias |
| `TIMEDATA_RELEASE_KEY_PASSWORD` | key 密码 |

workflow 会先检查 `TIMEDATA_RELEASE_KEYSTORE_BASE64` 是否已配置，缺失时在 `Decode release keystore` 步骤明确失败；配置存在后把 keystore 解码到 `packages/mobile/android/timedata-release.keystore`，通过 `ORG_GRADLE_PROJECT_*` 传给 Gradle，并把同一个 versionCode 传给 Gradle 与 Vite（`TIMEDATA_ANDROID_VERSION_CODE`），然后运行 `pnpm build:mobile:release-apk`。产物路径是：

```text
packages/mobile/android/app/build/outputs/apk/release/app-release.apk
```

构建完成后，workflow 先上传 APK artifact，再用 `gh release` 创建或更新 `android-<versionCode>` GitHub Release，并对 GitHub Release API 的临时超时做最多 3 次重试。Release 发布失败不代表 APK 编译失败；排查时先看 `Build signed release APK` 和 `Upload release APK` 两步是否成功，再看 `Publish latest release APK release` 的 GitHub API 错误。

设置页的「APK 更新」读取最新 GitHub Release；发现新版本时打开该 Release 里的 APK asset 下载链接，让系统浏览器处理下载。Android 仍会要求用户确认安装，首次从旧 debug 签名包迁移到 release 签名包时不能覆盖安装，需要先备份数据、卸载旧包，再安装 release 包；后续 release 包之间可以覆盖安装。

Capacitor 7 版本的 Android 构建要求：Node 22+、Java 21、Android SDK Platform 35 / Build-tools 35.0.0、Gradle 8.11.1、Android Gradle Plugin 8.7.2。`packages/mobile/android/variables.gradle` 中 `minSdkVersion = 24`，因此 APK 支持 Android 7.0（API 24）及以上设备；`compileSdkVersion` 和 `targetSdkVersion` 均为 35。CI 的 `android-apk.yml` 也按这些版本安装 Java 与 Android SDK。

Android 端依赖的 Capacitor 插件清单：`@capacitor/app`（返回键）、`@capacitor/browser`（外链浏览器）、`@capacitor/filesystem` + `@capacitor/share`（备份导出落盘和分享）。新增或升级这些插件后必须重跑 `pnpm --filter @timedata/mobile android:sync`，否则原生工程拿不到新插件。

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

APK 只包含构建时的 client/mobile 代码；自托管服务器镜像由 `build.yml` 另行发布和自更新。客户端新增 API 调用后，最新 APK 可能要求服务器也更新到对应版本。排查移动端“连不上服务器”时按顺序确认：`/api/health` 是否可访问、API 地址是否只填域名根、Token 是否正确、反向代理 HTTPS 是否正常、带鉴权的 `/api/sync/status` 是否存在。`/api/health` 正常但 `/api/sync/status` 404 通常表示服务器镜像旧于 APK。

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
triggerUpdate({ hostComposeDir, image: 'docker:24-cli' })
  ↓
原子创建 data/update.lock；如果锁已存在，返回 409，不启动第二个 updater
  ↓
spawn 一个临时 updater 容器，挂 docker.sock + HOST_COMPOSE_DIR，并使用 host 网络
  ↓ 在 updater 容器里跑：
        docker compose pull
        docker compose up -d --force-recreate
        轮询 http://127.0.0.1:3000/api/health
        如果失败，在同一把锁内尝试一次 docker compose up -d 恢复
        写 data/update-status.json 为 succeeded 或 failed
  ↓
updater 容器退出，trap 删除 update.lock，留下 update.log + update-status.json
```

关键点：

1. **服务端互斥是强约束**：`data/update.lock` 通过原子创建保护同一部署目录；重复 `POST /api/update` 会返回 `409 Conflict`，不会启动第二个 updater。
2. **updater 容器独立于 timedata 容器**：timedata 重启时 updater 不会被打断。
3. **靠挂载 `/var/run/docker.sock`**：updater 容器实际用的是 host 的 docker daemon。
4. **updater 使用 host 网络**：健康检查访问 `http://127.0.0.1:3000/api/health`，对应 host 上 compose 映射出的 TimeData 服务。
5. `HOST_COMPOSE_DIR` 必须是 host 路径（**不是**容器内路径），否则 updater 找不到 compose 文件。
6. 更新 ID 写到 `data/update-status.json`，前端轮询 `/api/update/status` 获取进度和日志尾部。
7. updater 在 compose recreate 后轮询健康检查；失败时只在当前锁内自动尝试一次 `docker compose up -d` 恢复。

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

- `running`：服务端已接受更新请求，updater 正在执行。
- `succeeded`：updater 完成 compose 更新，并通过本机 `/api/health` 健康检查；如果首次 recreate 后失败但一次恢复成功，也会写为 `succeeded`，细节看 `logTail`。
- `failed`：compose、恢复或健康检查最终失败；此时看 `update.log` 和 `docker compose ps` 排查。
- `unknown`：还没有状态文件。

如果 `POST /api/update` 返回 `409 Conflict`，说明已有更新锁；不要手动重复触发。只有确认没有 updater 在运行、且 `update.log` 显示流程已经结束后，才考虑在 host 上删除残留的 `data/update.lock`。

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

- [ ] 跑 `packages/server/src/lib/version.test.ts`、`update.test.ts`：用 mock 测过版本查询和 updater spawn。
- [ ] 改 `HOST_COMPOSE_DIR` 用法：跨平台（Windows/Linux 路径分隔符）很容易踩坑。
- [ ] 改 `serveStatic` 的 root：影响生产 Dockerfile 的拷贝路径，需要同步改。
- [ ] 改自更新流程：要在 staging 完整跑一次"`docker compose pull` 后服务能正常重启 + 接续提供服务"。
- [ ] 改 `/api/version` 缓存 TTL：太短会打 GitHub API 限额，太长用户看不到新版本。
