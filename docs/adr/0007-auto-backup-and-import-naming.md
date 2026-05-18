---
type: adr
status: accepted
date: 2026-05-18
---

# ADR 0007 — 自动备份与导入恢复中的"分类名一致性"是特性

## 状态

Accepted。

## 背景

2026-05-18 审查（`docs_local/2026-05-18审查报告/`）把以下三点列为备份语义 / 并发问题：

- **C1**：分类重命名时，`updateAutoBackupCategoryName` 会更新所有 `autoBackups` 行中同 ID 分类的名字。
- **C2**：导入备份时，`importBackup` 会用本地当前同 ID 分类名覆盖备份内的分类名。
- **D5**：服务端备份 `manifest` 文件是 read-modify-write 更新，理论上多请求并发可能互相覆盖。

如果以"备份是不可变 point-in-time 快照"为前提，C1 / C2 看起来是 bug；D5 在多用户场景下也确实是真实风险。

但 TimeData 的产品定位是**个人 + 单设备 + 单 token 自托管**，不是 SaaS。审查必须代入这个场景。

## 决策

**C1 / C2 是特性，不是 bug。**

- TimeData 自动备份是"当前状态的滚动快照"，不是历史归档。用户重命名分类后，再看历史备份不应该看到"已不存在的分类名"——会造成认知断裂。
- 导入备份的语义偏向"恢复数据"而非"完整还原历史"：分类名是"展示标签"，保留当前命名让用户少一次困惑。
- 已导出到 App 外部的 JSON 文件（`exportBackup`）**不会**被自动修改——那才是"真正的不可变快照"。

**D5（manifest 非原子写入）在单用户自托管模型下不修。**

- 触发条件（同一服务端、同一备份目录、两个进程同时写）在产品定位上不可能发生。
- 若产品定位将来扩展到多用户 SaaS，本决策需重新评估并切换到 SQLite 表或文件锁 + atomic rename。

## 后果

**正面**：

- 用户体验：分类重命名后旧备份不再带过时名字；导入备份不再因为"分类已被改名"而显示陌生标签。
- 避免无用工程：不需要为单用户场景引入文件锁 / 原子写。

**负面 / 成本**：

- 若用户期望"历史归档"语义，自动备份的分类名追踪会反直觉。已在 evergreen `backup.md` 第 5 节明确说明。
- 后续若扩展为 SaaS 需要重新审视，本 ADR 视为单用户阶段的约束。

## 后续审查的免疫力

未来 AI 或人审查若再次提出 C1 / C2 / D5 类问题，应：

1. 引用本 ADR 关闭；
2. 不重新列入排期，除非产品定位变化。

`AGENT.md` 中"项目定位边界"小节也明确列出同类场景，配合本 ADR 一起作为审查依据。

## 链接

- 实现：`packages/client/src/hooks/useCategories.ts`（`updateAutoBackupCategoryName`）、`packages/client/src/backup/importBackup.ts`、`packages/server/src/sync/backup.ts`
- evergreen：[`docs/evergreen/backup.md`](../evergreen/backup.md)
- 审批意见原文：`docs_local/2026-05-18审查报告/审批意见.md` 中 c1 / c2 / d5 条
- 实施 plan：`docs_local/2026-05-18审查报告/10-文档汇总-ADR与evergreen.md`
