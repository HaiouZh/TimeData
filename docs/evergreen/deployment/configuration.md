---
type: evergreen
title: 部署 · 配置与环境变量
covers:
contracts:
  - .env.example
  - docker-compose.yml
  - packages/server/src/middleware/cors.ts
last-reviewed: 2026-08-10
---

# 部署 · 配置与环境变量

> [deployment](../deployment.md) 的**配置子文档**：部署一台服务器时要填什么、CORS 怎么放行、归属地库怎么装。
> 讲什么：环境变量表与默认值、CORS 白名单与壳 origin 内置放行、自定义请求头白名单、预检缓存、GeoLite2 与中国段表的安装与降级形态。
> 不讲什么：运行时拓扑与镜像发布流程、自更新、反向代理与数据卷（都在 [母文档](../deployment.md)）、鉴权与限流的安全语义（见 [security](../security.md)）。

## 承上启下

- **上游**：[母文档](../deployment.md) §1 的运行时拓扑（容器、挂载卷、Watchtower）。
- **下游**：部署者的 `.env` 与 `docker-compose.yml`；三个壳（Android / iOS / 桌面）能不能连上服务端由本文的 CORS 段决定。
- **契约**：变量定义的单一来源是 `.env.example`；CORS 的 origin 集合、请求头白名单与预检缓存全部由 `cors.ts` 单点构造；限流与体积上限的**数值**以本文的环境变量表为单一来源。
- **邻居**：[母文档](../deployment.md)、[security](../security.md)（鉴权与限流语义）、[deployment/android-apk](android-apk.md)（Android 原生通道与 CORS 的关系）。

## 1. 关键环境变量

定义见 `.env.example`，**重点变量**：

