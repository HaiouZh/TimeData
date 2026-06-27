---
type: evergreen
title: 待办 · 重复规则引擎
covers:
  - packages/shared/src/recurrence.ts
  - packages/client/src/lib/tasks/recurrence.ts
  - packages/client/src/lib/tasks/recurrencePresets.ts
  - packages/client/src/components/MonthCalendar.tsx
  - packages/client/src/components/Wheel.tsx
last-reviewed: 2026-06-27
---

# 待办 · 重复规则引擎

> [todo](../todo.md) 的重复规则**子文档**：`Recurrence` 字段契约、判定“今天是否待做”、终止条件、衍生式完成（spawn）、预设门 UI。
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

## 2. 判定“今天是否待做”（`shared/src/recurrence.ts`）

- **`isDueNow` 用系统本地日序号**（`shared/src/recurrence.ts` / `placement.ts`），基于系统本地时区，**不是 `APP_TIME_ZONE`**——让“今天待做”跟用户本地日历一致，不受 UTC 日期切换影响。
- 一次性任务的 `scheduledAt` 也用系统本地 `getFullYear/Month/Date` 解析（`tasks.ts`），刻意不用 `APP_TIME_ZONE` 的 `getDateString`，避免跨夜边界非确定性顺序。
- 工具：`isDueNow` / `currentDueDateString` / `currentDueDayFor` / `recurrenceSummary` / `isRecurrenceFinishedAfter`（均在 `shared/src/recurrence.ts`）。

## 3. 终止条件与衍生式完成（`shared/src/taskCompletion.ts` + `lib/tasks/placement.ts`）

完成统一经 shared 纯函数 `completeTask`（文件 covers 归 [todo](../todo.md)，本文只描述重复分支行为）：

- **非终结完成 = 衍生 + 推进**：完成一轮**不**把模板 `done` 置 true，而是衍生一条独立的已完成快照 `Task`（`recurrence=null`/`done=true`/`completedAt=nowIso`/标题·tags/新 id，进完成区），模板自身推进：`completedCount+1`、`lastDoneAt=dueIso`（当前应发生日，本地零点）。root 的子任务（独立 child `Task`）由同一次 `completeTask` 一并处理——occurrence children 保留完成态快照、模板 children 重置为 `done=false`（见 [todo](../todo.md) §3 不变量 8）。
- **终结完成**：`count` 满（`completedCount+1 >= count`）或 `until` 过且无未完成发生 → 模板**就地转化**为最终完成记录（`recurrence=null`/`done=true`/写 `completedAt`/保留原 id），沉入完成区，**不**再衍生 occurrence。
- **完成基准日**：`effectiveDoneIso = dueIso`（当前应发生日，本地零点）。提前完成（`now < due`）把 `lastDoneAt` 推进到应发生日、下次顺延，不因提前点击连跳；过期完成（`now > due`）也只推进到应发生日，所以下次 due = 应发生日 + 1 格，若仍 ≤ 今天则今日继续以 overdue 再现（逐次追平）。daily/weekly/monthly 共用同一公式。
- **occurrence vs 模板分离**：衍生 occurrence 的 `completedAt=nowIso`（实际点击时刻，进已完成区/统计），活动模板的 `lastDoneAt=effectiveDoneIso`（应发生日，决定下次 due）。两个字段语义分离。
- **逾期保留**：`until` 已过但仍有逾期未完成发生时，留在“今天”区（`placement.ts` 的 `hasOutstandingUntilOccurrence`）。
- **模板不写 `completedAt`**：活动模板始终 `completedAt=null`，完成事件由衍生快照承载；仅终结转化时模板才写 `completedAt`（见 [todo](../todo.md) §3.1）。
- **复选框恒不勾选/不划线**：重复模板（含已排期未到期）复选框点击表示“完成一轮”、可提前推进，不进入“撤销完成”路径。
- **重设规则/起始日会重置进度游标**：用户修改 `recurrence` 内容或 `startAt` 时，客户端把活动模板视为重新锚定，清空旧 `lastDoneAt`/`completedCount`；规则和起始日未变的保存不清进度。
- `scheduleTask`/`unscheduleTask` 拒绝重复任务（重复任务的排期由重复规则管理；server 端 schedule 端点对重复任务回 409 `TASK_RECURRING_USE_RULE`）。

## 4. 预设门 UI（行为）

重复设置走“徽章 → 预设门 → 自定义整页”：

- 常用 每天/工作日/每周/每月/月末 一击写入；复杂规则进 `RecurrencePresetSheet` → `CustomRecurrencePage`（z=70 全屏）。
- 逾期重复模板从详情抽屉打开重复设置时，预设门和自定义页默认用今天作为锚点；从“今天”区把旧逾期改成“每天”等新规则时，会从今天重新开始，而不是继续显示旧到期日。
- `preserveHitDays`（`recurrencePresets.ts`）保留多周几/多月号/`byMonthday:[-1]` 月末，不因打开/完成而静默降级。
- `CustomRecurrencePage` UI 限制 `interval`/`count` 1..99（schema 允许 1..999，UI 更严）；时间滚轮用共享 `components/Wheel.tsx`，月号选择用 `components/MonthCalendar.tsx`。
- “仅某天”预设通过 `applyRecurrenceChoice()` 一次写成普通排期任务（非重复）。

## 5. 模块速查

| 入口 | 职责 |
|---|---|
| `shared/src/recurrence.ts` | `isDueNow`/`currentDueDateString`/`currentDueDayFor`/`recurrenceSummary`/`isRecurrenceFinishedAfter`（client `lib/tasks/recurrence.ts` 为 re-export 垫片） |
| `shared/src/taskCompletion.ts` | `completeTask`：非终结衍生+推进 / 终结转化（covers 归 [todo](../todo.md)） |
| `lib/tasks/recurrencePresets.ts` | 预设↔Recurrence 映射 + `preserveHitDays` |
| `components/MonthCalendar.tsx` | 月号选择日历 |
| `components/Wheel.tsx` | 共享时间滚轮（被重复规则等复用） |
| 预设门 UI | `pages/todo/{RecurrencePresetSheet,RecurrencePresetList,CustomRecurrencePage}.tsx`（covers 归 [todo](../todo.md)） |

**测试**：`shared/src/recurrence.test.ts`（由 client 迁入）、`lib/tasks/recurrencePresets.test.ts`、`lib/tasks.recurrenceChoice.test.ts`（点号文件，在 `lib/` 下不在 `lib/tasks/`）、`pages/todo/{RecurrencePresetSheet,CustomRecurrencePage}.test.tsx`、`components/{MonthCalendar,TimeRangeWheelPicker}.test.tsx`。

> `TimeRangeWheelPicker.test.ts` 指向的组件已改名为 `Wheel.tsx`（历史遗留），两组件名都可能在测试里出现。
