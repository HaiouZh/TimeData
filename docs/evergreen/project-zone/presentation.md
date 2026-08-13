---
type: evergreen
title: 项目区与归属轴 · 呈现与手势
covers:
contracts:
  - packages/client/src/lib/tasks/projectZone.ts
  - packages/client/src/pages/todo/todoDnd.ts
last-reviewed: 2026-08-10
---

# 项目区与归属轴 · 呈现与手势

> [project-zone](../project-zone.md) 的**呈现子文档**：项目区在待办页长什么样、用户能对它做什么。
> 讲什么：组三态与成员行的呈现契约、落点反馈与 reveal 意图、拖拽归入（动作二）、组内父子收纳与升根回组（动作三）、组内行的 dnd 身份。
> 不讲什么：三根轴与排他语义、两份索引口径、分组投影规则、归属写入侧不变量（都在 [母文档](../project-zone.md) §1–§4）、多选建组（动作一，见 [project-zone/multi-select](multi-select.md)）。

## 承上启下

- **上游**：[母文档](../project-zone.md) §3 的 `buckets.projects` 投影与 §4 的写入侧不变量——本文的呈现与手势都消费它们的产物。
- **下游**：`TodoProjectSection` 的渲染与 `TodoPage` 的拖拽接线。
- **契约**：呈现判定纯函数落在 `lib/tasks/projectZone.ts`；拖拽的容器域、行 id 前缀与哨兵次序落在 `pages/todo/todoDnd.ts`，两者都不碰 db。
- **邻居**：[母文档](../project-zone.md)、[project-zone/multi-select](multi-select.md)（动作一）、[todo/invariants](../todo/invariants.md)（落点判定表与容器域）、[todo/drag-dock](../todo/drag-dock.md)（投递坞，本域整区关闭）。

<a id="project-zone-presentation"></a>

## 1. 呈现契约

