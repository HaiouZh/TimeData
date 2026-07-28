---
type: evergreen
title: 安全与凭据处理
covers:
  - packages/client/src/pages/settings/SettingsServerPage.tsx
  - packages/client/src/lib/storageKeys.ts
  - packages/client/vite.config.ts
  - packages/server/src/middleware/auth.ts
  - packages/server/src/middleware/requestAudit.ts
  - packages/server/src/middleware/rateLimit.ts
  - packages/server/src/middleware/bodyLimit.ts
  - packages/server/src/lib/requestLog.ts
  - packages/server/src/lib/requestMeta.ts
  - packages/server/src/routes/sync.ts
  - packages/server/src/routes/syncLog.ts
  - packages/server/src/routes/admin/index.ts
  - packages/server/src/routes/admin/requestLogs.ts
  - packages/server/src/middleware/totp.ts
  - packages/server/src/lib/totp.ts
  - packages/server/src/lib/totpStore.ts
  - packages/server/src/lib/knownIps.ts
  - packages/server/src/routes/admin/totp.ts
  - packages/client/src/lib/totpChallenge.ts
contracts:
  - packages/server/src/middleware/auth.ts
  - packages/server/src/middleware/totp.ts
  - packages/client/src/lib/storageKeys.ts
last-reviewed: 2026-07-28
---

# 安全与凭据处理

## 客户端服务器 Token

客户端服务器设置页会把同步 API Token 保存在本机浏览器存储中，使用既有 key `timedata_api_token`。这个 key 是已存在的本地配置契约，改名需要迁移计划与兼容处理。

设置页必须明确提示用户：Token 会保存在本机浏览器存储中，只应在可信设备上保存服务器 Token。当前实现不引入 sessionStorage，也不在页面刷新后自动丢弃 Token。

`storageKeys.ts` 是全部 localStorage key 的唯一登记处（完整清单读该文件，此处不复述）。按**存了什么**分四档，安全影响各不相同：

| 档 | 内容 | 敏感度 |
|---|---|---|
| 凭据与连接 | `apiToken`（见上两段）、`apiUrl` | **敏感**：明文存本机 |
| **用户内容** | **`quickNoteComposerDraft`** —— 用户尚未发出的速记正文 | **含用户内容**：纯本地，不进同步域、不进备份 |
| 业务 id 引用 | `sleepCategoryId`（睡眠分类 id） | 引用 id，不含内容 |
| 同步游标 / 诊断 / UI 偏好 | `lastSyncedSeq`、`clockSkewMs`、`syncFailureCount`、`syncPhaseTimings`、`schemaNormalizationVersion`、各页分栏比例与折叠态、`goalsViewMode`、`galaxyEngine`（`/goals` 星图用确定性还是本地 settle 引擎）等 | 不含用户内容、不含凭据 |

`quickNoteComposerDraft` 是唯一把用户正文落到 localStorage 的 key——清本机数据、共享设备场景要按"含用户内容"对待，不能套用"UI 偏好无所谓"的判断。

待办翻牌「已过目表」在同步 `settings` key `todo.gravity.review.v1`，只保存任务 id 到 ISO 时间戳，不保存任务正文或 Token；轨道看板信号词表也走同步 `settings` 表，不放在本地 storage key 里。

`schemaNormalizationVersion`（`timedata_schema_normalization_version`）是纯本地、不同步、非敏感的版本闸，只记录客户端 schema 归一 pass 已跑到的版本号。

Android 原生环境保持 HTTPS-only：`packages/mobile/capacitor.config.ts` 的 `server.cleartext: false` / `android.allowMixedContent: false` 与 Manifest 的 `android:usesCleartextTraffic="false"` 共同禁止明文 API 请求。服务器设置页在原生环境会拒绝保存 `http://` API 地址，并提示用户改用 HTTPS 反向代理地址；Web/PWA 环境不做这层 Android 专属拦截。设置页还会提示自托管用户：服务端 `ALLOWED_ORIGINS` 必须包含 `https://localhost`，否则 Android（Capacitor `androidScheme: "https"`）的跨域请求会被 CORS fail-closed 中间件拒绝；具体配置位置和验证方法见 [部署与自更新](deployment.md) 的 `ALLOWED_ORIGINS` 段落。

## 服务端认证与审计

