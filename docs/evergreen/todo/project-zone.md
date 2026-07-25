---
type: evergreen
title: 待办 · 项目区与归属轴
covers:
  - packages/client/src/lib/tasks/goalMembership.ts
  - packages/client/src/lib/tasks/projectZone.ts
  - packages/client/src/pages/todo/TodoProjectSection.tsx
last-reviewed: 2026-07-25
---
<!-- 复核 2026-07-25（项目区 UI 上线）：本文由 todo.md §3 第 13/14 条外提并补齐 UI 契约；归属轴排他随本期打开。 -->

# 待办 · 项目区与归属轴

> 母主题：[todo](../todo.md)。
> 本文管的是**任务属于谁**——`Goal(kind="project")` 成员在待办页的分组投影、归属轴对收件箱的排他、归属变更的写入侧不变量，以及项目区的呈现契约。
> 目标实体本身（`Goal` schema、星图、未归类托盘）在 [goals](../goals.md)；焦点轴见 [todo/at-hand](at-hand.md)；重力见 [todo/gravity](gravity.md)。

## 承上启下

- **上游**：唯一输入是 `db.goals` 全表**裸行**（`listTasks` 每轮另读一次，刻意不过 `GoalSchema`，见 §2）与 `db.tasks` 的根任务。写入面有两个且写的是同一份 `Goal.members`：goals 页的星图 / 未归类托盘，以及项目区成员行内的「退出项目」——都经 `lib/goals.ts` 的 `addGoalMember` / `removeGoalMember` / `updateGoal` / `deleteGoal`（§4 的 touch 挂在这四条通道上）。
- **下游**：`listTasks` 出桶时多产出 `TodoBuckets.projects`（分组投影）与 `goalLinkedIds`（绿竖条集合），并就地从 `buckets.inbox` 里扣掉 active project 成员。`TodoPage` 据此渲染 `TodoProjectSection`，再用 `projectChipIndex` / `goalBarTaskIds` 决定组外行（手头 / 今天 / 已排期）画项目名 chip 还是画绿竖条。排他改变的是 inbox 的**内容**，想法重力的水位线（`splitInboxByGravity`）作用在排他之后的 inbox 上——两者顺序不可换。
- **契约**：`TodoProjectGroup` 形状与分组投影落在 `lib/tasks/goalMembership.ts`（§2/§3 是它的语义合同）；呈现判定纯函数（`projectMemberState` / `summarizeProjectGroup` / `projectChipIndex` / `goalBarTaskIds`）落在 `lib/tasks/projectZone.ts`，UI 侧合同见 §5。`Goal` 实体 schema 本身不归本文，见 [goals](../goals.md)。
- **邻居**：[goals](../goals.md)（`Goal` schema、`members` 的第一个写入面、悬空 ref 的 ghost 节点）、[todo](../todo.md)（Task 字段全貌与四分区落点）、[todo/at-hand](at-hand.md)（焦点轴与归属轴正交，故归集必须早于手头的 `continue`）、[todo/gravity](gravity.md)（水位线按 `updatedAt` 判定，是 §4 的 touch 存在的直接原因）、[sync](../sync.md)（touch 是本机副作用而非跨设备不变量，且属「非用户直接编辑」的批量写入）。

## 1. 三根轴，只在同一根轴上排他

| 轴 | 回答的问题 | 区 | 排他性 |
|---|---|---|---|
| 归属 | 这东西属于谁 | 收件箱 ↔ 项目区 | **互斥** |
| 焦点 | 我当下在干什么 | 手头 | 正交，照常显示 |
| 时间 | 什么时候做 | 今天 / 已排期 | 正交，照常显示 |

一条被抓到手头、或排到今天的成员**仍留在项目区**——项目区要的是项目全貌，缺了正在干的那几条就是残废视图。归集因此发生在 `listTasks` 主循环里手头 `continue` 与 `placementForTask` **之前**。

## 2. 两份索引，口径不同，不得互相派生

`listTasks` 另读一次 `db.goals`（**裸行、不做 `GoalSchema` 解析**——`superRefine` 会因单个成员重复 reject 整行，让整组归属静默失效；且 `status`/`members` 有 schema 默认值，老行可能缺字段），产出两份索引：