- **位置**：收件箱正上方（两种布局都是）。零 active project 时整区不渲染。
- **组三态**：0 可解析成员 → 不进项目区；有成员且全部完成 → `已完成 · M 条` + 「去归档」深链 `/goals/:id`；有未完成 → `还剩 N`，若近 7 天有完成则追加 `· 近 7 天 +M`。`+0` 不画，长期项目不显示总数分母。全完成态**不特殊置顶**（置顶会让已完成项目抢占进行中项目的注意力）。
- **组内已完成不渲染**：已完成成员退出组内列表，标题行只回答「总共完成多少」与「最近推进多少」。没有等价的项目内已完成清单；低频出口是更多菜单的「在 goals 页打开」。
- **组内行可拖**：`TaskList` 接 `sortable` + `containerId = projectContainerId(goalId)` + `dndIdPrefix`，`childrenModeOverride` 从 `"static"` 改 `"draggable"`（升根手势的前提）。拖柄、缩进高亮环（`data-indent-target`）、收纳后展开父行的落点反馈（`revealChildren`）全部由页面透传的判定结果驱动，**组件不自己判**——跨组不亮高亮是页面侧 `hoveredRootIdFromOver` 就已过滤掉的结果，组件手上并没有「当前拖拽来自哪个组」这份信息。手势语义见 §3。
- **内容区限高**：展开态内容区使用 `.todo-project-group-body` 语义类承载 `max-height: 45vh` 与 `overflow-anchor: none`，组件另挂 `overflow-y-auto`；限高加在内容区而不是组块外框。外框仍是 droppable 落点，内容区限高让落点 rect 有界且稳定，收件箱（唯一拖入源）不被大组推出视口。已知限制：落点反馈滚到组外框，不保证滚到内部那条成员；语义仍是「告诉你它在哪个组」。
- **标题行操作**：未全完成组显示 `+`，点击后展开组并在内容区顶部显示就地输入框；Enter 以 trim 后标题调用 `createTaskForProject`，成功清空输入并保持打开，Esc 关闭。全完成组不显示 `+`，仍显示「去归档」。所有失败由页面 action toast 报原因，输入框保留草稿；筛选激活时，创建成功但新任务不匹配筛选条件会提示「任务已创建，但当前筛选未显示它」，写入结果不受筛选影响。
- **更多菜单**：每组标题行有 `⋯`（Phosphor `DotsThree`，role=menu/menuitem），提供「改名」与「在 goals 页打开」。菜单沿用 QuickNoteActionMenu 的交互：打开时首项聚焦，Escape / 外点关闭并把焦点还给触发按钮；菜单按钮和输入框点击不得穿透成展开/折叠。改名走 `updateGoal(id, { title })`，空标题不提交、失焦/Escape 恢复原名；打开目标跳 `/goals/:id`。
- **上限预警**：`memberCount >= Math.ceil(GOAL_MEMBERS_MAX * 0.9)` 且组未全完成时显示轻量「接近上限」提示。阈值从上限推导，不写死 450；预警不改变写入行为，真正撞线仍由 `ProjectAssignError("full")` 拒绝。
- **展开态记忆**：组件内 `Map<goalId, boolean>` 覆盖表，不持久化。无筛选时默认全折叠，展开由用户点击或 `revealGoals`（落点反馈 / chip 回跳）驱动；筛选激活时匹配组强制展开，但不改写覆盖表，清除筛选后恢复用户偏好。
- **成员状态点**：`projectMemberState` 判四态——`at-hand`（焦点轴优先于时间轴）/ `today` / `scheduled` / `idle`。`idle` 是默认多数态，渲染层不画胶囊：没有胶囊本身就是答案。**没有「逾期」态**：`placementForTask` 只对重复模板与 occurrence 给 `overdue`，一次性任务过期会被退回 `inbox`，而项目区的归集守卫恰好把前两类挡在门外——项目区成员拿不到 overdue。
- **成员行动作按两根轴各自渲染**：组内列表按 `pool="inbox"` 铺（组内不排序也不换池），但行右端的换池箭头与「抓到手头」各走自己的轴——`projectMemberRowActions` 同时给出 `atHand`（焦点轴）与 `pool`（时间轴：在今天 → `today` 显示「回收件箱」，其余含排到未来 → `inbox` 显示「排进今天」），经 `TaskList` 的 `rowPool` / `atHandIds` 落到行上，悬停按钮与滑动菜单共用这同一份判定。**项目区是唯一会撞上这件事的区域**：别处 `listTasks` 早把在手头 / 在今天的行截去各自的区，只有这里按 [母文档](../project-zone.md) §1「一条被抓到手头、或排到今天的成员仍留在项目区」原样留着，跟着列表级 `pool` 走就会给它们挂上空动作（已在手头的还显示「抓到手头」、已排今天的还显示「排进今天」）。与 `projectMemberState` 的四态互斥刻意不同：那个答的是「当前在哪」（焦点轴压过时间轴）、只用来画胶囊，拿它开关按钮会把「在手头且已排今天」判成没排今天、箭头指反。时间轴刻意不给 `upcoming`——`TaskRow` 拿到它会再画一枚排期日胶囊，与状态胶囊重复。
- **项目名 chip**：只出现在**手头 / 今天 / 已排期（含水下尾）**。它与绿竖条**不得同屏**——chip 说得出是哪个项目（携带该项目的身份色）、点得开，竖条只说「有去处」（全场同一个绿），同屏出现时后者是前者的冗余——`goalBarTaskIds` 把有 chip 的行从竖条集合里裁掉，竖条退回只表达 theme 归属。chip 需 `relative z-20` 才能压过行左 2/5 的 `z-10` 拖拽 activator。裁剪后的 `goalLinkedIds` 同时也喂给了翻牌区 / 水下收件箱 / 收件箱这三个**不渲染 chip** 的分区，看着像多裁了，其实零语义损失：「chip 集合 ∩ 收件箱 = ∅」是**构造性**成立的——`projectChipIndex` 的输入是 `buckets.projects`，而它与 inbox 排他共用同一个 `ownedByProject`（[母文档](../project-zone.md) §3 第 2 条），进得了 chip 索引的就一定进不了 inbox——这行不是笔误。chip 与组卡片标题行各画一个同色圆点，色取自 `TodoBuckets.projectTints`（集合内避撞分配，见 [design-language](../design-language.md#design-language-s1)），构成「点↔点」的同一项目认同；两处都不自行取色——避撞只有拿着全部 active project 才算得出，组件手上只有显示出来的组；组卡片不另加左侧色条——同一张卡片上两个颜色信号与本条的「chip / 竖条不得同屏」是同一条裁剪规则。
- **退出项目**：行内动作调 `removeGoalMember`，任务浮在水上回落收件箱。组内最后一条成员退出后 **Goal 保留不自动归档**（归档是 goals 页的显式动作）。**另有一条不经表层 API 的退出路径**：把任务收纳为子任务（`lib/taskNesting.ts: nestTaskUnderParent`）会遍历所有 goal，静默清空该任务在其中的成员资格——子任务不持有任何归属指针（见 [todo](../todo.md#todo-s2-2)）。
- **落点反馈**：「回到 inbox 池」不等于「出现在收件箱」——项目成员会落进项目区里一个默认折叠的组，而组 header 的「还剩 N / 共 M」本来就把它算在内、数字纹丝不动，全屏零反馈，体感是「任务凭空消失」。故凡是让成员回落 inbox 池的路径，动作后都要复用 chip 的回跳机制（`revealProjectHome`）展开它的归属组并滚过去：行尾/左滑「回收件箱」、拖进 `pool:inbox`、移出手头、子任务升根、详情抽屉改「重复与时间」、取消勾选。**「拖入项目」不在此列**——它是把成员送**进**组、不是回落 inbox 池，落点就在手指下方，自动展开反而会在连续拖入第二条时改变布局；它的反馈走 toast（§2）。
  - **判据只在 `revealProjectHome` 一处判，入参是写入后的 `Task`**。调用方各自判必然分裂成「动作前的行 / 拖拽意图 / `choice.kind`」几种口径，每种都漏一半（详情抽屉尤其：`choice.kind === "none"` 漏掉「仅某天」选到过去日期那支，又误报已完成 / 在手头的任务）。三道闸：① 归集守卫里 placement 判不出的两条（子任务、`ruleId` 非空的混合体行——它们 scheduledAt 为空照样被判 inbox，但投影层根本不收，展开的是不含它的组）；② 焦点轴压过落点（`listTasks` 把未完成的手头成员截进 `atHand` 并 `continue`，它在页面最顶上、本来就看得见）；③ `placementForTask(...).pool === "inbox"`。`done` 与 `recurrence` 不必单列——placement 首行就把它们判成 `completed` / `today`·`recurring`；**已完成成员只计入标题行计数、组内没有可展开行，展开组也看不到它，给的是错误指认、比零反馈更糟**，正是靠 placement 这一支挡住。
  - **写入失败不反馈**：详情抽屉的 `onTimeChanged` 只在写入成功时报，交出去的是写入结果。若不管成败都报，任务被并发删除时会一边弹错一边把页面滚去展开一个空组（查归属认 `members` 原始事实，不校验 task 行还在不在）。
  - 查归属分两级：先查 `projectChipIndex`（渲染期闭包，覆盖"动作前就是未完成根成员"的情形），未命中再 `findActiveProjectGoalIdForTask` 读一次库——**子任务不在任何客户端投影里**；已完成成员只计入 `doneCount`、不在 `projectChipIndex`，两者都得查库才补得上归属。查库要 `catch` 后静默降级：`TaskRow` 的 `onToggle` 是裸调用，抛出去没人接。
  - **reveal 是待消费意图，不是脉冲**：`revealProjectHome` 只等一次 `db.goals.toArray()`，而项目区要等整轮 `listTasks` 才产出新组，前者几乎必然先落——若置位后立刻消费，那一帧 `rowRefs` 上还没有节点，`scrollIntoView` 静默跳过且永不重试（展开那一半却生效了，成了「展开了但没滚到」）。故宿主持一份待消费 `goalId` **集合**（单槽会被 React 自动批处理合并、丢掉先置位的那个），组件只消费**这一帧真的渲染出来**的组、其余留到下一轮 `groups` 变化时补上，消费后回报宿主清空。**清空是硬要求**：不清的话，跨 1024px 断点时项目区整棵重挂（换了父容器），mount effect 会把上一次的意图重放一遍——用户手动折叠的状态丢失、页面被滚走。
- **项目区标签与搜索筛选（`filterActive`）**：项目区支持全域标签与关键字筛选。当筛选激活时，项目组内部按筛选规则过滤任务，包含匹配任务的项目组自动展开，无匹配任务的组隐去；筛选期间收到的 `revealGoals` 仍会滚动并消费，但不写入展开覆盖表，筛选清除后恢复用户原有的折叠/展开偏好。零 active project 时整区仍不渲染；有 active project 但全部组均无匹配任务时显示项目区空态。手头区（AtHand）维持焦点隔离，不受筛选影响；`tagOptions` 的来源包含项目区成员。
- **排他语义无常驻解释**，是刻意的：收件箱顶部不挂「N 条任务已归入 M 个项目」这类提示条，项目区也不因此首次全展开。

<a id="project-zone-drag-in"></a>

## 2. 拖拽归入（动作二）

从**今天 / 收件箱**把根任务拖到项目组上 = 归入该组。落点判定表与容器域在 [todo/invariants](../todo/invariants.md) 第 5 条；这里管归属侧的契约。

- **落点是整个组块**（标题行 + 展开态内容区），不是只有标题行：展开后标题行仅一行高、下面是一整片列表，只认标题行在展开态几乎瞄不准。`useDroppable` 落点共两族：本处（id `project:<goalId>`）与宽屏投递坞的药丸（id `dock:*`，见 [todo/invariants](../todo/invariants.md) 第 14 条）。
- **组块与组内行同时是落点，靠碰撞策略分流**：组内每行另注册 sortable，dnd id 带 `project-row:<goalId>:` 前缀（见 §3.1）。指针落在卡内时谁赢由 `preferProjectCollisions` 裁决——**来源是本组则同组行优先，来源是外区则只认卡片**，故外区归入这条路径够不着组内行。组内不做用户自定义重排（组内序由 [母文档](../project-zone.md) §3 规则 6 的四段排序算出）。
- **碰撞策略必须让项目卡优先**（`preferProjectCollisions`）。页面用 `closestCenter`，它按 droppable 矩形**中心点**算距离，而展开的项目卡是几百像素高的大块、中心离手指很远，会被隔壁收件箱某一行抢走落点——整块 droppable 在展开态近乎失灵。故指针真落在项目卡内时只认它，否则原样退回 `closestCenter`；宽屏投递坞的药丸浮在列表之上，坞命中又优先于项目卡（见 [todo/invariants](../todo/invariants.md) 第 14 条）。`fallback` 传 thunk：指针已落在卡内时 `closestCenter` 的结果注定被丢弃，没必要每帧遍历全部 droppable。**已知限制**：键盘拖拽没有指针坐标，`pointerWithin` 恒空 → 走 fallback，项目组在纯键盘下仍难命中。
- **对缩进系统让位**：横向位移触发的缩进判定与「拖进项目」共用同一次手势，`canBecomeChild` 优先于目标容器。两道闸——`hoveredRootIdFromOver` 对 `project:` 容器恒返回 null，且 `canBecomeChild` 显式排除 project——第二道在当前调用路径上不可构造，是明写的防御闸。没有它，斜着拖进项目会被判成 `move-to-parent`（拆/接父子关系）。
- **准入四拒，判在两处，不重合**：
  - **子任务 / 重复待办**由**页面**判（`dragDropBlocked`），给悬停禁止态。子任务这一支**必须从 dnd 容器 id 认**（`parent:` 前缀）：`listTasks` 主循环第一行就跳过 `parentId !== null` 的行，子任务不在任何 bucket 里，按 task 查恒为 null——`activeParentId` 同理恒为 null，不能用它判。
  - **满员 / 目标组失效**由**写入侧**抛（`ProjectAssignError`），组件判不了：它手上只有 `TodoProjectGroup`，既无 `goal.status`/`kind`，也无 `members` 数组长度（500 闸看的是含 track 成员与悬空 ref 的整个数组，拿可解析成员数近似会撒谎）。
  - 因此存在一个**刻意窗口**：组在拖拽途中于另一端被归档时仍显示「可落」高亮，松手才弹拒绝。它换掉的是「高亮 → 静默吞掉归属」，方向是净改善。
- **成功也要给反馈**（`已归入「X」`）。组间排序键是组内成员 `max(updatedAt)`（[母文档](../project-zone.md) §3 规则 5），而归入恰好刷新它——**目标组必然跳到项目区第一位**。「不展开组」挡不住这种布局变化：三张折叠卡外观一样，用户按视觉位置拖第二条就会落进别的组，且成功路径若无反馈，误归入几乎不可见（组不展开、任务同时因排他从收件箱消失）。
- **拒绝也要说原因**。子任务那支走的是 `resolveTodoDragOperation` 返回 null 的路径，`handleDragEnd` 在 `if (!op)` 就早退，走不到正常的 toast 分支——拒绝提示因此发在那个早退分支内部（`projectAssignBlockMessage("subtask", …)`）。无声失败会被读成「应用坏了」。
- **兜底 toast 不可省**：目标组的裸行过不了 `GoalSchema.parse` 时抛的是 `ZodError` 而非 `ProjectAssignError`。红线「读裸行不 parse」保证这种组**照常渲染成落点**，用户拖多少次都一样——静默吞掉等于应用坏了。文案要中性（真正坏掉的常是任务**原来所在**的源组，指认目标组会让用户换组反复重试）。
- **前置边确认**：`prerequisiteLossOnAssign(taskId, nextGoalId)` 读裸行算出「摘除会连带删掉几条边、来自几个组」，非空则落库前 `useConfirm` 问一句。判据与 `removeGoalMember` 内那句 filter 同源（跳过目标组自身、只认 active project、`blocker`/`blocked` 双侧）。多源组时文案只说组数与总条数、不点名（`count` 是各组之和而 `goalTitle` 取边最多那组，点名会把总数栽给单个组）。**它在准入闸之前调用**，故满员/归档/occurrence 等被拒场景会「先警告后失败」——方向是过度警告，不是数据丢失。

<a id="project-zone-nesting"></a>

## 3. 组内父子收纳（动作三）

组内两个手势，**都只在同一个组内成立**：把 A 右移越线停在同组 B 上 = A 成为 B 的子任务（落库走 `lib/taskNesting.ts: nestTaskUnderParent`，同事务清 `sessionId` + 退出全部项目名单）；把组内子任务左移越线 = 升根并**重新入本组**（走 `promoteTaskToProject`，串行 `promoteToRoot(…, "inbox", …)` + `assignTaskToProject`）。阈值与判定层与其余各区共用同一套（见 [todo/invariants](../todo/invariants.md) 第 5 条）。

- **升根回组不违反「子任务不持有归属指针」**：它是同一手势内的显式再入组写入，不是归属继承——落库层没有任何「记住原来属于谁」的字段。
- **三道守卫，方向不同，各自独立成立**：① `hoveredRootIdFromOver` 对 project 容器**比 `goalId` 而不只比 `kind`**（hand 是单例容器，比 kind 就够；项目区有 N 个容器，只比 kind 会放行跨组收纳，且拖到隔壁组的行上照样亮高亮、照样落库）；② 同一函数对 pool / parent 容器**拒绝项目区来源**——前一道挡「外区来源进不来」，这一道挡「组内来源出不去」；③ `resolveTodoDragWithIndent` 里 `canBecomeChild` 另有一道同判据的保险，防的是上游错传。②对 `parent:` 容器**放行同组、仍拒跨组**：判定层自己算不出「那个 `parent:` 容器的父在不在本组」，靠页面传入的入参告知（来路同 `activeParentProjectGoalId`——只有页面手上有这份信息）。因此同组另一个成员的子任务行也是合法收纳落点，跨组的仍然拒绝。
- **子任务拖到项目卡上有两种情形，容器 id 字符串逐字相同**：收件箱某任务的子任务拖过来（跨区的「先升根再入组」，**拒绝**）vs 组内子任务落回本组（**升根回组**）。判定层分不出，靠页面算好的 `activeParentProjectGoalId` 分流——它同时喂坞的关闭判据，页面只算一次。
- **`resolveTodoDragOperation` 里 `if (active.kind === "project") return null` 这道哨兵必须排在两条 project 分支之后**。挪到前面会把组内收纳短路成死代码——这条错法**天然静默**：返回值都是 null、行为「没变」，真机上只表现为「项目区的行拖了没反应」。守它的是 `todoDnd.test.ts` 的定向用例，挪位后从三个入口各红一条。**升根回组不在影响面内**：它的 active 是 `parent` 容器，够不到这道哨兵。
- **项目区整区不出投递坞**（含「父在项目组」的子任务）：本域不提供「拖出组」，退出项目走行内 × 按钮。机制同手头区，见 [todo/drag-dock](../todo/drag-dock.md) §1。
- **计数口径的连带**：收纳会让被收纳那条退出 `goal.members`，`memberCount` 因此**只减不增**，收纳永远撞不上 500 闸；标题三个数含子任务（[母文档](../project-zone.md) §3），所以收纳前后数字不变。

<a id="project-zone-row-dnd"></a>

### 3.1 组内行的 dnd 身份

组内行的 dnd id 是 `project-row:<goalId>:<taskId>`（`todoProjectRowIdPrefix` / `todoProjectRowId`），**不是裸 task uuid**。因为焦点轴与时间轴正交（[母文档](../project-zone.md) §1）：一条被抓到手头 / 排了今天的成员**同屏出现两次**——那个区一份、项目区一份。两处都用裸 id 会在 dnd-kit 里撞 id。

- **前缀形状不能写成 `project:<goalId>:<taskId>`**：`parseTodoContainerId` 会把它误解析成 `goalId = "<goalId>:<taskId>"` 的项目容器，静默拼出一个不存在的组；`preferProjectCollisions` 里的 `startsWith("project:")` 也会把行当成卡片。带 `-row` 的形状对两者都天然不匹配。
- **任务 id 一律从 `over.data.current.taskId` / `active.data.current.taskId` 取**，不拿 `active.id` / `over.id` 当任务 id 用。全部各区的行注册都带了 `taskId`，让「取任务 id」只有一条路。漏改的症状是「拖了没反应」而非报错——拿带前缀的 id 查任务恒为 null。
- **`hoveredRootIdFromOver` 的第二参收的是任务 id，非行落点必须传空串**。组卡片自己也是 droppable，它的 data 里没有 `taskId`；不早退就会把 `"project:g1"` 这个容器 id 当成根行 id 返回，下游拼出 `parent:project:g1` 这种垃圾落点（与坞那条守卫是同一类事故）。
