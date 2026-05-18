---
type: adr
status: accepted
date: 2026-05-18
---

# ADR 0008 — Dexie 单版本化与 SyncLog schema 紧化

## 状态

Accepted。

## 背景

2026-05-18 审查（`docs_local/2026-05-18审查报告/`）把以下问题列为高优先级数据安全风险：

- **A1**：`db.version(4).upgrade` 在升级时清空 `timeEntries` / `syncLog` / `autoBackups` / `categories` 并重置同步游标。对仍在使用 v1-v3 的用户构成数据丢失。
- **E2**：`SyncLogEntrySchema.synced` 接受 `boolean | 0 | 1` 三种形态，把 IndexedDB 历史兼容泄漏到跨端契约。

项目所有者确认：**当前不存在 v1-v3 用户**，v4 的清库迁移是单版本发布过程中的一次性行为。继续保留多版本声明与 boolean 兼容只会增加维护噪音。

## 决策

1. **Dexie schema 从 v1-v4 多次声明压缩为单一 `db.version(1)`**，索引等价于原 v3 / v4。
2. **保留旧版本兼容 fallback**：启动检测到 Dexie 实例 `verno > 1`（旧浏览器残留）时，调用 `resetLocalDataToDefaults()` 并清同步游标 + 控制台 warning。行为等价于原 v4 清库迁移，但代码集中、可读、可测。
3. **`SyncLogEntrySchema.synced` 从 `boolean | 0 | 1` 紧化为 `0 | 1`**。
4. **备份格式 V1 校验路径删除**：任何非 `BACKUP_FORMAT_V2` 直接返回 `INVALID_FORMAT`（详见 ADR 0003 的 2026-05-18 修订）。
5. **测试同步收敛**：移除 v2→v3 / v3→v4 迁移测试，新增"全新安装 seed"和"旧版本号 fallback"两个用例。

## 后果

**正面**：

- 维护成本下降：Dexie 升级链路集中到一处，避免后续误以为还有兼容包袱。
- 跨端契约清晰：shared `SyncLogEntry.synced` 不再泄漏存储层兼容。
- 审查工具不再把 v1-v3 兼容代码当成"未来 N 年都要保留"的负担。

**负面 / 成本**：

- 任何未来 schema 变更必须升 Dexie 版本号并写 upgrade 函数（这是规则不变，仅仅是基线变了）。
- 如果错估"用户基数"，仍存在历史浏览器残留旧 Dexie 数据库的极端情况——靠 fallback 兜底但需要观察。

## 不变的约束

- ADR 0003 规则不变：备份格式破坏性变更仍须升版本号、保留旧版本读取能力。
- 红线 #4（Backup 格式破坏性变更必须升版本号）不变；本次只是把"v1 校验代码"清掉，不是"格式回退"。
- 红线 #6（SQLite schema 不就地改列含义）不变。

## 链接

- 实施代码：
  - `packages/client/src/db/index.ts`（Dexie 单版本 + ready fallback）
  - `packages/client/src/backup/schema.ts`、`packages/client/src/backup/validateBackup.ts`
  - `packages/shared/src/schemas.ts`（`SyncLogEntrySchema`）
- 实施 plan：`docs_local/2026-05-18审查报告/02-A1+E2-Dexie单版本与schema清理.md`
- 关联 ADR：[`docs/adr/0003-backup-format-versioning.md`](0003-backup-format-versioning.md)
- 审批意见原文：`docs_local/2026-05-18审查报告/审批意见.md` 中 a1 / e2 条