| 函数 | 判据 | 用途 |
|---|---|---|
| `goalLinkedTaskIds` → `Set` | `status==="active"`，**全 kind** | 行内绿竖条 `inGoal` |
| `projectMemberIndex` → `Map` | `status==="active" && kind==="project"` | 归属轴排他 + 项目区分组 |

若由后者派生前者，只属于 `theme` 目标的任务会失去绿竖条、且既进不了项目区又被排他踢出收件箱 → 在页面上彻底消失。

同挂多个 active project 的任务**只归一个组**（`members` 无跨目标唯一约束）：读侧仲裁取 `goal.updatedAt` 新者，并列取 `goal.id` 字典序小者——保证 `db.goals.toArray()` 返回顺序变化时结果稳定。

## 3. 投影规则（`buckets.projects`）

1. 只收根任务（`parentId === null`），且 `recurrence === null && ruleId === null`——重复模板与 occurrence 本期不参与归属。
2. **排他与归集共用同一个布尔量**。这是红线：若排他单独判 `projectMemberIndex.has(id)`，一条被写进 `members` 的 occurrence 会既被归集守卫挡在项目区外、又被踢出收件箱，整条消失。
3. 未完成成员进 `group.tasks`，已完成成员进 `group.doneTasks`（喂展开态尾部的「已完成 N 条」子区）。
4. 组间按**全部可解析成员（含已完成）**的 `max(updatedAt)` 倒序，并列按 `goal.createdAt` 倒序 —— 已完成成员参与排序键，故「某组全部完成」不会让它掉到末尾。
5. 查不到的成员 ref 直接丢弃、不计数，**不做清理**：悬空 ref 正是 goals 星图 ghost 节点的唯一数据源（见 [goals](../goals.md)）。
6. 零可解析 task 成员的目标不进项目区（纯 track 目标在星图里已有位置）。
7. `group.total` 只数 task 成员——与 goals 页 `buildGoalOverview` 的项目进度口径**不同**，那边把 track 成员也算进分母。

## 4. 归属变更同事务刷新成员任务 `updatedAt`

`lib/goals.ts` 的 `addGoalMember` / `removeGoalMember` / `updateGoal` / `deleteGoal` 在同一 Dexie 事务内调用 `touchTasksInCurrentTransaction`，刷新归属发生变化的成员任务并各记一条 `syncLog`。

原因是重力沉降按 `task.updatedAt` 年龄判定（`isTaskSunken`）：任务失去归属会回落收件箱，不刷新就按旧时间戳参与水位线判定、直接沉进默认折叠的水下区，体感是「退出项目 = 任务消失」。释放通道有四条（`status→archived`、`kind→theme`、`members` 整包替换、删除目标），`updateGoal` 用**前后归属差集**（`releasedProjectTaskIds`）统一覆盖前三条而非逐条特判；`addGoalMember`/`removeGoalMember` 的幂等早退分支**不 touch**（否则重复点一下就把任务从水下顶上来）。

这是**本机副作用、不是跨设备不变量**——入站 sync apply 按域写单表、无跨域钩子，其它设备改归属不会 touch 本机 task 行。故项目区必须完全由 goals 推导，不得依赖 task 行上的反向标记。

## 5. 呈现契约

