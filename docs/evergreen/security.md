---
type: evergreen
title: 安全与凭据处理
covers:
  - packages/client/src/pages/settings/SettingsServerPage.tsx
  - packages/client/src/lib/storageKeys.ts
  - packages/client/vite.config.ts
  - packages/server/src/middleware/auth.ts
  - packages/server/src/routes/sync.ts
last-reviewed: 2026-05-18
---

# 安全与凭据处理

## 客户端服务器 Token

客户端服务器设置页会把同步 API Token 保存在本机浏览器存储中，使用既有 key `timedata_api_token`。这个 key 是已存在的本地配置契约；不要在没有迁移计划和兼容处理的情况下改名。

设置页必须明确提示用户：Token 会保存在本机浏览器存储中，只应在可信设备上保存服务器 Token。当前实现不引入 sessionStorage，也不在页面刷新后自动丢弃 Token。

## 服务端认证与审计

生产环境 `NODE_ENV=production` 时必须设置 `AUTH_TOKEN`，否则服务端启动前拒绝继续运行。未配置 token 的开发模式会放行 `/api/*` 并只打印一次警告，不能用于生产部署。

认证中间件通过 `createAuthMiddleware()` 暴露失败审计钩子，未授权请求会记录路径和代理 IP，便于后续接入持久化审计或告警。默认 `authMiddleware` 保持现有行为，不要求调用方配置审计后端。

## force-push 临时 Token

`/api/sync/force-push/prepare` 发放 5 分钟有效的内存确认 token。`/api/sync/force-push` 会先用 shared runtime schema 校验完整请求形状，畸形 JSON 或字段类型错误直接返回 `invalid_request`，不会进入确认 token 消费；请求形状合法后才校验确认短语和一次性 token：成功消费后立即失效，过期、缺失或复用都会被拒绝。

服务端会把 force-push token 的 prepare、过期拒绝、普通拒绝和最终应用写入 `sync_logs`，用于追踪高风险覆盖操作。当前 token store 仍是单进程内存结构，多实例部署前必须迁移到 SQLite 或外部存储。

## PWA API 缓存边界

Web PWA 只预缓存静态资源（JS、CSS、HTML、图标和图片）。`/api/**` 请求通过 Workbox `NetworkOnly` runtime caching 显式走网络，避免同步、导出、更新和管理接口被 service worker 返回陈旧响应。
