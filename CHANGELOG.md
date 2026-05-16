# Changelog

> 本文件记录用户可见的变更。开发者级别细节请查 git log；中间设计/计划文档放在 `docs/superpowers/`。
>
> 维护约定：
> - 每次发版前，把"Unreleased"段落整理成正式版本号 + 日期。
> - 版本号采用 [SemVer](https://semver.org/lang/zh-CN/) 的精神：破坏性 API 变更升 major，新增向后兼容功能升 minor，bug fix 升 patch。
> - 暂未引入 changesets / semantic-release；任何想自动化的人可以提一个 plan。

## [Unreleased]

### Added
- 客户端：跨午夜自动刷新时间轴页面。
- 客户端：自实现 Confirm 对话框替代 `window.confirm` / `window.alert`。
- 客户端：集中化 i18n 字符串表（暂时只有简体中文）。
- 服务端：`/api/entries?v=2` 返回 `{ entries, total, hasMore }` 信封；旧版裸数组保持兼容。
- 服务端：HTTP body 大小限制（默认 5MB，环境变量 `MAX_BODY_BYTES` 可调）。
- 服务端：`/api/sync/*` 与 `/api/admin/*` 简单速率限制（默认 60/分钟与 120/分钟，`SYNC_RATE_MAX` / `ADMIN_RATE_MAX` 可调）。
- 服务端：`hono/secure-headers` 中间件（Referrer-Policy / X-Frame-Options / HSTS；CSP 待后续 PR）。
- CLI：`timedata version`、`--version`、`--format=human|json` 输出格式选择。

### Changed
- 服务端：`packages/server/src/routes/admin.ts` 单文件 588 行拆分为 `routes/admin/` 子模块（summary、entries、categories、sync、backups、health、analytics + 共享 helpers）。
- 客户端：`useCategories()` 内部用 Map 缓存查找；StatsPage / Timeline 受益。
- 移动端：Gradle wrapper 从 package.json 内嵌 `node -e` blob 抽到 `packages/mobile/scripts/gradle.mjs`。

### Documentation
- `docs/evergreen/deployment.md`：补本地生成 Android release keystore 流程。
- 新增 `CHANGELOG.md`（本文件）。

## 历史变更

更早的变更未单独记录到本文件；查 git history（`git log --oneline`）和 `docs/upgrade-plan/` 的阶段计划即可。