- **位置**：收件箱正上方（两种布局都是）。零 active project 时整区不渲染。
- **组三态**：0 可解析成员 → 不进项目区；有成员且全部完成 → `已完成 · M 条` + 「去归档」深链 `/goals/:id`；有未完成 → `还剩 N / 共 M`。全完成态**不特殊置顶**（置顶会让已完成项目抢占进行中项目的注意力）。
- **展开态记忆**：组件内 `Map<goalId, boolean>` 覆盖表，不持久化。默认全折叠；存量提示条未读时首次默认全展开。
- **成员状态点**：`projectMemberState` 判四态——`at-hand`（焦点轴优先于时间轴）/ `today` / `scheduled` / `idle`。`idle` 是默认多数态，渲染层不画胶囊：没有胶囊本身就是答案。**没有「逾期」态**：`placementForTask` 只对重复模板与 occurrence 给 `overdue`，一次性任务过期会被退回 `inbox`，而项目区的归集守卫恰好把前两类挡在门外——项目区成员拿不到 overdue。
- **项目名 chip**：只出现在**手头 / 今天 / 已排期（含水下尾）**。它与绿竖条是同一件事的两种说法，**不得同屏**——`goalBarTaskIds` 把有 chip 的行从竖条集合里裁掉，竖条退回只表达 theme 归属。chip 需 `relative z-20` 才能压过行左 2/5 的 `z-10` 拖拽 activator。裁剪后的 `goalLinkedIds` 同时也喂给了翻牌区 / 水下收件箱 / 收件箱这三个**不渲染 chip** 的分区，看着像多裁了，其实零语义损失：「chip 集合 ∩ 收件箱 = ∅」是**构造性**成立的——`projectChipIndex` 的输入是 `buckets.projects`，而它与 inbox 排他共用同一个 `ownedByProject`（§3 第 2 条），进得了 chip 索引的就一定进不了 inbox。别把这行当笔误改回去。
- **退出项目**：行内动作调 `removeGoalMember`，任务浮在水上回落收件箱。组内最后一条成员退出后 **Goal 保留不自动归档**（归档是 goals 页的显式动作）。
- **落点反馈**：排他打开后「回到 inbox 池」不再等于「出现在收件箱」——项目成员会落进项目区里一个默认折叠的组，而组 header 的「还剩 N / 共 M」本来就把它算在内、数字纹丝不动，全屏零反馈，体感是「任务凭空消失」。故凡是让成员回落 inbox 池的路径，动作后都要复用 chip 的回跳机制（`revealProjectHome`）展开它的归属组并滚过去：行尾/左滑「回收件箱」、拖进 `pool:inbox`、移出手头、子任务升根、详情抽屉改「重复与时间」、取消勾选。
  - **判据只在 `revealProjectHome` 一处判，入参是写入后的 `Task`**。调用方各自判必然分裂成「动作前的行 / 拖拽意图 / `choice.kind`」几种口径，每种都漏一半（详情抽屉尤其：`choice.kind === "none"` 漏掉「仅某天」选到过去日期那支，又误报已完成 / 在手头的任务）。三道闸：① 归集守卫里 placement 判不出的两条（子任务、`ruleId` 非空的混合体行——它们 scheduledAt 为空照样被判 inbox，但投影层根本不收，展开的是不含它的组）；② 焦点轴压过落点（`listTasks` 把未完成的手头成员截进 `atHand` 并 `continue`，它在页面最顶上、本来就看得见）；③ `placementForTask(...).pool === "inbox"`。`done` 与 `recurrence` 不必单列——placement 首行就把它们判成 `completed` / `today`·`recurring`；**已完成成员落在组内另一个默认折叠的「已完成」子区，展开组也看不到它，给的是错误指认、比零反馈更糟**，正是靠 placement 这一支挡住。
  - **写入失败不反馈**：详情抽屉的 `onTimeChanged` 只在写入成功时报，交出去的是写入结果。若不管成败都报，任务被并发删除时会一边弹错一边把页面滚去展开一个空组（查归属认 `members` 原始事实，不校验 task 行还在不在）。
  - 查归属分两级：先查 `projectChipIndex`（渲染期闭包，覆盖"动作前就是未完成根成员"的情形），未命中再 `findActiveProjectGoalIdForTask` 读一次库——**子任务不在任何客户端投影里**；**已完成成员在 `buckets.projects[].doneTasks` 里、但不在 `projectChipIndex`**（只收未完成成员是刻意设计，已完成成员没有可展开的目标，不是查不到），两者都得查库才补得上归属。查库要 `catch` 后静默降级：`TaskRow` 的 `onToggle` 是裸调用，抛出去没人接。
  - **reveal 是待消费意图，不是脉冲**：`revealProjectHome` 只等一次 `db.goals.toArray()`，而项目区要等整轮 `listTasks` 才产出新组，前者几乎必然先落——若置位后立刻消费，那一帧 `rowRefs` 上还没有节点，`scrollIntoView` 静默跳过且永不重试（展开那一半却生效了，成了「展开了但没滚到」）。故宿主持一份待消费 `goalId` **集合**（单槽会被 React 自动批处理合并、丢掉先置位的那个），组件只消费**这一帧真的渲染出来**的组、其余留到下一轮 `groups` 变化时补上，消费后回报宿主清空。**清空是硬要求**：不清的话，跨 1024px 断点时项目区整棵重挂（换了父容器），mount effect 会把上一次的意图重放一遍——用户手动折叠的状态丢失、页面被滚走。