未设置 `AUTH_TOKEN` 时，所有受保护的普通 `/api/*` 请求默认返回 HTTP 500；`/api/health` 和 `/api/version` 仍保持公开。只有显式设置 `ALLOW_UNAUTHENTICATED_DEV=1` 时，开发环境才会放行未带 token 的 `/api/*` 请求，并且每个进程只打印一次警告。生产部署必须设置 `AUTH_TOKEN`，不再依赖 `NODE_ENV=production` 才 fail-closed。

`AGENT_TOKEN` 是可选窄域令牌，只被 `/api/agent/*` 的 `scopedAuthMiddleware` 接受。该作用域同时接受 master `AUTH_TOKEN` 和 `AGENT_TOKEN`；当前用于 `POST /api/agent/tasks/:id/status` 任务状态、备注（创建独立子任务 child `Task`）和 tags 回写，以及 `/api/agent/tracks*` 任务轨道 ingest（建轨道、append 步骤、闭合当前步、改轨道状态/元信息）。`AGENT_TOKEN` 不能访问 sync、force-push、admin、export、data reset 或 update。`AUTH_TOKEN` 与 `AGENT_TOKEN` 都缺失且未显式开发旁路时，scoped auth 同样 fail-closed。

服务端在 `/api/*` 上挂载 best-effort 请求审计中间件，写入 SQLite 运维表 `api_request_logs`。审计记录只保存 timestamp、method、去 query 的 path、HTTP status、结果分类、token tier、IP、User-Agent、`X-TimeData-Client` 归一值、粗略设备标签和耗时；不保存 body、Authorization header 或完整 query string。认证中间件只把本次请求的 `tokenTier` 放入 Hono context：公开端点为 `public`，master token 为 `master`，agent token 为 `agent`，开发旁路为 `dev_bypass`，缺失/错误 token 分别为 `missing` / `invalid`。

`GET /api/admin/request-logs` 是 master-only 只读接口，复用 admin 限流，支持按 `status`、`outcome`、`tokenTier`、`clientHint` 和 `limit` 筛选。设置页的「服务端数据洞察」会展示请求审计和权限矩阵，`AGENT_TOKEN` 不可访问该接口。IP 只用于展示和人工排查；如果反向代理没有先清洗 `X-Forwarded-For` / `X-Real-IP`，审计里的 IP 不能作为安全裁判。

`GET /api/sync/stream` 是受保护的只读 SSE 通道，也挂在同一 `/api/*` Bearer 鉴权之后。客户端不用原生 `EventSource`，而是通过 fetch 读取 `ReadableStream`，因此 token 仍放在 `Authorization` header 中，不会进入 URL、反向代理访问日志或浏览器地址栏。流内容只包含 `hello` / `bump` 的 `latestSeq` 游标和注释心跳，不包含时间记录、速记文本、分类名称或设置值。

## 速率限制与请求体上限

鉴权之外还有两层中间件保护服务端：

- **速率限制**（`middleware/rateLimit.ts`）：按 token 标识对 `/api/sync/*` 与 `/api/admin/*` 分别限流，60 秒滑窗，超限返回 HTTP 429；`/api/admin/sync-logs` 与 `/api/admin/request-logs` 复用 admin 限流。
- **请求体上限**（`middleware/bodyLimit.ts`）：`/api/*` 请求体超限返回 HTTP 413；`Content-Length` 超限快速拒绝，无/未知长度的 body 先读取计数再判定。

窗口次数与上限字节由 `SYNC_RATE_MAX` / `ADMIN_RATE_MAX` / `MAX_BODY_BYTES` 调整，**默认值与完整说明见 [deployment](deployment.md) 环境变量表（数值单一来源）**。多实例部署时限流计数当前是单进程内存结构。

## force-push 临时 Token

`/api/sync/force-push/prepare` 发放 5 分钟有效的内存确认 token。`/api/sync/force-push` 会先用 shared runtime schema 校验核心同步表请求形状（categories、timeEntries、quickNotes、tasks，以及可选 settings；quickNotes 可携带 `source` / `sourceLabel` 展示元数据和 `pinned` 置顶状态；tasks 不携带目标归属字段），畸形 JSON 或字段类型错误直接返回 `invalid_request`，不会进入确认 token 消费；健康原始数据、`health_charts`、任务轨道、`goals` 与 `goal_layout_pins` 当前不在 force-push 请求范围内。确认覆盖只把五个覆盖域的快照转成差异应用，非覆盖域业务行、tombstone 与 seq 保持原样；这不引入新的请求字段或权限。请求形状合法后才校验确认短语和一次性 token：成功消费后立即失效，过期、缺失或复用都会被拒绝。

