---
type: evergreen
title: 待办 · 重复规则引擎
covers:
  - packages/shared/src/recurrence.ts
  - packages/shared/src/occurrence.ts
  - packages/client/src/lib/tasks/recurrence.ts
  - packages/client/src/lib/tasks/recurrencePresets.ts
  - packages/client/src/components/MonthCalendar.tsx
  - packages/client/src/components/Wheel.tsx
last-reviewed: 2026-07-03
---

<!-- 复核 2026-06-27（设计语言 P1）：MonthCalendar / Wheel 只迁移 token / typography / Phosphor 图标，重复规则 schema、判定“今天是否待做”和预设门行为均不变。 -->

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
- **复选框恒不勾选/不划线**：重复模板（含已排期未到期）复选框 `disabled`、点击不触发 `onToggle`（P3：模板退纯管理区，勾选只落在物化出的 occurrence 上）。
- **重设规则/起始日会重置游标 + 删活跃 occurrence**：改 `recurrence` 或 `startAt` 视为重新锚定，清空 `lastDoneAt`/`completedCount`，同事务级联删除该 rule 的活跃 pending occurrence 及其 children，再按新规则即时尝试物化；规则/起始日未变则保留进度。转普通（`none`）或一次性排期（`scheduled`）也同事务清孤儿 occurrence。
- **occurrence 物化 + today 切读（P3）**：`runMaterialization` 遍历重复规则，对无活跃 pending occurrence 的 rule 调 `materializeDue` 写一条 occurrence，并克隆模板当前 children 为 `parentId=occurrence.id` 的 occurrence children（确定性 id `${occ.id}:child:${templateChild.id}`，保留标题 / tags / 顺序，`done=false`、`completedAt=null` 起步，不继承模板子任务完成态）；已有活跃 occurrence 但 children 缺失时会补齐。并发调用合并为模块级 in-flight Promise，写事务内二次检查。物化时机：冷启动 bootstrap、跨日 timer、focus、visibilitychange、规则重锚保存后、单发完成/删·跳后即时触发。`listTasks` 的 today 桶只含 pending occurrence（`ruleId!==null && !skipped && !done`），重复模板退 scheduled 管理区、不投影 today；skipped occurrence 不进活跃桶。
- **规则行子任务勾选映射**：scheduled 管理区展开重复模板时，模板子任务只提供标题 / 结构；复选框显示和点击代理到该 rule 名下「最新那一发」（`scheduledAt` 最大且非 skipped）的确定性 occurrence child。无可映射 occurrence 时复选框置灰；目标 child 缺失时 `toggleTaskDone` 在同事务内按 `${occ.id}:child:${templateChild.id}` 兜底创建并写 `tasks/create` syncLog。模板子任务本体不承载完成态，历史脏 `done=true` 不再影响规则行显示，也不会污染未来物化。
- **单发动作**：勾 occurrence 无需新代码（`recurrence=null` 天然走 `toggleTaskDone` 非重复分支）。删·跳 = `markOccurrenceSkipped`（置 `skipped=true` 留痕、写 update syncLog，不删行让 P2 游标前进）；`TodoPage.remove` 对 `ruleId!==null` 的 occurrence 调 `markOccurrenceSkipped`，其余行走 `deleteTaskCascade` 级联删除。撤勾 done occurrence（reopen）会在同事务删掉同 rule 后来物化的 active 发及其 children——它是这发完成的推进产物，删除后游标回退一格、保证同 rule 至多一条 active。
- **删除级联**：`deleteTaskCascade` 是「懂规则的删除」——删重复模板时连清其名下活跃 pending occurrence 及 children（done/skipped 历史发留作账本事实）；删模板子任务时连清活跃发里按确定性 id 物化的镜像子任务（done 历史发的快照不动）。全部同事务写 delete syncLog。
- `scheduleTask`/`unscheduleTask` 拒绝重复任务（重复任务的排期由重复规则管理；server 端 schedule 端点对重复任务回 409 `TASK_RECURRING_USE_RULE`）。

## 4. 预设门 UI（行为）

重复设置走“徽章 → 预设门 → 自定义整页”：

- 常用 每天/工作日/每周/每月/月末 一击写入；复杂规则进 `RecurrencePresetSheet` → `CustomRecurrencePage`（z=70 全屏）。
- 逾期重复模板从详情抽屉打开重复设置时，预设门和自定义页默认用今天作为锚点；从“今天”区把旧逾期改成“每天”等新规则时，会从今天重新开始，而不是继续显示旧到期日。
- `preserveHitDays`（`recurrencePresets.ts`）保留多周几/多月号/`byMonthday:[-1]` 月末，不因打开/完成而静默降级。
- `CustomRecurrencePage` UI 限制 `interval`/`count` 1..99（schema 允许 1..999，UI 更严）；时间滚轮用共享 `components/Wheel.tsx`，月号选择用 `components/MonthCalendar.tsx`。这两个共享组件消费 [design-language](../design-language.md) token 与 `td-num` 数字角色；样式迁移不改变重复规则的取值、锚点或保存语义。
- “仅某天”预设通过 `applyRecurrenceChoice()` 一次写成普通排期任务（非重复）。

## 5. 模块速查

| 入口 | 职责 |
|---|---|
| `shared/src/recurrence.ts` | `isDueNow`/`currentDueDateString`/`currentDueDayFor`/`recurrenceSummary`/`isRecurrenceFinishedAfter`（client `lib/tasks/recurrence.ts` 为 re-export 垫片） |
| `shared/src/occurrence.ts` | occurrence 物化引擎纯函数：`occurrenceId`/`materializeOccurrence`/`isRuleExhausted`/`nextDueDate`/`materializeDue`/`latestOccurrenceForRule`（P2/P3，零副作用，为 today 切读、物化时机和规则行子任务代理提供地基） |
| `lib/tasks.ts`（P3 新增） | `runMaterialization`（遍历 rule → `materializeDue` → 写 occurrence + occurrence children，in-flight 合并）、`markOccurrenceSkipped`（删·跳这一发并即时物化下一发）、`toggleTaskDone`（pending occurrence 完成后即时物化下一发；规则模板子任务重定向到最新非 skipped occurrence child）、`updateTask` 重锚级联删活跃 occurrence 并即时物化、`applyRecurrenceChoice` none/scheduled 清孤儿 |
| `shared/src/taskCompletion.ts` | `completeTask`：非终结衍生+推进 / 终结转化（covers 归 [todo](../todo.md)） |
| `lib/tasks/recurrencePresets.ts` | 预设↔Recurrence 映射 + `preserveHitDays` |
| `components/MonthCalendar.tsx` | 月号选择日历 |
| `components/Wheel.tsx` | 共享时间滚轮（被重复规则等复用） |
| 预设门 UI | `pages/todo/{RecurrencePresetSheet,RecurrencePresetList,CustomRecurrencePage}.tsx`（covers 归 [todo](../todo.md)） |

**测试**：`shared/src/recurrence.test.ts`（由 client 迁入）、`lib/tasks/recurrencePresets.test.ts`、`lib/tasks.recurrenceChoice.test.ts`（点号文件，在 `lib/` 下不在 `lib/tasks/`）、`pages/todo/{RecurrencePresetSheet,CustomRecurrencePage}.test.tsx`、`components/{MonthCalendar,TimeRangeWheelPicker}.test.tsx`。

> `TimeRangeWheelPicker.test.ts` 指向的组件已改名为 `Wheel.tsx`（历史遗留），两组件名都可能在测试里出现。