- **项目区不参与标签筛选与搜索**（与手头区一致）；但 `tagOptions` 的来源必须包含项目区成员，否则筛选栏会随圈组而缩水。
- **存量提示条**挂在**收件箱顶部**而非项目区顶部：任务是从那里消失的，解释要贴着消失的地方。已读位 `timedata_todo_project_zone_intro_dismissed` 同时决定项目区首次是否默认展开。它的两个数**必须同口径**：条数只数未完成成员，组数就只能数「含未完成成员的组」——组数若把「全部完成」的组也算上，「1 条任务已归入 2 个项目」这种自相矛盾的话就是可达的。

## 6. 模块速查

| 入口 | 职责 |
|---|---|
| `lib/tasks/goalMembership.ts` | 读侧两份索引与分组投影：`goalLinkedTaskIds`（全 kind active）/ `projectMemberIndex`（active project）/ `buildTodoProjectGroups`（组内未完·已完拆分、组间排序键、同挂多组的仲裁） |
| `lib/tasks/projectZone.ts` | 呈现判定纯函数（不碰 db / React，落 node 快桶）：`projectMemberState` 四态 / `summarizeProjectGroup` 组三态计数 / `projectChipIndex` / `goalBarTaskIds` 竖条裁剪 |
| `pages/todo/TodoProjectSection.tsx` | 项目区 UI：受控展开的组 header（`revealGoals` 待消费意图 → 组渲染出来才展开 + `scrollIntoView`，并经 `onRevealConsumed` 回报宿主清空）、成员行「当前在哪」胶囊与「退出项目」、已完成折叠子区；同文件另导出 `ProjectNameChip`（组外行的项目名 chip）与 `ProjectZoneIntroBar`（存量提示条） |
| `lib/tasks.ts: listTasks()`（归 [todo](../todo.md) covers） | 归集与排他的同源判据 `ownedByProject`、`buckets.projects` 出桶、`goalLinkedIds` |
| `pages/TodoPage.tsx`（归 [todo](../todo.md) covers） | 接线：项目区挂收件箱正上方（宽窄两种布局）、chip → `openProject` 回跳、成员回落 inbox 池时 `revealProjectHome`（唯一落点判据 `landsInCollapsedProjectGroup`，六条路径一律传写入后的 `Task`）、`exitProject` → `removeGoalMember`、`tagOptions` 纳入项目区成员 |
| `lib/goals.ts`（归 [goals](../goals.md) covers） | 写侧四条归属通道 + `touchTasksInCurrentTransaction`（见 §4） |

测试：`lib/tasks/goalMembership.test.ts`（两份索引口径、分组投影、组间排序、同挂多组仲裁、悬空 ref）、`lib/tasks/projectZone.test.ts`（成员四态、组三态计数、chip 索引、竖条裁剪）、`lib/tasks.test.ts`（`describe("listTasks projects 桶")`：归集/排他同源、手头正交、重复模板与 occurrence 挡在门外）、`pages/todo/TodoProjectSection.test.tsx`（组展开折叠、状态胶囊、退出项目、已完成子区、`revealGoals` 消费与「组还没渲染出来就留着、出现后补上」、提示条、chip）、`pages/TodoPage.test.tsx`（页面级：排他后成员离开收件箱、零 project 不渲染、chip 回跳、回收件箱后展开归属组、红线 3 竖条不同屏，以及落点判据的三条反向用例——手头区取消勾选 / 抽屉清时间但已完成 / 抽屉选未来某天都**不**展开，外加「抽屉→页面」这根线本身）、`lib/goals.test.ts`（`describe("归属变更同事务刷新成员任务 updatedAt")`）。

## 7. 本期未做

圈成项目（多选建组）与拖入已有项目在后续阶段；项目级重力、项目区参与筛选、重复待办的归属、捕捉侧携带归属一律不做。归档前的「N 条未完成任务将回到收件箱」提示未做——归档是 toggle 且 5 处入口当前都无确认，属 goals 页议题；数据安全已由 §4 的 touch 兜住。
