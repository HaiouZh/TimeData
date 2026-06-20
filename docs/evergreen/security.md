---
type: evergreen
title: 安全与凭据处理
covers:
  - packages/client/src/pages/settings/SettingsServerPage.tsx
  - packages/client/src/lib/storageKeys.ts
  - packages/client/vite.config.ts
  - packages/server/src/middleware/auth.ts
  - packages/server/src/middleware/rateLimit.ts
  - packages/server/src/middleware/bodyLimit.ts
  - packages/server/src/routes/sync.ts
  - packages/server/src/routes/syncLog.ts
  - packages/server/src/routes/admin/index.ts
last-reviewed: 2026-06-20
---

# 安全与凭据处理

## 客户端服务器 Token

客户端服务器设置页会把同步 API Token 保存在本机浏览器存储中，使用既有 key `timedata_api_token`。这个 key 是已存在的本地配置契约；不要在没有迁移计划和兼容处理的情况下改名。

设置页必须明确提示用户：Token 会保存在本机浏览器存储中，只应在可信设备上保存服务器 Token。当前实现不引入 sessionStorage，也不在页面刷新后自动丢弃 Token。

`storageKeys.ts` 还集中登记底部导航、待办工作台比例与折叠状态等本地 UI 偏好 key。此类 key 只保存界面状态，不保存 Token、任务内容或其他业务数据；新增 UI 偏好 key 时仍要确认不会把敏感信息塞进 `localStorage`。

`schemaNormalizationVersion`（`timedata_schema_normalization_version`）是纯本地、不同步、非敏感的版本闸，只记录客户端 schema 归一 pass 已跑到的版本号。

Android 原生环境保持 HTTPS-only：`packages/mobile/capacitor.config.ts` 的 `server.cleartext: false` / `android.allowMixedContent: false` 与 Manifest 的 `android:usesCleartextTraffic="false"` 共同禁止明文 API 请求。服务器设置页在原生环境会拒绝保存 `http://` API 地址，并提示用户改用 HTTPS 反向代理地址；Web/PWA 环境不做这层 Android 专属拦截。设置页还会提示自托管用户：服务端 `ALLOWED_ORIGINS` 必须包含 `https://localhost`，否则 Android（Capacitor `androidScheme: "https"`）的跨域请求会被 CORS fail-closed 中间件拒绝；具体配置位置和验证方法见 [部署与自更新](deployment.md) 的 `ALLOWED_ORIGINS` 段落。

## 服务端认证与审计

未设置 `AUTH_TOKEN` 时，所有受保护的普通 `/api/*` 请求默认返回 HTTP 500；`/api/health` 和 `/api/version` 仍保持公开。只有显式设置 `ALLOW_UNAUTHENTICATED_DEV=1` 时，开发环境才会放行未带 token 的 `/api/*` 请求，并且每个进程只打印一次警告。生产部署必须设置 `AUTH_TOKEN`，不再依赖 `NODE_ENV=production` 才 fail-closed。

`AGENT_TOKEN` 是可选窄域令牌，只被 `/api/agent/*` 的 `scopedAuthMiddleware` 接受。该作用域同时接受 master `AUTH_TOKEN` 和 `AGENT_TOKEN`；当前只用于 `POST /api/agent/tasks/:id/status` 任务状态、备注（创建独立子任务 child `Task`）和 tags 回写。`AGENT_TOKEN` 不能访问 sync、force-push、admin、export、data reset 或 update。`AUTH_TOKEN` 与 `AGENT_TOKEN` 都缺失且未显式开发旁路时，scoped auth 同样 fail-closed。

认证中间件通过 `createAuthMiddleware()` 暴露失败审计钩子，未授权请求会记录路径和代理 IP，便于后续接入持久化审计或告警。默认 `authMiddleware` 保持现有行为，不要求调用方配置审计后端。

`GET /api/sync/stream` 是受保护的只读 SSE 通道，也挂在同一 `/api/*` Bearer 鉴权之后。客户端不用原生 `EventSource`，而是通过 fetch 读取 `ReadableStream`，因此 token 仍放在 `Authorization` header 中，不会进入 URL、反向代理访问日志或浏览器地址栏。流内容只包含 `hello` / `bump` 的 `latestSeq` 游标和注释心跳，不包含时间记录、速记文本、分类名称或设置值。

## 速率限制与请求体上限

鉴权之外还有两层中间件保护服务端：

- **速率限制**（`middleware/rateLimit.ts`）：按 token 标识对 `/api/sync/*` 与 `/api/admin/*` 分别限流，60 秒滑窗，超限返回 HTTP 429；`/api/admin/sync-logs` 复用 admin 限流。
- **请求体上限**（`middleware/bodyLimit.ts`）：`/api/*` 请求体超限返回 HTTP 413；`Content-Length` 超限快速拒绝，无/未知长度的 body 先读取计数再判定。

窗口次数与上限字节由 `SYNC_RATE_MAX` / `ADMIN_RATE_MAX` / `MAX_BODY_BYTES` 调整，**默认值与完整说明见 [deployment](deployment.md) 环境变量表（数值单一来源）**。多实例部署时限流计数当前是单进程内存结构。

## force-push 临时 Token

`/api/sync/force-push/prepare` 发放 5 分钟有效的内存确认 token。`/api/sync/force-push` 会先用 shared runtime schema 校验核心同步表请求形状（categories、timeEntries、quickNotes、tasks，以及可选 settings；quickNotes 可携带 `source` / `sourceLabel` 展示元数据和 `pinned` 置顶状态），畸形 JSON 或字段类型错误直接返回 `invalid_request`，不会进入确认 token 消费；健康原始数据与 `health_charts` 当前不在 force-push 请求范围内。请求形状合法后才校验确认短语和一次性 token：成功消费后立即失效，过期、缺失或复用都会被拒绝。

服务端会把 force-push token 的 prepare、过期拒绝、普通拒绝和最终应用写入 `sync_logs`，用于追踪高风险覆盖操作。最终应用会在替换数据和重建 `sync_seq` 后刷新 `sync_state`，但不会把确认 token 或请求 token 写入状态摘要。当前 token store 仍是单进程内存结构，多实例部署前必须迁移到 SQLite 或外部存储。

## 同步日志管理接口

`/api/admin/sync-logs` 复用 admin 限流，支持读取、写入和清空服务端 `sync_logs`。写入请求会用 Zod 校验单条或最多 100 条批量日志；读取的 `limit` 会限制在 1-500；清空日志必须显式发送 `X-Confirm: true` 头，否则返回 412。

## PWA API 缓存边界

Web PWA 只预缓存静态资源（JS、CSS、HTML、图标和图片）。`/api/**` 请求通过 Workbox `NetworkOnly` runtime caching 显式走网络，避免同步、导出、更新和管理接口被 service worker 返回陈旧响应。

前端构建产物里的 `version.json` 只是无凭据的静态 buildId 信号，不属于 `/api/**`，也不包含用户数据或 token。它刻意不进 Workbox precache，客户端以 `cache: "no-store"` 拉取它来判断网页前端是否需要刷新；命中新版本后执行的 service worker 注销和 Cache Storage 清理只影响浏览器静态资源缓存，不修改 IndexedDB、同步队列、备份或服务器数据。