服务端会把 force-push token 的 prepare、过期拒绝、普通拒绝和最终应用写入 `sync_logs`，用于追踪高风险覆盖操作。最终应用经正常 resolver 追加只增 `sync_seq` 并让 `sync_state` commit hash 失效待重算，但不会把确认 token 或请求 token 写入状态摘要。当前 token store 仍是单进程内存结构，多实例部署前必须迁移到 SQLite 或外部存储。

## 同步日志管理接口

`/api/admin/sync-logs` 复用 admin 限流，支持读取、写入和清空服务端 `sync_logs`。写入请求会用 Zod 校验单条或最多 100 条批量日志；读取的 `limit` 会限制在 1-500；清空日志必须显式发送 `X-Confirm: true` 头，否则返回 412。

`/api/admin/request-logs` 复用同一 admin 保护面，只读查询 `api_request_logs`，用于排查认证失败、限流和 client hint 分布。它不提供清空端点；服务端通过保留窗口和最大行数做自动裁剪。

`/api/admin/backups/*` 与 `/api/admin/backup-config` 同样只在 admin/master token 下可用。备份列表是读操作；备份删除、日备触发和备份配置修改是明确的管理写操作。删除端点只接受 manifest id 或备份目录内已存在的 `.db` basename，最终路径必须解析在 `getBackupDir()` 之下，拒绝带 `/`、`\`、`..` 的路径参数，避免 URL 解码后的 id 逃逸备份目录。

## TOTP 危险操作锁

绑定 TOTP(RFC 6238,Google Authenticator 兼容)后,以下操作必须携带 `X-TOTP-Code` 头(当期 6 位码或 `xxxx-xxxx` 恢复码):`GET /api/export`、`/api/data/*` 重置、`POST /api/sync/force-push/prepare`、`DELETE /api/admin/backups/:id`、备份配置写入。判断标准:一次性带走大量隐私 / 改变防线本身 / 不可逆毁数据。`/api/update` 刻意不锁——它只能触发 Watchtower 拉服务端环境变量定死的镜像源,滥用上限是骚扰性重启,已有限流覆盖。缺码返回 401 `totp_required`,错码 401 `totp_invalid`;**未绑定时全部放行**(渐进启用)。

绑定走 `/api/admin/totp`(master-only):`setup` 生成密钥与 10 个一次性恢复码(只下发这一次,恢复码只存 sha256 哈希),`confirm` 验码落库,`disable` 需当期码或恢复码。密钥存服务端 SQLite `totp_config` 单行表。

防锁死三层:①绑定时同一二维码扫进至少两处(手机验证器 + 电脑验证器/密码管理器);②恢复码存入密码管理器;③**服务器逃生舱**——SSH 登服务器后对业务库执行 `DELETE FROM totp_config; DELETE FROM totp_recovery_codes;` 并重启容器,即回到未绑定语义可重新绑定。攻击者只持有 API token 上不了服务器,此通道仅属于运维者。

密钥纪律(零代码防线):master `AUTH_TOKEN` 只存自己设备的客户端,绝不进对话记录、脚本配置或公开平台;一切 agent/脚本场合只用窄域 `AGENT_TOKEN`。

## 陌生 IP 提醒

`known_ips` 表按 token tier(master/agent/dev_bypass)隔离记录见过的来源 IP;请求审计写入时同步判定,首见 IP 的日志行落 `is_new_ip=1`。`GET /api/admin/request-logs/new-ips` 列出未确认的新 IP,`POST .../new-ips/acknowledge` 消化;设置页「服务端数据洞察」顶部展示提醒卡并标黄相关日志行。**只提醒不拦截**——用户换网/出差 IP 常变,强拦截首先挡住本人;真拦截仍只依赖限流。public/missing/invalid/unknown tier 与空 IP 不记录。IP 可信度同请求审计一节:依赖反向代理清洗转发头。

## PWA API 缓存边界

Web PWA 只预缓存静态资源（JS、CSS、HTML、图标和图片）。`/api/**` 请求通过 Workbox `NetworkOnly` runtime caching 显式走网络，避免同步、导出、更新和管理接口被 service worker 返回陈旧响应。

前端构建产物里的 `version.json` 只是无凭据的静态 buildId 信号，不属于 `/api/**`，也不包含用户数据或 token。它刻意不进 Workbox precache，客户端以 `cache: "no-store"` 拉取它来判断网页前端是否需要刷新；命中新版本后执行的 service worker 注销和 Cache Storage 清理只影响浏览器静态资源缓存，不修改 IndexedDB、同步队列、备份或服务器数据。
