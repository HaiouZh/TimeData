---
type: evergreen
title: 安全与凭据处理
covers:
  - packages/client/src/pages/settings/SettingsServerPage.tsx
  - packages/client/src/lib/storageKeys.ts
  - packages/client/vite.config.ts
  - packages/server/src/middleware/auth.ts
  - packages/server/src/routes/sync.ts
  - packages/server/src/routes/syncLog.ts
  - packages/server/src/routes/admin/index.ts
last-reviewed: 2026-05-18
---

# 安全与凭据处理

## 客户端服务器 Token

客户端服务器设置页会把同步 API Token 保存在本机浏览器存储中，使用既有 key `timedata_api_token`。这个 key 是已存在的本地配置契约；不要在没有迁移计划和兼容处理的情况下改名。

设置页必须明确提示用户：Token 会保存在本机浏览器存储中，只应在可信设备上保存服务器 Token。当前实现不引入 sessionStorage，也不在页面刷新后自动丢弃 Token。

## 服务端认证与审计

未设置 `AUTH_TOKEN` 时，所有受保护的 `/api/*` 请求默认返回 HTTP 500；`/api/health` 和 `/api/version` 仍保持公开。只有显式设置 `ALLOW_UNAUTHENTICATED_DEV=1` 时，开发环境才会放行未带 token 的 `/api/*` 请求，并且每个进程只打印一次警告。生产部署必须设置 `AUTH_TOKEN`，不再依赖 `NODE_ENV=production` 才 fail-closed。

认证中间件通过 `createAuthMiddleware()` 暴露失败审计钩子，未授权请求会记录路径和代理 IP，便于后续接入持久化审计或告警。默认 `authMiddleware` 保持现有行为，不要求调用方配置审计后端。

## force-push 临时 Token

`/api/sync/force-push/prepare` 发放 5 分钟有效的内存确认 token。`/api/sync/force-push` 会先用 shared runtime schema 校验完整请求形状，畸形 JSON 或字段类型错误直接返回 `invalid_request`，不会进入确认 token 消费；请求形状合法后才校验确认短语和一次性 token：成功消费后立即失效，过期、缺失或复用都会被拒绝。

服务端会把 force-push token 的 prepare、过期拒绝、普通拒绝和最终应用写入 `sync_logs`，用于追踪高风险覆盖操作。最终应用会在替换数据和重建 `sync_seq` 后刷新 `sync_state`，但不会把确认 token 或请求 token 写入状态摘要。当前 token store 仍是单进程内存结构，多实例部署前必须迁移到 SQLite 或外部存储。

## 同步日志管理接口

`/api/admin/sync-logs` 复用 admin 限流，支持读取、写入和清空服务端 `sync_logs`。写入请求会用 Zod 校验单条或最多 100 条批量日志；读取的 `limit` 会限制在 1-500；清空日志必须显式发送 `X-Confirm: true` 头，否则返回 412。

## PWA API 缓存边界

Web PWA 只预缓存静态资源（JS、CSS、HTML、图标和图片）。`/api/**` 请求通过 Workbox `NetworkOnly` runtime caching 显式走网络，避免同步、导出、更新和管理接口被 service worker 返回陈旧响应。
