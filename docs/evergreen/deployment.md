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
  - .env.example
  - .github/workflows/ci.yml
  - .github/workflows/build.yml
  - .github/workflows/secret-scan.yml
  - renovate.json5
  - .gitleaks.toml
contracts:
  - docker-compose.yml
  - Dockerfile
  - packages/server/Dockerfile
  - .env.example
last-reviewed: 2026-07-10
---

<!-- 复核 2026-07-02（S2 调度重做）：SettingsPage.tsx 手动同步按钮 onClick 从 `sync` 改为 `() => sync()`（仅签名包装，行为不变，仍不经调度器直调 sync()），部署/自更新相关内容无需改动。 -->
<!-- 复核 2026-07-04（同步 staleGuard）：SettingsPage 仅新增本地/服务器时钟偏差告警；部署拓扑、自更新接口和环境变量不变。 -->

# 部署与自更新

> 部署形态：单进程 Hono + SQLite，跑在 Docker 里。镜像走 GHCR，支持一键自更新。
> 用户视角的部署步骤在 [`README.md`](../../README.md)。本文档讲**机制**，不重复操作步骤。
> 官方 Compose 部署基线：Docker Engine 25+、Docker Compose v2。

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
│  ./vault/              Obsidian vault(日记) │
│                                             │
│  docker-compose.yml + .env                  │
└─────────────────────────────────────────────┘
```

默认部署有两个长期容器：`timedata` 跑应用服务，`watchtower` 负责按需更新带 label 的 TimeData 容器。Compose 固定使用 `containrrr/watchtower:1.7.1`，并显式注入 `DOCKER_API_VERSION=1.44`，避免 Watchtower 默认 Docker API `1.25` 被新版 Docker Engine 拒绝；因此官方部署基线是 Docker Engine 25+。应用容器以非 root 用户运行，不挂载 `/var/run/docker.sock`，也不安装 docker CLI；自更新只通过内部网络触发 Watchtower 的受鉴权 HTTP API。Docker socket 权限集中在 `watchtower` 容器内，应用进程即便被攻陷也无法直接调用 Docker Engine API。

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
| `ADMIN_RATE_MAX` | 否 | `/api/admin/*` 每 60 秒最大请求次数，默认 `120`；超出返回 HTTP 429。`/api/admin/sync-logs` 的读写清空和 `/api/admin/request-logs` 的只读查询都使用该限流，其中 sync logs 清空必须发送 `X-Confirm: true` |
| `DB_PATH` | 否 | 容器内 SQLite 路径，默认 `/app/data/timedata.db` |
| `PORT` | 否 | 监听端口，默认 3000 |
| `UPDATE_REPO` | 否 | 查最新版本的 GitHub 仓库，默认 `HaiouZh/TimeData` |
| `GITHUB_TOKEN` | 否 | 提高 GitHub API 限额（匿名 60 次/小时，带 token 5000） |
| `WATCHTOWER_URL` | 否 | Watchtower HTTP API 地址，默认由 compose 注入 `http://watchtower:8080` |
| `WATCHTOWER_TOKEN` | 生产必填 | Watchtower HTTP API token；`/api/update` 用它触发内部 Watchtower 更新。缺失时 `/api/update` 返回 503 `SELF_UPDATE_DISABLED` |
| `TIMEDATA_IMAGE_TAG` | 否 | TimeData 镜像 tag，默认 `latest`，可 pin 到指定版本；生产环境建议在 `.env` 中固定为已验证的提交 tag，例如 `TIMEDATA_IMAGE_TAG=sha-abcdef1` |
| `UPDATE_STATE_DIR` | 否 | 自更新状态文件目录，默认 `/app/data`；一般不需要配置 |
| `DIARY_VAULT_DIR` | 否 | 日记功能的 vault 目录（容器内路径）。compose 默认把宿主机 `${DIARY_VAULT_HOST_DIR:-./vault}` 挂载到 `/app/vault` 并注入该变量；显式设为空则日记 API 返回未启用。vault 内容从 PC 同步到宿主机目录由部署方自理 |

`AUTH_TOKEN` 缺失时：auth 中间件默认对受保护的 `/api/*` 返回 HTTP 500，不再按 `NODE_ENV` 区分开发/生产。只有显式设置 `ALLOW_UNAUTHENTICATED_DEV=1` 时，才会放行所有 `/api/*` 并且每个进程只输出一次警告；这个旁路只用于本地开发，不能用于生产部署。

受保护业务路由包括 `/api/categories`、`/api/entries`、`/api/quick-notes`、`/api/sync/*`、`/api/export`、`/api/update`、`/api/data/*` 和 `/api/admin/*`；只有 `/api/health` 与 `/api/version` 在 auth middleware 前注册。`/api/agent/*` 在全局 auth 前单独挂 scoped auth，接受 `AUTH_TOKEN` 或 `AGENT_TOKEN`，但只暴露封闭的 agent 动作集合。

`ALLOWED_ORIGINS` 由 `packages/server/src/middleware/cors.ts` 解析，`packages/server/src/index.ts` 在 `/api/*` CORS 中间件里使用。自 2026-05-19 起，未配置时解析为**空数组**，所有跨域 `/api/*` 请求都会被拒绝；生产部署必须显式填写 Web 前端域名，例如 `ALLOWED_ORIGINS=https://timedata.example.com`。多域名用逗号分隔，例如 `ALLOWED_ORIGINS=https://timedata.example.com,https://timedata-staging.example.com`。Android/Capacitor 壳（`androidScheme: "https"`）的 origin 是 `https://localhost`，必须显式加入白名单；兼容旧 scheme 时一并加 `capacitor://localhost`。保留 `ALLOWED_ORIGINS=*` 可以通配来源，但 `*` 配合 `credentials: true` 等于反射任意来源请求，server 启动期会打印 WARN，不推荐用于生产环境。

服务端 CORS 允许的请求头包括 `Content-Type`、`Authorization`、`X-Confirm` 和 `X-TimeData-Client`。`X-Confirm` 供 `/api/admin/sync-logs` 清空确认使用，`X-TimeData-Client` 供请求审计记录 client hint；新增跨域自定义 header 时必须同步 server CORS 配置、本文档和相关测试。

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

Dockerfile 构建镜像时先从根 `packageManager` 读取并安装对应 pnpm 11，再临时安装构建工具（python3、make、g++），从源码重建 better-sqlite3 的原生 `.node` 绑定，验证产物存在后立即卸载构建工具。这是因为 pnpm install 在 Alpine 上拉取的预编译二进制可能与容器 musl libc 不兼容，需要针对当前容器环境从源码编译。运行时阶段另外安装 Python 3 + pip 并通过 pip 安装 `garminconnect` 和 `garth`，供 Garmin 健康数据抓取服务使用；生产镜像把抓取脚本放在 `/app/garminFetch.py`，服务启动 Python 子进程时优先使用该路径，再回退开发路径。相关代码入口：`packages/server/Dockerfile`、`packages/server/src/garmin/garminService.ts`。

具体 workflow yaml 文件名和构建参数详见 `.github/workflows/`。其中：

- `ci.yml`：push / PR 的基础 CI，`pnpm/action-setup` 从根 `packageManager` 读取 pnpm 11 版本并安装依赖后，先运行 `pnpm audit --audit-level=high --prod`，生产依赖存在 high/critical advisory 时直接阻断；随后依次运行 `pnpm lint`、`pnpm -r typecheck`、`pnpm -r --parallel test`、`pnpm check:ui`、`pnpm check:design`、`pnpm check:test`、`pnpm test:scripts`、evergreen 文档一致性检查、`pnpm check:docs:size` 和 `pnpm build`，不发布产物。文档一致性检查只在 `pull_request` 事件下运行（main 的 push 不重跑，因为同样的 diff 在 PR 阶段已经查过），按发起人区分：依赖 bot（`dependabot[bot]` / `renovate[bot]`）触发的 PR 走 `pnpm check:docs`（warn，不阻塞），其余走 `pnpm check:docs:strict`。体量棘轮不依赖 PR diff，push 和 PR 都会跑，要求 `scripts/evergreen-size-baseline.json` 覆盖当前所有 evergreen 文档，且字符数 / `covers:` 不超过基线。`ci.yml` 配有 `concurrency`（按 ref 取消被顶掉的旧跑批）。
- `build.yml`：main 分支发布镜像到 GHCR，自更新机制读取它的成功运行记录。
- `android-apk.yml`：Android 签名 release APK 构建与 GitHub Release 发布流程；`pnpm/action-setup`（v6，自身运行在 Node 24）必须先于 `actions/setup-node`，因为 setup-node v5 的 pnpm 缓存逻辑会在步骤执行时查找 `pnpm`。此 workflow 和 `ci.yml` 都从根 `packageManager` 读取 pnpm 11 版本。
- `secret-scan.yml`：push main / PR 上用 gitleaks 扫全历史找泄漏的密钥；误报白名单维护在根目录 `.gitleaks.toml`（`regexTarget = "match"`）。

依赖升级由 Renovate 承担（配置在根目录 `renovate.json5`，需在 GitHub 安装 Renovate App），替代原 dependabot：原生支持 `pnpm-workspace.yaml` 的 catalog，`rangeStrategy: bump` 保证 spec 与 lockfile 同步（否则 `--frozen-lockfile` 拒绝），`minimumReleaseAge: 7 days` 与 pnpm 11 供应链发布龄闸对齐；Capacitor major 被禁用，升级需人工评估。

## 3.1 Android APK 发布

Android 签名 release APK 的 workflow、keystore、Capacitor / Gradle 版本、安全配置与移动端排错，已外提到子文档 [deployment/android-apk](deployment/android-apk.md)。主线关系只有两条：

- APK 只包含构建时的 client/mobile 代码；自托管服务器镜像由 `build.yml` 另行发布和自更新。
- 客户端新增 API 调用后，最新 APK 可能要求服务器也更新到对应版本；移动端“连不上服务器”的 HTTPS、CORS、旧镜像排查见 [deployment/android-apk](deployment/android-apk.md)。

## 4. 版本检查（`/api/version`）

**不需要鉴权**（在 auth middleware 之前注册）。

逻辑（`packages/server/src/lib/version.ts`）：

1. 当前版本 = `process.env.GIT_SHA`（运行时环境变量），取前 7 位。`dev` 表示开发模式。
2. 最新版本 = 调 GitHub API 查 `actions/workflows/build.yml/runs?status=success&branch=main&per_page=1`，取最新成功 run 的 `head_sha` 前 7 位。
3. `hasUpdate = current !== 'dev' && latest !== 'unknown' && current !== latest`。
4. 服务端结果缓存 5 分钟（`CACHE_TTL_MS`）；设置页点「服务端更新」会先重查版本再判断，避免页面旧状态误判。

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

如果 `timedata-watchtower` 持续重启，先执行：

```bash
docker compose logs --tail=100 watchtower
docker version
```

默认配置下 Watchtower 应使用 Docker API `1.44`；日志不应出现 `client version 1.25 is too old`。同时确认宿主机满足 Docker Engine 25+，且 `watchtower` 仍未向 host 暴露端口。

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
- 设置页的 `/settings/admin-insights` 是服务端数据洞察入口，会调用 `/api/admin/*` 读取服务器概览、最近记录、分类汇总、同步诊断、服务端备份、健康检查、基础分析和请求审计；它仍受 `AUTH_TOKEN` 保护。

打开方式：先在客户端 `设置 → 服务器配置` 保存 API 地址和 Token，再进入 `设置 → 服务端数据洞察`，或直接访问前端域名下的 `/settings/admin-insights`。该面板只读，不修改 SQLite，也不提供任意 SQL；请求审计区块读取 `/api/admin/request-logs`，仅用于展示和排查认证/限流/客户端提示分布。

`SettingsPage` 是共享设置入口：部署文档只拥有其中服务器配置、同步摘要、服务端数据洞察、APK/服务端/前端更新这些行；轨道看板信号、导航配置等领域设置归各自主题文档。设置首页当前按「连接与同步 / 记录偏好 / 统计与健康 / 导航与界面 / 高级与更新」五组组织，`/settings/insights` 行显示为“记录偏好”但路由名保留历史兼容。设置首页的「导航」入口统一通往移动底栏与桌面侧栏配置页，具体 key 契约见 [categories-settings/settings-catalog](categories-settings/settings-catalog.md)。主入口里的服务器配置、同步摘要和更新动作消费 [design-language](design-language.md) 的 `surface/border/ink/accent/status` token，不使用独立渐变卡片或旧 Tailwind 展示色。代码入口：`packages/client/src/pages/SettingsPage.tsx`、`packages/client/src/pages/settings/SettingsAdminInsightsPage.tsx`、`packages/client/src/lib/adminApi.ts`、`packages/server/src/routes/admin.ts`

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
- [ ] 改 Android APK 发布、Capacitor、Gradle、Manifest 或移动端 HTTPS 策略：同步看 [deployment/android-apk](deployment/android-apk.md)。

## 子文档索引

| 子文档 | 拥有什么 |
|---|---|
| [deployment/android-apk](deployment/android-apk.md) | Android 签名 release APK workflow、release keystore、Capacitor / Gradle 版本、安全配置、APK 更新入口与移动端排错 |
