---
type: adr
status: accepted
date: 2026-06-01
---

# ADR 0010 — Quick Notes 作为独立数据域

## 状态

Accepted（随 Quick Notes 第一版落地）。

## 背景

TimeData 的主数据域是 `time_entries`：一条记录有开始时间、结束时间和分类，并参与时间环、时长统计、分类统计、重叠校验和服务端权威校验。

Quick Notes 的需求是聊天式速记：用户快速写一个词、一句话或一段想法，按时间保留上下文。它没有时长，也不天然属于某个分类。如果把速记塞进 `time_entries` 或 `TimeEntry.note`，会污染统计、制造伪时间段，并让分类和重叠规则承担不属于它们的语义。

## 决策

新增独立数据域 `quick_notes` / `QuickNote`：

```ts
type QuickNote = {
  id: string;
  text: string;
  occurredAt: string;
  createdAt: string;
  updatedAt: string;
};
```

`occurredAt` 是业务发生时间，`createdAt` 是系统创建时间，`updatedAt` 用于编辑和同步。`quick_notes` 分表存储、独立同步、独立导出/导入/删除，不混入 `time_entries`。

## 后果

正面：

- 速记不参与分类校验、归档分类校验、时间段重叠、时间环和时长统计。
- 同步系统可以把速记作为一等实体处理：`quick_notes/create|update|delete`，并纳入 status、commit hash、pull、force-push 和 tombstone。
- 速记可以用 `timedata.quick-notes.backup` 做独立备份，导入时只合并速记，不改时间记录和分类。
- 未来 AI 分析可以并列读取 `timeEntries + quickNotes`，但不直接读写 IndexedDB、SQLite、syncLog 或备份文件。

成本：

- shared / client / server 的同步契约多一个实体，后续改公共 API 时必须一起检查。
- 完整 `timedata.backup` 暂不包含 quick notes；用户需要使用速记独立备份或服务器数据库备份覆盖这一域。
- 如果未来要让 CLI/AI 写速记，需要新增受控 CLI/API 路径，不能绕过 ADR 0001。

## 链接

- 数据模型：[`docs/evergreen/data-model.md`](../evergreen/data-model.md)
- 同步机制：[`docs/evergreen/sync.md`](../evergreen/sync.md)
- 备份边界：[`docs/evergreen/backup.md`](../evergreen/backup.md)
- 写入路径红线：[`docs/adr/0001-cli-as-only-write-path.md`](./0001-cli-as-only-write-path.md)
