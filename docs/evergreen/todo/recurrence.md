---
type: evergreen
title: 待办 · 重复规则引擎
covers:
  - packages/client/src/lib/tasks/recurrence.ts
  - packages/client/src/lib/tasks/recurrencePresets.ts
  - packages/client/src/components/MonthCalendar.tsx
  - packages/client/src/components/Wheel.tsx
last-reviewed: 2026-06-18
---

# 待办 · 重复规则引擎

> [todo](../todo.md) 的重复规则**子文档**：`Recurrence` 字段契约、判定“今天是否待做”、终止条件、spawn 行为、预设门 UI。
> 不讲：Task 主体 schema/四分区/写入通道（见 [todo](../todo.md)）。

## 承上启下

- **上游**：用户在 `TaskDetailSheet` 经重复预设门设置规则（UI 文件 `pages/todo/RecurrencePresetSheet.tsx`/`RecurrencePresetList.tsx`/`CustomRecurrencePage.tsx` 由 [todo](../todo.md) 的 `pages/todo/**` covers 管辖，本文只描述其行为）。
- **下游**：`Recurrence` 作为 `Task.recurrence` 字段随 `tasks` 域同步（见 [todo](../todo.md) §2、[sync](../sync.md)）。
- **邻居**：[todo](../todo.md)（主题）。

## 1. `Recurrence` schema（`entitySchemas.ts:RecurrenceSchema`）

```ts
{
  freq: "daily" | "weekly" | "monthly";
  interval: number;            // 正整数，schema 上限 999
  byWeekday?: number[];        // ISO 周几：1=周一 … 7=周日；weekly 必填，min length 1
  byMonthday?: number[];       // 1..31 或 -1（月末）；monthly 必填，min length 1
  time?: string;               // 本地 HH:mm，仅展示/计划语义
  basis: "due" | "completion";
  count?: number;              // 1..999，与 until 互斥
  until?: string;              // UTC ISO，语义为本地日期零点
}
```

`superRefine` 交叉约束（`entitySchemas.ts:RecurrenceSchema`）：

- `weekly` 必带 `byWeekday`，**不得带 `byMonthday`**。
- `monthly` 必带 `byMonthday`，**不得带 `byWeekday`**。
- `daily` 不得带 `byWeekday`/`byMonthday`。
- `count` 与 `until` 互斥。
- `basis="due"` 按计划日判断下一次；`basis="completion"` 从上次完成日往后推。

## 2. 判定“今天是否待做”（`lib/tasks/recurrence.ts`）

- **`isDueNow` 用系统本地日序号**（`recurrence.ts` / `placement.ts`），基于系统本地时区，**不是 `APP_TIME_ZONE`**——让“今天待做”跟用户本地日历一致，不受 UTC 日期切换影响。
- 一次性任务的 `scheduledAt` 也用系统本地 `getFullYear/Month/Date` 解析（`tasks.ts`），刻意不用 `APP_TIME_ZONE` 的 `getDateString`，避免跨夜边界非确定性顺序。
- 工具：`isDueNow` / `currentDueDateString` / `recurrenceSummary` / `nextScheduledDayAfter`。

## 3. 终止条件与 spawn（`lib/tasks/placement.ts`）

- **终止**：`count` 满（`completedCount >= count`）或 `until` 过且无未完成发生 → `done=true` 沉入完成区。
- **逾期保留**：`until` 已过但仍有逾期未完成发生时，留在“今天”区（`placement.ts` 的 `hasOutstandingUntilOccurrence`）。
- **滚动 spawn**：无终止条件的重复任务勾选后 `done` **不**置 true，同时把 `subtasks[].done` 重置为 false 让下一轮就绪；终结性完成（count/until 耗尽）保留子任务勾选。
- **完成计数**：重复任务完成写 `completedCount+1` + `lastDoneAt`，**不写 `completedAt`**（见 [todo](../todo.md) §3.1）。
- `scheduleTask`/`unscheduleTask` 拒绝重复任务（重复任务的排期由重复规则管理；server 端 schedule 端点对重复任务回 409 `TASK_RECURRING_USE_RULE`）。

## 4. 预设门 UI（行为）

重复设置走“徽章 → 预设门 → 自定义整页”：

- 常用 每天/工作日/每周/每月/月末 一击写入；复杂规则进 `RecurrencePresetSheet` → `CustomRecurrencePage`（z=70 全屏）。
- `preserveHitDays`（`recurrencePresets.ts`）保留多周几/多月号/`byMonthday:[-1]` 月末，不因打开/完成而静默降级。
- `CustomRecurrencePage` UI 限制 `interval`/`count` 1..99（schema 允许 1..999，UI 更严）；时间滚轮用共享 `components/Wheel.tsx`，月号选择用 `components/MonthCalendar.tsx`。
- “仅某天”预设通过 `applyRecurrenceChoice()` 一次写成普通排期任务（非重复）。

## 5. 模块速查

| 入口 | 职责 |
|---|---|
| `lib/tasks/recurrence.ts` | `isDueNow`/`currentDueDateString`/`recurrenceSummary`/`nextScheduledDayAfter` |
| `lib/tasks/recurrencePresets.ts` | 预设↔Recurrence 映射 + `preserveHitDays` |
| `components/MonthCalendar.tsx` | 月号选择日历 |
| `components/Wheel.tsx` | 共享时间滚轮（被重复规则等复用） |
| 预设门 UI | `pages/todo/{RecurrencePresetSheet,RecurrencePresetList,CustomRecurrencePage}.tsx`（covers 归 [todo](../todo.md)） |

**测试**：`lib/tasks/recurrence.test.ts`、`lib/tasks/recurrencePresets.test.ts`、`lib/tasks.recurrenceChoice.test.ts`（点号文件，在 `lib/` 下不在 `lib/tasks/`）、`pages/todo/{RecurrencePresetSheet,CustomRecurrencePage}.test.tsx`、`components/{MonthCalendar,TimeRangeWheelPicker}.test.tsx`。

> `TimeRangeWheelPicker.test.ts` 指向的组件已改名为 `Wheel.tsx`（历史遗留），两组件名都可能在测试里出现。