| 变量 | 必填 | 用途 |
|---|---|---|
| `AUTH_TOKEN` | 生产必填 | API 鉴权。所有 `/api/*` 请求都要带 `Authorization: Bearer <TOKEN>`，除了 `/api/health` 和 `/api/version` |
| `AGENT_TOKEN` | 否 | 窄域 agent 鉴权。仅 `/api/agent/*` 接受，当前用于任务状态回写与任务轨道 ingest；未设置时该作用域仍可用 `AUTH_TOKEN`。生成用 `openssl rand -base64 32`，写进服务器 `.env` 后 `docker compose up -d` 重启一次即长期生效（`.env` 不随镜像更新变动，无需每次部署重配） |
| `ALLOW_UNAUTHENTICATED_DEV` | 否 | 鉴权旁路。设为 `1` 且 `AUTH_TOKEN` 缺失时，放行所有 `/api/*` 并打印一次 warning；生产不要设置。**本仓约定本地开发也不用它**（理由见 [母文档](../deployment.md) §9.1），只留给临时排查 |
| `ALLOWED_ORIGINS` | 网页版必填 | **网页域名**的 CORS 白名单，逗号分隔；壳（手机/桌面）的 origin 由代码内置放行，未配置时其余跨域 `/api/*` 一律拒绝（fail-closed） |
| `MAX_BODY_BYTES` | 否 | `/api/*` 请求体大小上限（字节），默认 `5242880`（5 MB）；超出返回 HTTP 413 |
| `SYNC_RATE_MAX` | 否 | `/api/sync/*` 每 60 秒最大请求次数（按 token 标识），默认 `60`；超出返回 HTTP 429 |
| `ADMIN_RATE_MAX` | 否 | `/api/admin/*` 每 60 秒最大请求次数，默认 `120`；超出返回 HTTP 429。`/api/admin/sync-logs` 的读写清空和 `/api/admin/request-logs` 的只读查询都使用该限流 |
| `UPDATE_RATE_MAX` | 否 | `POST /api/update`（自更新触发）每 60 秒最大次数，默认 `6` |
| `DB_PATH` | 否 | 容器内 SQLite 路径，默认 `/app/data/timedata.db` |
| `GEOIP_DIR` | 否 | GeoLite2 mmdb（City + ASN）所在目录，默认 `/app/data/geoip`。两个库都缺时归属地降级为「位置未知」、陌生来源按网段收敛；单缺一个只半降级（缺 City：有运营商无地名，收敛按 ASN；缺 ASN：有地名无运营商，收敛按网段），服务在任何一种情况下照常工作。语义见 [security](../security.md#security-new-ip-alert) |
| `PORT` | 否 | 监听端口，默认 3000 |
| `UPDATE_REPO` | 否 | 查最新版本的 GitHub 仓库，默认 `HaiouZh/TimeData` |
| `GITHUB_TOKEN` | 否 | 提高 GitHub API 限额（匿名 60 次/小时，带 token 5000） |
| `WATCHTOWER_URL` | 否 | Watchtower HTTP API 地址，默认由 compose 注入 `http://watchtower:8080` |
| `WATCHTOWER_TOKEN` | 生产必填 | Watchtower HTTP API token；`/api/update` 用它触发内部 Watchtower 更新。缺失时 `/api/update` 返回 503 `SELF_UPDATE_DISABLED` |
| `TIMEDATA_IMAGE_TAG` | 否 | TimeData 镜像 tag，默认 `latest`，可 pin 到指定版本；生产环境建议在 `.env` 中固定为已验证的提交 tag，例如 `TIMEDATA_IMAGE_TAG=sha-abcdef1` |
| `UPDATE_STATE_DIR` | 否 | 自更新状态文件目录，默认 `/app/data`；一般不需要配置 |
| `DIARY_VAULT_DIR` | 否 | 日记功能的 vault 目录（容器内路径）。compose 在变量未定义时注入 `/app/vault`，显式设为空时保留空值并让日记 API 返回未启用；宿主机 `${DIARY_VAULT_HOST_DIR:-./vault}` 仍挂载到 `/app/vault`。vault 内容从 PC 同步到宿主机目录由部署方自理；容器启动时会递归校正固定挂载根 `/app/vault` 为应用 UID/GID 1000 可写 |

两个 GeoLite2 库读进内存常驻，全就绪约多占 70 MB RSS。

`AUTH_TOKEN` 缺失时的 fail-closed 行为与 `ALLOW_UNAUTHENTICATED_DEV` 旁路的机制见 [security](../security.md)。

日记 vault 由 entrypoint 在降权前修复所有权（机制见 [diary](../diary.md)）；自动改权只接受最近存在祖先解析后仍位于 `/app/vault` 子树、且不含 `.` / `..` 路径段的配置。宿主机挂载文件系统若不支持 `chown`（启动日志出现 `[diary] warning`，保存返回 503 `diary-vault-not-writable`），需要在宿主机让挂载目录对 UID/GID 1000 可写，或按所用网络文件系统配置等效权限。

**除 `/api/health` 与 `/api/version` 外的全部 `/api/*` 都在 auth middleware 之后注册**，即默认受保护，这两条是仅有的例外（注册顺序见 `packages/server/src/index.ts`）。`/api/agent/*` 在全局 auth 前单独挂 scoped auth，接受 `AUTH_TOKEN` 或 `AGENT_TOKEN`，但只暴露封闭的 agent 动作集合。

`ALLOWED_ORIGINS` 由 `packages/server/src/middleware/cors.ts` 解析，`packages/server/src/index.ts` 在 `/api/*` CORS 中间件里使用。它**只用来填网页域名**，例如 `ALLOWED_ORIGINS=https://timedata.example.com`，多域名用逗号分隔。未配置时解析为**空数组**，除下述壳 origin 外所有跨域 `/api/*` 请求都被拒绝。保留 `ALLOWED_ORIGINS=*` 可以通配来源，但 `*` 配合 `credentials: true` 等于反射任意来源请求，server 启动期会打印 WARN，不推荐用于生产环境。

三个壳的 origin——Android（`androidScheme: "https"`）的 `https://localhost`、iOS（Capacitor 默认 scheme）的 `capacitor://localhost`、桌面版（Tauri v2）的 `http://tauri.localhost` / `https://tauri.localhost` / `tauri://localhost`——由壳运行时写死、部署者无从得知，已由 `cors.ts` 的 `SHELL_ORIGINS_BY_SHELL` **内置放行**，不必也不用写进 `ALLOWED_ORIGINS`。这三条以前是必配项，三个壳各因漏配踩过一次「壳内 `/api/*` 全线被拒而同源网页版毫无异常」。决策与安全论证见 [ADR 0030](../../adr/0030-shell-origins-allowed-by-server-code.md)；`cors.test.ts` 有两条闸守它，其一要求 `packages/` 下每个新包都表态是不是壳。

Android `resume` 同步的原生通道（`/api/sync/status` 与增量 `/api/sync/pull`）与其余 WebView 通道的划分见 [deployment/android-apk](android-apk.md)；原生通道仍使用 Bearer/TOTP 鉴权与 HTTPS，客户端不启用全局 `CapacitorHttp` fetch/XHR patch，避免改变 SSE 的流式与取消语义。

服务端 CORS 允许的请求头由 `packages/server/src/middleware/cors.ts` 的 `ALLOWED_REQUEST_HEADERS` 单点定义，`index.ts` 的 CORS 中间件直接消费：`Content-Type`、`Authorization`、`X-Confirm`、`X-TimeData-Client`、`X-TimeData-Client-Build`、`X-TOTP-Code`。`X-Confirm` 供 `/api/admin/sync-logs` 清空确认使用，`X-TimeData-Client` 供请求审计记录 client hint，`X-TimeData-Client-Build` 是 `apiFetch` 给每个请求带的构建观测头（见 [`sync`](../sync.md#sync-row-granularity)），`X-TOTP-Code` 供危险操作补码重试。**客户端新增任何跨域自定义 header 必须同步这份白名单**——漏掉会让 Capacitor 壳的每个请求预检失败，而同源网页版毫无感知。`cors.test.ts` 有一条跨包闸机检 `client/src/lib/api.ts` 里 `headers.set` 的 `X-` 头是否都在白名单内。

CORS 中间件的完整配置由 `cors.ts` 的 `corsOptions()` 单点构造，`index.ts` 只做 `cors(corsOptions(allowedOrigins))` 接线。其中 `maxAge` 取 `CORS_PREFLIGHT_MAX_AGE_SECONDS`（86400 秒 = 1 天）：仍走 WebView 的 Capacitor 请求带 `Authorization`，属于非简单请求、必须预检，而不发 `Access-Control-Max-Age` 时 Chromium/WebView 只缓存 5 秒，于是这些安卓 API 调用实际是两个整往返；Android resume 的原生 status/增量 pull 不经过该浏览器预检。移动网络上预检翻倍很贵——生产取证：一次冷启动里客户端测得 status 阶段 5311ms，同一请求服务端只花了 5ms。同源网页版不走预检，所以这个开销在电脑上复现不出来。

**部署陷阱**：`docker-compose.yml` 的 `environment:` 块**必须**显式列出 `- ALLOWED_ORIGINS=${ALLOWED_ORIGINS:-}`，否则就算 `.env` 写了值，变量也进不到容器里。壳 origin 内置放行后这条漏配不再影响手机与桌面版，但把网页版部署在与 API 不同的域名上时，网页端的全部 `/api/*` 会被拒。

**自部署排错**：壳内（手机 / 桌面版）报「网络请求失败：无法连接 https://&lt;your-host&gt;/api/…」而 PC 浏览器访问正常时，发一次带该壳 origin 的 OPTIONS 预检，两类原因在同一个响应里都看得出来（手机把 `Origin` 换成 `https://localhost` 或 `capacitor://localhost`）：

```bash
curl -sS -i -X OPTIONS https://<your-host>/api/health \
  -H "Origin: http://tauri.localhost" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: content-type,authorization,x-timedata-client-build"
```

1. **origin 未放行**：响应缺 `access-control-allow-origin: <该 origin>`。壳 origin 自 [ADR 0030](../../adr/0030-shell-origins-allowed-by-server-code.md) 起内置放行，还出现这种情况说明服务端镜像早于该版本：升级镜像，或临时把该 origin 填进 `.env` 的 `ALLOWED_ORIGINS`。网页域名漏配、或 `docker-compose.yml` 漏了 `- ALLOWED_ORIGINS=${ALLOWED_ORIGINS:-}` 那行也是同一个表现。改完 `docker compose up -d` 重建容器（不需要 `down`），用 `docker compose exec timedata sh -c 'echo $ALLOWED_ORIGINS'` 确认变量已注入。
2. **自定义请求头未放行**：`access-control-allow-headers` 缺客户端实际发送的某个 `X-` 头。这是纯代码问题，与部署配置无关，改 `ALLOWED_REQUEST_HEADERS` 后需重新发版。曾踩过：client 加了 `X-TimeData-Client-Build` 但白名单没同步，安卓端全线断连而网页版（同源、不预检）无感。

## 2. GeoLite2 归属地库（可选，但装了才有国外地址）

陌生来源提醒与请求日志的归属地来自两个离线库，**不进镜像**（否则每次部署多传约 70MB：City ≈ 60MB + ASN ≈ 9MB），走现有 `./data` 挂载卷：

1. 在 maxmind.com 注册免费账号，生成 license key。
2. 下载 `GeoLite2-City.mmdb` 与 `GeoLite2-ASN.mmdb`。
3. 放到宿主机 `/opt/timedata/data/geoip/`（容器内即 `/app/data/geoip`）。
4. `docker compose restart timedata`——reader 在首次查询时加载并缓存结果，放库后必须重启才生效。

`docker-compose.yml` 无需改动。**顺序不敏感**：新版本可以先上、库后传，中间那段跑降级模式。

GeoLite2 许可要求不长期使用过期数据；更新方式就是换这两个文件后重启（ASN 与城市段变动缓慢，半年一次即可）。

**自动更新（可选）**：`docker-compose.yml` 带一个 profile 为 `geoip` 的 `geoipupdate` 容器（`ghcr.io/maxmind/geoipupdate`），每月拉取新版 GeoLite2 落盘到 `./data/geoip`。启用方式：`.env` 里填 `COMPOSE_PROFILES=geoip`、`GEOIPUPDATE_ACCOUNT_ID`、`GEOIPUPDATE_LICENSE_KEY` 三个变量（账号在 maxmind.com 注册免费获得），然后 `docker compose up -d`。**库更新后要等 timedata 容器下次重启才生效**：`geoip.ts` 在首次归属地查询时才把 mmdb 读进内存（懒加载）、之后不重读，本仓发版频繁（Watchtower 常态重启），因此不实现热重载。未配凭据时容器报错退出、且随 `restart: unless-stopped` 不断重启——先填齐三个变量再启动。**首次部署启用 geoip profile 时，若容器启动早于 geoipupdate 首轮下载完成，库就位后需 `docker compose restart timedata` 才生效**。

**中国归属地（内置，无需配置）**：中国 IP 的省 / 市 / 运营商走随镜像发布的内置段表 `assets/china-geo.bin`（约 750KB），不依赖 MaxMind、不需要往服务器传文件。表由 `scripts/gen-china-geo.mjs` 从 ip2region 原始数据离线生成，重新生成方法见 `packages/server/assets/README.md`。中国表命中即中国（中文省市 + 运营商，ASN 号仍取自 GeoLite2-ASN）；表缺失时中国 IP 回落 GeoLite2（可能显示英文地名），不影响国外路径。

装好后的自检：打开设置 →「服务端数据洞察」，看页面顶部有没有归属地库提示条。**没有提示条**即三个数据源都读到了（告警卡与日志行会显示地名加运营商，如「江苏省 南京市」+「中国移动」）。提示条会写明缺的是哪个库/表，据此检查路径与文件名大小写。缺库时的降级形态与就绪判定见 [security](../security.md)，不要用「有没有显示位置未知」判断库是否读到。

**首次装库或换库会触发一次性重报**：库就绪前按 `net:` 档确认过的范围成为死数据，同一批来源会按新算出的 `asn:` 档键各报一次新来源。反向（把库撤掉）同理。这是收敛键变了的预期结果，不是漏报也不是故障。
