---
type: evergreen
title: 部署与自更新
covers:
  - docker-compose.yml
  - packages/server/Dockerfile
  - packages/server/docker-entrypoint.sh
  - packages/server/src/lib/version.ts
  - packages/server/src/lib/update.ts
  - packages/server/src/routes/version.ts
  - packages/server/src/routes/update.ts
  - packages/server/src/index.ts
  - packages/server/src/middleware/auth.ts
  - packages/server/src/middleware/cors.ts
  - packages/client/vite.config.ts
  - packages/client/src/appUpdate.tsx
  - packages/client/src/appUpdate.mobile.ts
  - packages/client/src/components/AppUpdatePrompt.tsx
  - packages/client/src/lib/frontendUpdate.ts
  - packages/client/src/lib/serverVersion.ts
  - packages/client/src/pages/SettingsPage.tsx
  - .env.example
  - .github/workflows/ci.yml
  - .github/workflows/build.yml
  - .github/workflows/secret-scan.yml
  - renovate.json5
  - .gitleaks.toml
contracts:
  - docker-compose.yml
  - packages/server/Dockerfile
  - packages/server/docker-entrypoint.sh
  - .env.example
last-reviewed: 2026-08-05
---

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
│  ./data/geoip/*.mmdb   GeoLite2 归属地库    │
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
| `AGENT_TOKEN` | 否 | 窄域 agent 鉴权。仅 `/api/agent/*` 接受，当前用于任务状态回写与任务轨道 ingest；未设置时该作用域仍可用 `AUTH_TOKEN`。生成用 `openssl rand -base64 32`，写进服务器 `.env` 后 `docker compose up -d` 重启一次即长期生效（`.env` 不随镜像更新变动，无需每次部署重配） |
| `ALLOW_UNAUTHENTICATED_DEV` | 否 | 鉴权旁路。设为 `1` 且 `AUTH_TOKEN` 缺失时，放行所有 `/api/*` 并打印一次 warning；生产不要设置。**本仓约定本地开发也不用它**（理由见 §9.1），只留给临时排查 |
| `ALLOWED_ORIGINS` | 生产必填 | CORS 允许来源白名单，逗号分隔；未配置时所有跨域 `/api/*` 请求会被拒绝（fail-closed） |
| `MAX_BODY_BYTES` | 否 | `/api/*` 请求体大小上限（字节），默认 `5242880`（5 MB）；超出返回 HTTP 413 |
| `SYNC_RATE_MAX` | 否 | `/api/sync/*` 每 60 秒最大请求次数（按 token 标识），默认 `60`；超出返回 HTTP 429 |
| `ADMIN_RATE_MAX` | 否 | `/api/admin/*` 每 60 秒最大请求次数，默认 `120`；超出返回 HTTP 429。`/api/admin/sync-logs` 的读写清空和 `/api/admin/request-logs` 的只读查询都使用该限流 |
| `UPDATE_RATE_MAX` | 否 | `POST /api/update`（自更新触发）每 60 秒最大次数，默认 `6` |
| `DB_PATH` | 否 | 容器内 SQLite 路径，默认 `/app/data/timedata.db` |
| `GEOIP_DIR` | 否 | GeoLite2 mmdb（City + ASN）所在目录，默认 `/app/data/geoip`。两个库都缺时归属地降级为「位置未知」、陌生来源按网段收敛；单缺一个只半降级（缺 City：有运营商无地名，收敛按 ASN；缺 ASN：有地名无运营商，收敛按网段），服务在任何一种情况下照常工作。两库读进内存常驻，全就绪约多占 70 MB RSS。语义见 [security](security.md#security-new-ip-alert) |
| `PORT` | 否 | 监听端口，默认 3000 |
| `UPDATE_REPO` | 否 | 查最新版本的 GitHub 仓库，默认 `HaiouZh/TimeData` |
| `GITHUB_TOKEN` | 否 | 提高 GitHub API 限额（匿名 60 次/小时，带 token 5000） |
| `WATCHTOWER_URL` | 否 | Watchtower HTTP API 地址，默认由 compose 注入 `http://watchtower:8080` |
| `WATCHTOWER_TOKEN` | 生产必填 | Watchtower HTTP API token；`/api/update` 用它触发内部 Watchtower 更新。缺失时 `/api/update` 返回 503 `SELF_UPDATE_DISABLED` |
| `TIMEDATA_IMAGE_TAG` | 否 | TimeData 镜像 tag，默认 `latest`，可 pin 到指定版本；生产环境建议在 `.env` 中固定为已验证的提交 tag，例如 `TIMEDATA_IMAGE_TAG=sha-abcdef1` |
| `UPDATE_STATE_DIR` | 否 | 自更新状态文件目录，默认 `/app/data`；一般不需要配置 |
| `DIARY_VAULT_DIR` | 否 | 日记功能的 vault 目录（容器内路径）。compose 在变量未定义时注入 `/app/vault`，显式设为空时保留空值并让日记 API 返回未启用；宿主机 `${DIARY_VAULT_HOST_DIR:-./vault}` 仍挂载到 `/app/vault`。vault 内容从 PC 同步到宿主机目录由部署方自理；容器启动时会递归校正固定挂载根 `/app/vault` 为应用 UID/GID 1000 可写 |

`AUTH_TOKEN` 缺失时的 fail-closed 行为与 `ALLOW_UNAUTHENTICATED_DEV` 旁路的机制见 [security](security.md)。

日记 vault 由 entrypoint 在降权前修复所有权（机制见 [diary](diary.md)）；自动改权只接受最近存在祖先解析后仍位于 `/app/vault` 子树、且不含 `.` / `..` 路径段的配置。宿主机挂载文件系统若不支持 `chown`（启动日志出现 `[diary] warning`，保存返回 503 `diary-vault-not-writable`），需要在宿主机让挂载目录对 UID/GID 1000 可写，或按所用网络文件系统配置等效权限。

受保护业务路由包括 `/api/categories`、`/api/entries`、`/api/quick-notes`、`/api/sync/*`、`/api/export`、`/api/update`、`/api/data/*` 和 `/api/admin/*`；只有 `/api/health` 与 `/api/version` 在 auth middleware 前注册。`/api/agent/*` 在全局 auth 前单独挂 scoped auth，接受 `AUTH_TOKEN` 或 `AGENT_TOKEN`，但只暴露封闭的 agent 动作集合。

`ALLOWED_ORIGINS` 由 `packages/server/src/middleware/cors.ts` 解析，`packages/server/src/index.ts` 在 `/api/*` CORS 中间件里使用。未配置时解析为**空数组**，所有跨域 `/api/*` 请求都会被拒绝；生产部署必须显式填写 Web 前端域名，例如 `ALLOWED_ORIGINS=https://timedata.example.com`。多域名用逗号分隔，例如 `ALLOWED_ORIGINS=https://timedata.example.com,https://timedata-staging.example.com`。Android/Capacitor 壳（`androidScheme: "https"`）的 origin 是 `https://localhost`，必须显式加入白名单；兼容旧 scheme 时一并加 `capacitor://localhost`。保留 `ALLOWED_ORIGINS=*` 可以通配来源，但 `*` 配合 `credentials: true` 等于反射任意来源请求，server 启动期会打印 WARN，不推荐用于生产环境。

Android `resume` 同步的原生通道（`/api/sync/status` 与增量 `/api/sync/pull`）与其余 WebView 通道的划分、`https://localhost` 必须留在 `ALLOWED_ORIGINS` 的规则见 [deployment/android-apk](deployment/android-apk.md)；原生通道仍使用 Bearer/TOTP 鉴权与 HTTPS，客户端不启用全局 `CapacitorHttp` fetch/XHR patch，避免改变 SSE 的流式与取消语义。

服务端 CORS 允许的请求头由 `packages/server/src/middleware/cors.ts` 的 `ALLOWED_REQUEST_HEADERS` 单点定义，`index.ts` 的 CORS 中间件直接消费：`Content-Type`、`Authorization`、`X-Confirm`、`X-TimeData-Client`、`X-TimeData-Client-Build`、`X-TOTP-Code`。`X-Confirm` 供 `/api/admin/sync-logs` 清空确认使用，`X-TimeData-Client` 供请求审计记录 client hint，`X-TimeData-Client-Build` 是 `apiFetch` 给每个请求带的构建观测头（见 [`sync`](sync.md#sync-row-granularity)），`X-TOTP-Code` 供危险操作补码重试。**客户端新增任何跨域自定义 header 必须同步这份白名单**——漏掉会让 Capacitor 壳的每个请求预检失败，而同源网页版毫无感知。`cors.test.ts` 有一条跨包闸机检 `client/src/lib/api.ts` 里 `headers.set` 的 `X-` 头是否都在白名单内。

CORS 中间件的完整配置由 `cors.ts` 的 `corsOptions()` 单点构造，`index.ts` 只做 `cors(corsOptions(allowedOrigins))` 接线。其中 `maxAge` 取 `CORS_PREFLIGHT_MAX_AGE_SECONDS`（86400 秒 = 1 天）：仍走 WebView 的 Capacitor 请求带 `Authorization`，属于非简单请求、必须预检，而不发 `Access-Control-Max-Age` 时 Chromium/WebView 只缓存 5 秒，于是这些安卓 API 调用实际是两个整往返；Android resume 的原生 status/增量 pull 不经过该浏览器预检。移动网络上预检翻倍很贵——生产取证：一次冷启动里客户端测得 status 阶段 5311ms，同一请求服务端只花了 5ms。同源网页版不走预检，所以这个开销在电脑上复现不出来。

**部署陷阱**：`docker-compose.yml` 的 `environment:` 块**必须**显式列出 `- ALLOWED_ORIGINS=${ALLOWED_ORIGINS:-}`，否则就算 `.env` 写了值，变量也进不到容器里。Web 前端走同源不触发 CORS，所以这种漏配通常要等到 Android App 第一次跨域请求 `/api/sync/status` 才会暴露，表现为 App 内提示"网络请求失败：无法连接 https://&lt;your-host&gt;/api/sync/status"。

**自部署排错**：当 Android App 报上述错误而 PC 浏览器访问正常时，原因只有两类，都在同一个预检响应里能看出来——发一次带安卓 origin 的 OPTIONS 预检即可同时验两项：

```bash
curl -sS -i -X OPTIONS https://<your-host>/api/health \
  -H "Origin: https://localhost" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: content-type,authorization,x-timedata-client-build"
```

1. **origin 未放行**：响应缺 `access-control-allow-origin: https://localhost`。多是 `.env` 漏了 `https://localhost`，或 `docker-compose.yml` 漏了 `- ALLOWED_ORIGINS=${ALLOWED_ORIGINS:-}` 那一行。修改后 `docker compose up -d` 重建容器（不需要 `down`），用 `docker compose exec timedata sh -c 'echo $ALLOWED_ORIGINS'` 确认变量已注入。
2. **自定义请求头未放行**：`access-control-allow-headers` 缺客户端实际发送的某个 `X-` 头。这是纯代码问题，与部署配置无关，改 `ALLOWED_REQUEST_HEADERS` 后需重新发版。曾踩过：client 加了 `X-TimeData-Client-Build` 但白名单没同步，安卓端全线断连而网页版（同源、不预检）无感。

### 2.1 GeoLite2 归属地库（可选，但装了才有国外地址）

陌生来源提醒与请求日志的归属地来自两个离线库，**不进镜像**（否则每次部署多传约 70MB：City ≈ 60MB + ASN ≈ 9MB），走现有 `./data` 挂载卷：

1. 在 maxmind.com 注册免费账号，生成 license key。
2. 下载 `GeoLite2-City.mmdb` 与 `GeoLite2-ASN.mmdb`。
3. 放到宿主机 `/opt/timedata/data/geoip/`（容器内即 `/app/data/geoip`）。
4. `docker compose restart timedata`——reader 在首次查询时加载并缓存结果，放库后必须重启才生效。

`docker-compose.yml` 无需改动。**顺序不敏感**：新版本可以先上、库后传，中间那段跑降级模式。

GeoLite2 许可要求不长期使用过期数据；更新方式就是换这两个文件后重启（ASN 与城市段变动缓慢，半年一次即可）。

**自动更新（可选）**：`docker-compose.yml` 带一个 profile 为 `geoip` 的 `geoipupdate` 容器（`ghcr.io/maxmind/geoipupdate`），每月拉取新版 GeoLite2 落盘到 `./data/geoip`。启用方式：`.env` 里填 `COMPOSE_PROFILES=geoip`、`GEOIPUPDATE_ACCOUNT_ID`、`GEOIPUPDATE_LICENSE_KEY` 三个变量（账号在 maxmind.com 注册免费获得），然后 `docker compose up -d`。**库更新后要等 timedata 容器下次重启才生效**：`geoip.ts` 在首次归属地查询时才把 mmdb 读进内存（懒加载）、之后不重读，本仓发版频繁（Watchtower 常态重启），因此不实现热重载。未配凭据时容器报错退出、且随 `restart: unless-stopped` 不断重启——先填齐三个变量再启动。**首次部署启用 geoip profile 时，若容器启动早于 geoipupdate 首轮下载完成，库就位后需 `docker compose restart timedata` 才生效**。

**中国归属地（内置，无需配置）**：中国 IP 的省 / 市 / 运营商走随镜像发布的内置段表 `assets/china-geo.bin`（约 750KB），不依赖 MaxMind、不需要往服务器传文件。表由 `scripts/gen-china-geo.mjs` 从 ip2region 原始数据离线生成，重新生成方法见 `packages/server/assets/README.md`。中国表命中即中国（中文省市 + 运营商，ASN 号仍取自 GeoLite2-ASN）；表缺失时中国 IP 回落 GeoLite2（可能显示英文地名），不影响国外路径。

装好后的自检：打开设置 →「服务端数据洞察」，看页面顶部有没有归属地库提示条。**没有提示条**即三个数据源都读到了（告警卡与日志行会显示地名加运营商，如「江苏省 南京市」+「中国移动」）。提示条会写明缺的是哪个库/表，据此检查路径与文件名大小写。缺库时的降级形态与就绪判定见 [security](security.md)，不要用「有没有显示位置未知」判断库是否读到。

**首次装库或换库会触发一次性重报**：库就绪前按 `net:` 档确认过的范围成为死数据，同一批来源会按新算出的 `asn:` 档键各报一次新来源。反向（把库撤掉）同理。这是收敛键变了的预期结果，不是漏报也不是故障。

## 3. 镜像与发布流程

```
git push main
  → GitHub Actions（.github/workflows/）
  → docker buildx 构建多架构镜像
  → push 到 ghcr.io/haiouzh/timedata:latest（带 GIT_SHA tag）
```

Dockerfile 构建镜像时临时安装构建工具（python3、make、g++），从源码重建 better-sqlite3 的原生 `.node` 绑定，验证产物存在后立即卸载构建工具。这是因为 pnpm install 在 Alpine 上拉取的预编译二进制可能与容器 musl libc 不兼容，需要针对当前容器环境从源码编译。运行时阶段不安装 Python：服务端没有 Python 子进程，镜像不含 Python 运行时依赖。pnpm 版本统一从根 `packageManager` 读取（见 [development](development.md)）。相关代码入口：`packages/server/Dockerfile`。

具体 workflow yaml 文件名和构建参数详见 `.github/workflows/`。其中：

- `ci.yml`：push / PR 的基础 CI，`pnpm/action-setup` 从根 `packageManager` 读取 pnpm 11 版本并安装依赖后，先运行 `pnpm audit --audit-level=high --prod`，生产依赖存在 high/critical advisory 时直接阻断；随后按 `pnpm lint` → 四道静态闸（`check:ui`、`check:design`、`check:test`、`check:diary`，**都排在 typecheck 之前**，让廉价的闸先失败）→ `pnpm -r typecheck` → 测试 → evergreen 文档四道检查 → `pnpm build` 的顺序跑，不发布产物。**测试分两个 job**：主 job 跑 `pnpm -r --parallel --filter '!@timedata/client' test`（非 client 包）、`pnpm test:scripts` 与 client e2e；client 单测由独立的 `client-unit` 矩阵 job 用 `--shard=i/4` 切四片并行（`fail-fast: false`，一眼定位是哪片挂）。文档一致性检查只在 `pull_request` 事件下运行（main 的 push 不重跑，因为同样的 diff 在 PR 阶段已经查过），按发起人区分：依赖 bot（`dependabot[bot]` / `renovate[bot]`）触发的 PR 走 `pnpm check:docs`（warn，不阻塞），其余走 `pnpm check:docs:strict`。体量棘轮不依赖 PR diff，push 和 PR 都会跑，要求 `scripts/evergreen-size-baseline.json` 覆盖当前所有 evergreen 文档，且字符数 / `covers:` 不超过基线。`ci.yml` 配有 `concurrency`（按 ref 取消被顶掉的旧跑批）。
- `build.yml`：main 分支发布镜像到 GHCR，自更新机制读取它的成功运行记录。
- `mobile-release.yml`：一条 workflow 出 Android + iOS + Windows 三包，版本号与 latest 契约细节见子文档 [deployment/android-apk](deployment/android-apk.md)、[deployment/ios-ipa](deployment/ios-ipa.md) 与 [deployment/windows-desktop](deployment/windows-desktop.md)；`pnpm/action-setup`（v6，自身运行在 Node 24）必须先于 `actions/setup-node`，因为 setup-node v5 的 pnpm 缓存逻辑会在步骤执行时查找 `pnpm`。
- `secret-scan.yml`：push main / PR 上用 gitleaks 扫全历史找泄漏的密钥；误报白名单维护在根目录 `.gitleaks.toml`（`regexTarget = "match"`）。

依赖升级由 Renovate 承担（配置在根目录 `renovate.json5`，需在 GitHub 安装 Renovate App），替代原 dependabot：原生支持 `pnpm-workspace.yaml` 的 catalog，`rangeStrategy: bump` 保证 spec 与 lockfile 同步（否则 `--frozen-lockfile` 拒绝），`minimumReleaseAge: 7 days` 与 pnpm 11 供应链发布龄闸对齐；Capacitor major 被禁用，升级需人工评估。

## 4. 版本检查（`/api/version`）

逻辑（`packages/server/src/lib/version.ts`）：

1. 当前版本 = `process.env.GIT_SHA`（运行时环境变量），取前 7 位。`dev` 表示开发模式。
2. 最新版本 = 调 GitHub API 查 `actions/workflows/build.yml/runs?status=success&branch=main&per_page=1`，取最新成功 run 的 `head_sha` 前 7 位。
3. `hasUpdate = current !== 'dev' && latest !== 'unknown' && current !== latest`。
4. 服务端结果缓存 30 秒（`CACHE_TTL_MS`）；设置页点「服务端更新」会先重查版本再判断，避免页面旧状态误判。

返回：

```ts
{ current, latest, hasUpdate, checkedAt, checkOk }
```

`checkOk` 是 `latest !== "unknown"`——GitHub 查询失败时它为 `false`，设置页据此区分「已是最新」与「没查到」，不把查询失败显示成无更新。

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

   **残留锁会自愈，不需要人工删**。自更新会换掉容器本身，持锁进程往往在释放锁之前就被 Watchtower 杀掉，所以「锁还在」是这条链路的正常中间态而非故障：超过 `STALE_LOCK_TTL_MS`（15 分钟）的锁被判定为中断残留，下一次 `acquireUpdateLock` 直接接管重建；服务启动时 `reconcileInterruptedUpdate` 还会按 `fromSha` 与当前 sha 比对，把上一次的结果补写成 `succeeded` / `failed` / `unknown` 并释放锁。
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

如果 `POST /api/update` 返回 `409 Conflict`，说明已有更新锁；不要手动重复触发——过期锁会被下一次请求自动接管（见上）。手删 `data/update.lock` 只在这两条自愈路径都没生效时才考虑，且要先确认 `update.log` 显示流程已结束、没有正在重启的容器。

## 6. 静态前端服务

服务端的 `app.use("/*", serveStatic({ root: "./public" }))` 把 `public/` 目录暴露成静态资源，其中：

- `/index.html` 是客户端入口
- `*.js` / `*.css` 是 Vite 打包产物
- 所有未匹配 API 的路径 fallback 到 `index.html`（SPA 路由）
- 设置页的 `/settings/admin-insights` 是服务端数据洞察入口，只读、受 `AUTH_TOKEN` 保护，端点与打开方式见 [admin](admin.md)。

`SettingsPage` 是共享设置入口：部署文档只拥有其中服务器配置、同步摘要、服务端数据洞察、APK/服务端/前端更新这些行；轨道看板信号、导航配置等领域设置归各自主题文档。设置首页顶部先渲染 `ServerStatusCard`（不属任何分组），其下按「记录偏好 / 统计 / 导航与界面 / 高级与更新」四个 `SettingsSection` 组织；`/settings/insights` 行显示为“记录偏好”但路由名保留历史兼容；具体 key 契约见 [categories-settings/settings-catalog](categories-settings/settings-catalog.md)。代码入口：`packages/client/src/pages/SettingsPage.tsx`、`packages/client/src/pages/settings/SettingsAdminInsightsPage.tsx`、`packages/client/src/lib/adminApi.ts`、`packages/server/src/routes/admin/`

相关测试：`packages/client/src/pages/SettingsPage.test.tsx`；管理洞察相关测试见 [admin](admin.md)。

`public/` 里的内容来自 Dockerfile：构建时把 `packages/client/dist/*` 拷过来。所以**部署一次同时更新前端和后端**。

Web PWA 的 Workbox 缓存边界（只预缓存静态资源、`/api/**` 走 `NetworkOnly`）见 [security](security.md)；相关入口是 `packages/client/vite.config.ts` 的 `createPwaOptions()`，测试在 `packages/client/src/lib/pwaConfig.test.ts`。

Web/PWA 构建通过 Vite `define` 注入 `__TIMEDATA_BUILD_ID__` 并输出 `version.json`，客户端据此做网络版本比对与硬刷新，机制见 [development](development.md)。Android mobile 构建不注册 PWA service worker，这套网页前端刷新机制对 APK 壳无副作用。

## 7. 反向代理（HTTPS）

推荐 Caddy 一行：

```caddyfile
timedata.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

客户端设置页填 `https://timedata.example.com`（不要带 `/api`）。**API 地址只填域名根**，因为客户端会自动拼 `/api/...`。

生产实际链路：`客户端 → Cloudflare（橙云，h2/h3 已启用）→ 源站 nginx 1.24（h2）→ 127.0.0.1:3000`。源站 nginx 要点（`/etc/nginx/nginx.conf`，2026-07-23 起）：`gzip_types` 含 `application/json`（Ubuntu 默认只压 text/html，JSON 载荷跨太平洋回源必须压）、`gzip_vary on`、`gzip_proxied any`。SSE 反缓冲不靠 nginx 配置——服务端 `/api/sync/stream` 响应自带 `X-Accel-Buffering: no`（见 [sync/realtime-and-scheduler](sync/realtime-and-scheduler.md)）。nginx 1.24 的 `http2` 是 443 端口级开关，该机多站共用同一 listen 行——改它会连带影响同机其他站点。

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
├── geoip/                   GeoLite2 归属地库（可选，非用户数据）
│   ├── GeoLite2-City.mmdb
│   └── GeoLite2-ASN.mmdb
├── update.log               自更新日志
└── update-status.json       自更新状态
```

**用户运维必读**：

- `data/` 目录是所有用户数据所在，定期 host 侧备份。
- 升级前备份这整个目录最稳。唯一例外是 `geoip/`：约 70 MB 的第三方库文件，可从 maxmind 重新下载（见 §2.1），不是用户数据，备份时可以排除。
- `backups/` 是服务端自动生成的，保留与清理策略见 [`backup.md` 第 6 节](./backup.md#backup-server-write-path)。

## 9. 本地开发环境（不走 Docker）

本地跑的是两个进程（`pnpm dev:server` + `pnpm dev:client`，端口与 `/api` 代理见 [development](development.md)）。与容器部署的差别只有两处：**环境变量怎么进去**、**vault 根目录是宿主机绝对路径而非 `/app/vault`**。

### 9.1 环境变量必须在启动命令里给，且一律带鉴权

**本仓没有装 dotenv，dev 脚本也没有 `--env-file`**，所以写进 `.env` 文件不生效（`.env.example` 是给 Docker Compose 用的）。变量只能在启动服务的那条命令里设，换个终端就没了。

PowerShell：

```
$env:AUTH_TOKEN='devtoken'; $env:DIARY_VAULT_DIR='D:\OneDrive\Obsidian\Time'; pnpm dev:server
```

然后去 `/settings/server` 把同一个串填进「API Token」——前端存 localStorage、`apiFetch` 据此拼 `Authorization: Bearer`（机制见 [security](security.md)）。**这一步不做，前端所有请求都会 401**。

**本仓约定：本地开发也必须带 `AUTH_TOKEN`，不用 `ALLOW_UNAUTHENTICATED_DEV=1` 旁路。** 旁路虽然存在（不设 `AUTH_TOKEN` 时 `/api/*` 直接返回 500 `Server misconfigured: AUTH_TOKEN not set`，**故意 fail-closed**，见 `middleware/auth.ts`；加上旁路变量才放行，并打一行 `[auth] AUTH_TOKEN unset — all /api/* endpoints are open`），但它让**鉴权中间件、token 分级、401 分支全部走不到**——旁路下验过的东西不构成"能用"的证据，上生产可能照样挂。旁路只留给"确认某个问题与鉴权无关"这类临时排查，用完即走。

### 9.2 日记 vault：宿主机绝对路径

| | vault 根 |
|---|---|
| 本地开发 | 宿主机绝对路径，如 `D:\OneDrive\Obsidian\Time`（Windows 下正反斜杠都行，`path.resolve` 会归一） |
| 容器 | 恒为 `/app/vault`，宿主机目录靠 `DIARY_VAULT_HOST_DIR` 挂进去 |

**路径模板两边完全一样**——模板存 `server_config` 表、语法校验（只认 `{yyyy}` / `{MM}` / `{dd}`、拒绝反斜杠/绝对路径/盘符/`..`）见 [diary](diary.md)。所以模板填一次就能跨环境复用，这是有意为之。

例：vault 根 `D:\OneDrive\Obsidian\Time`、模板 `日记_{yyyy}/Day/{yyyy}年{MM}月/{yyyy}-{MM}-{dd}.md` → `2026-07-24` 解析为 `D:\OneDrive\Obsidian\Time\日记_2026\Day\2026年07月\2026-07-24.md`，跨月跨年自动跟随。缺失的目录在保存时由 `mkdirSync(recursive)` 自动创建。

### 9.3 配错了会卡在哪

四道闸各有明确响应，照报错定位即可：

| 现象 | 原因 |
|---|---|
| 500 `Server misconfigured: AUTH_TOKEN not set` | 见 §9.1，旁路或 token 都没给 |
| 设置页显示「未启用」（`/config` 返回 `enabled:false`） | `DIARY_VAULT_DIR` 没进到服务进程（多半是在另一个终端启的服务） |
| 409 `diary-no-template` | 模板还没存 |
| 400 带具体原因 | 模板语法违规（反斜杠 / 绝对路径 / `..` / 未知占位符） |
| 400 `路径越出 vault 目录` | 模板展开后跑到 vault 之外 |

**没有报错但读不到内容**是最容易误判的一种：模板本身合法、只是指错了地方，此时 `GET /:date` 把「文件不存在」当正常情况返回 `{content:"", mtime:null}`，正文区预填一条空列表项、看起来像空白。**验证方法是读一个已经存在的历史日期**——读得出正文说明 vault 根、模板、日期口径三者全对；这一步不写盘，配错也不会在 vault 里留下垃圾文件。

> 用命令行 `curl` 灌含中文的模板时注意：Windows 终端的 GBK 编码会把中文打成替换字符，存进去是合法但错误的模板，表现正是上面这种「不报错、读不到」。把 JSON 写成 UTF-8 文件再 `--data-binary @file`，或者干脆在浏览器设置页里填。

## 10. 改部署相关代码前的清单

- [ ] 跑 `packages/server/src/lib/version.test.ts`、`update.test.ts`：用 mock 测过版本查询和 Watchtower 更新触发流程。
- [ ] 改 `WATCHTOWER_URL`、`WATCHTOWER_TOKEN` 或 Watchtower compose 参数：确认 Watchtower 不暴露 host 端口，且只更新带 `com.centurylinklabs.watchtower.enable=true` label 的容器。
- [ ] 改 `serveStatic` 的 root：影响生产 Dockerfile 的拷贝路径，需要同步改。
- [ ] 改自更新流程：要在 staging 完整跑一次“拉镜像后服务能正常重启 + 接续提供服务”。
- [ ] 改 `/api/version` 缓存 TTL：太短会打 GitHub API 限额，太长用户看不到新版本。
- [ ] 改 Android APK 发布、Capacitor、Gradle、Manifest 或移动端 HTTPS 策略：同步看 [deployment/android-apk](deployment/android-apk.md)。
- [ ] 改 iOS 发布或 Release 发布步骤：确认 iOS Release 仍不带 `--latest`，见 [deployment/ios-ipa](deployment/ios-ipa.md)。

## 子文档索引

| 子文档 | 拥有什么 |
|---|---|
| [deployment/android-apk](deployment/android-apk.md) | Android 签名 release APK workflow、release keystore、Capacitor / Gradle 版本、安全配置、APK 更新入口与移动端排错 |
| [deployment/ios-ipa](deployment/ios-ipa.md) | iOS 未签名 IPA workflow、CI 现场生成原生工程、键盘工具条与状态栏补丁、不标 latest 的 Release 契约、SideStore 装机与数据边界 |
| [deployment/windows-desktop](deployment/windows-desktop.md) | Tauri 壳构成、托盘与关窗语义、开机自启判定、全局热键与热键打点、NSIS 安装包发布链路与版本码 semver 转换、桌面壳数据边界 |
