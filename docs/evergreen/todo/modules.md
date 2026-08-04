---
type: evergreen
title: 待办任务 · 模块速查
covers:
  - packages/client/src/pages/todo/**
  - packages/client/src/lib/tasks.ts
  - packages/client/src/lib/taskNesting.ts
  - packages/client/src/lib/tasks/**
  - packages/server/src/routes/tasks.ts
  - packages/server/src/routes/agent.ts
  - packages/cli/src/commands/tasks.ts
last-reviewed: 2026-08-03
---

# 待办任务 · 模块速查

> [todo](../todo.md) 的**纵切子文档**：待办域的代码入口地图——哪个文件负责哪一段，测试落在哪。
> 读它的时机是「我知道要改什么，但不知道代码在哪」；改之前的语义与红线见 [invariants](invariants.md)。
> 本文以精确 `covers` 认领正文列出的代码入口，不挂 `contracts`：改实现不会必然让「文件在哪」变假，入口文件变化由 warn 提醒复查。

## 客户端

| 入口 | 职责 |
|---|---|
| `pages/TodoPage.tsx` | 顶层编排：`useLiveQuery(listTasks)` 取桶，持有筛选/搜索/展开状态，窄屏堆叠 / 宽屏 `ResizableSplit`。**两处跨文档接线**：重力水位线在排他之后拆 `floatingInbox`/`sunkenInbox`（顺序不可换，见 [gravity](gravity.md)）；`useEffect` 依 `buckets.handSession?.id` 触发 `healActiveSessions`（见 [at-hand](at-hand.md)）。`/todo?taskId=<id>` 是打开详情的 deep link：参数变化切换抽屉目标，关抽屉只移除 `taskId`、**保留其他 query**，行点击不写 URL |
| `pages/todo/TaskRow.tsx` | 扁平双行任务行（拖拽区、点击分区、内联 children、行尾 overlay 动作、入场高亮的具体构成读组件）。三处易错语义：复选框对重复模板**有下一发即可点**（含未到期提前完成），仅耗尽置灰；多选态下整行语义切成 `role="checkbox"`（点击 / Enter / Space 都是勾选），而**复选框仍是「完成」**（见 [project-zone](../project-zone.md#project-zone-batch)）；键盘两支共用一道 `event.target !== event.currentTarget` 闸，否则焦点在内层复选框上按键会连带勾选。标题 **Shift+单击整条复制**（纯 Shift、无 Ctrl/Alt/Meta、非多选态、当前无文本选中才拦截；成功上抛 `onCopyTitle` 由页面 toast「已复制」，失败静默；有文本选中 / 多选态下放行原行为） |
| `pages/todo/{TaskColumn,TaskList,SortableTaskRow}.tsx` | 列容器（**仅 today/inbox 注册 droppable + SortableContext**）/ `SwipeableList` / dnd-kit 包装。`DndContext` 只在 `TodoPage` 顶层，列内不各持。`fullSwipe={false}` 是**有意设计**：trailing 末项是删除、全滑会误删，故滑到头不自动触发。selection 三 prop（`selectionMode`/`selectedIds`/`onToggleSelect`）在收件箱的**三处渲染点各自显式透传**，不经 `...rowHandlers` 展开——漏一处就是那一段列表无法多选 |
| `pages/todo/TaskDetailSheet.tsx` | 底部抽屉：标题 / tag / 删除（普通任务 cascade、pending occurrence 删·跳）/ 重复预设。重复模板复选框有下一发即可代理完成；逾期模板打开重复设置时用今天作锚点；child（`parentId!==null`）隐藏 recurrence/tags/scheduledAt 高级控件（见 [todo](../todo.md) §2.2） |
| `pages/todo/{InlineChildren,SortableChildRow,useTaskChildren,useLatestOccurrenceChildren,todoDnd}.*` | children 列表三 mode（`draggable`/`static`/`readonly`）+ 可拖 child 行 + `useLiveQuery` 拉取 hook。`static`（重复模板行）经 `projectTemplateChildren` 把勾态投影到最新非 skipped occurrence child，无目标发置灰。新增走末尾空白草稿行 `NewChildRow`：空标题不落库、回车提交后保持草稿连录；标题默认是可跨行选择复制的文本，Enter/F2 才进编辑，**Shift+单击标题整条复制**（只读快照行除外）。DnD 纯函数在 `todoDnd`：`resolveIndentLevel` / `resolveTodoDragLane` / `laneToIndentLevel` / `clampTodoIndentPreview` / `resolveTodoDragWithIndent` / `hoveredRootIdFromOver`（见 [invariants](invariants.md) 第 5 / 14 条） |
| `pages/todo/TodoDragDock.tsx` | 拖拽投递坞：宽屏落点药丸（今天/手头/收件箱/各项目），左拉现身三形态 hidden/hint/engaged；`dock:` id 域与落点解析在 `todoDnd.ts`。详见 [drag-dock](drag-dock.md) |
| `pages/todo/{DayGroupedList,TagFilterPanel,TodoComposer,ResizableSplit,CollapsibleSection}.tsx` | 分组列表 / 三态填色筛选面 / 底部操作栏 / 双栏 / 折叠。两处耦合：`DayGroupedList` 的 `expandedFooter` 插槽供 Inbox 挂水下找回尾部（见 [gravity](gravity.md)）；`TodoComposer` 的 fixed 高度由 `TodoPage` 测量后复用给列表与主内容的 padding，窄屏还要叠移动底栏的 offset 与隐藏态 |
| `lib/tasks.ts` | 核心 CRUD + `listTasks` 出四分区（见 [invariants](invariants.md) 第 4 条）+ `putTask`（同事务写 `tasks`+`syncLog`，diff 推导 `completionOp`，见 [todo](../todo.md) §1.1）。child helper：`createChildTask` / `promoteToRoot` / `deleteTaskCascade`；`moveTaskToParent` / `moveTaskToParentInCurrentTransaction` 是降级为 child 的**底层原语**（只改父子与手头场指针，不碰项目归属），不是用户视角的收纳入口——那个入口在 `lib/taskNesting.ts`。`toggleTaskDone` 按 child / occurrence / 重复 root / 普通 root 四路分流，语义见 [invariants](invariants.md) 第 1 / 7 条。`runMaterialization` 物化当前 occurrence + children，**靠 in-flight 合并加事务内二次检查防重复物化**；`updateTask` 重锚同事务级联删活跃 occurrence 再物化（见 [invariants](invariants.md) 第 4 条）；`markOccurrenceSkipped` 删·跳留痕并物化下一发；`bumpTaskWeight` 累加 `weight`（见 [gravity](gravity.md)） |
| `lib/taskNesting.ts` | 用户视角的收纳/升根复合动作：`nestTaskUnderParent`（降级为 child，同事务清 `sessionId` + 所有 `goal.members`，见 [todo](../todo.md) §2.2）、`promoteTaskToHand`（子任务升根并直接站到手头，串行 `promoteToRoot` + `grabTaskToHand`，见 [at-hand](at-hand.md)）。落在本文件而非 `tasks.ts`/`goals.ts`：`goals.ts` 已单向 import `tasks.ts`，反向引用会成环，复合动作只能置于两者上层 |
| `lib/tasks/{placement,taskSort,taskRowZone,taskTimeLabel,inboxGrouping,workbenchPrefs,turnTags,subtasks}.ts` | 落点 / 排序 / 点击分区 / 时间标签 / 收件箱+完成分组 / 折叠态+双栏比例 / tag 聚合(allTags)/三轴过滤(filterTasks) / `subtaskProgress`（m/n 进度比例，children 数量喂入） |
| `lib/settings/todoDefaultDestinationSetting.ts` | composer 默认目标（`todo.defaultDestination.v1`，Dexie 同步） |
| 重复规则 | → [recurrence](recurrence.md) |
| 想法重力（水位线/翻牌/`GravityReviewSection`/`SunkenInboxTail`/设置页） | → [gravity](gravity.md) |
| 手头软会话（`lib/sessions.ts` 生命周期 / `AtHandSection.tsx` 卡片 / atHand 排他投影） | → [at-hand](at-hand.md) |

交互图标统一经 Phosphor `Icon` 包装（规则见 [design-language](../design-language.md) §4），按钮语义由文本与 `aria-label`（如 `删除标签 ${tag}`）承载。

> 跨包：完成/物化纯计算 `shared/src/occurrence.ts`（`latestOccurrenceForRule`/`materializeDue`/`isRuleExhausted`/`nextDueDate`，client `toggleTaskDone`、server agent `done=true`、CLI `task-done` 共用同一「最新一发」代理语义）+ 日期助手 `shared/src/taskDates.ts`（`localDateOf`/`normalizeScheduledDate`）；重复引擎 `shared/src/recurrence.ts` 见 [recurrence](recurrence.md)。

## 服务端 / CLI

| 入口 | 职责 |
|---|---|
| `routes/tasks.ts` | `GET /`（只读查询，只返回 root tasks）+ `POST /:id/schedule`（排期事务内直写+记账、提交后 SSE，重复 409，**不走 applyChange**） |
| `routes/agent.ts` | `POST /tasks/:id/status`（封闭动作，走 `applyChange` + `notifySyncChange`；重复模板 `done=true` 代理完成当前可代理 occurrence——active 则 update，无 active 经 `materializeDue` create 到期 occurrence，未到期/耗尽回 409 `RULE_NOT_DUE`，故意不开放提前完成；普通 root 就地完成；child `done` 只轻量更新自身 done/completedAt；root `note` 建独立 child Task，child `note` 409 拒绝） |
| `sync/domains.ts` | `tasks` 通用 LWW 注册 + `taskToRow`/`readTaskRecord` |
| `db/schema.ts` / `lib/db-rows.ts` | 建表/列迁移 + `rowToTask` |
| `cli/src/commands/tasks.ts` | `tasks` / `task-*` 命令（server API 封装） |

## 测试

**client**：`pages/TodoPage.test.tsx`、`pages/todo/{TaskRow,TaskList,TaskColumn,TaskDetailSheet,DayGroupedList,SunkenInboxTail,TagFilterPanel,TodoProjectSection,ResizableSplit,TodoComposer,TodoSelectionBar,InlineChildren,CollapsibleSection,TodoListSections}.test.{ts,tsx}`、`pages/todo/todoDnd.test.ts`（二元缩进、三档车道、横向预览夹取、落点矩阵、投递坞 id 域与落点解析）、`pages/todo/TodoDragDock.test.tsx`（药丸集合/三形态/aria；坞相关见 [drag-dock](drag-dock.md)）、`lib/tasks.test.ts`、`sync/clientDomains.test.ts`、`lib/tasks/{inboxGrouping,taskTimeLabel,workbenchPrefs,taskRowZone,taskSort,turnTags,placement,subtasks}.test.ts`（重力相关见 [gravity](gravity.md)；手头相关见 [at-hand](at-hand.md)）
**server**：`routes/tasks.test.ts`（GET + POST schedule）、`routes/agent.test.ts`（POST status）、`sync/tasks-domain.test.ts`、`sync/domains.test.ts`、`db/schema.test.ts`、`lib/db-rows.test.ts`
**shared**：`entitySchemas.test.ts`、`schemas.test.ts`、`recurrence.test.ts` ｜ **cli**：`commands/tasks.test.ts`
