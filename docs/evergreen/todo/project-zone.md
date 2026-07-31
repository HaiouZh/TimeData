---
type: evergreen
title: 待办 · 项目区与归属轴
covers:
  - packages/client/src/lib/tasks/goalMembership.ts
  - packages/client/src/lib/tasks/projectZone.ts
  - packages/client/src/pages/todo/TodoProjectSection.tsx
last-reviewed: 2026-07-31
---

# 待办 · 项目区与归属轴

> 母主题：[todo](../todo.md)。
> 本文管的是**任务属于谁**——`Goal(kind="project")` 成员在待办页的分组投影、归属轴对收件箱的排他、归属变更的写入侧不变量，以及项目区的呈现契约。
> 目标实体本身（`Goal` schema、星图、未归类托盘）在 [goals](../goals.md)；焦点轴见 [todo/at-hand](at-hand.md)；重力见 [todo/gravity](gravity.md)。

## 承上启下

- **上游**：唯一输入是 `db.goals` 全表**裸行**（`listTasks` 每轮另读一次，刻意不过 `GoalSchema`，见 §2）与 `db.tasks` 的根任务。写入面都写同一份 `Goal.members`：goals 页的星图 / 未归类托盘、项目区成员行内的「退出项目」、项目标题行的 `+` 创建，以及 `⋯` 改名——经 `lib/goals.ts` 的成员/项目组合入口与 `updateGoal`（§4 的 touch 挂在这些归属通道上）。
- **下游**：`listTasks` 出桶时多产出 `TodoBuckets.projects`（分组投影）与 `goalLinkedIds`（绿竖条集合），并就地从 `buckets.inbox` 里扣掉 active project 成员。`TodoPage` 据此渲染 `TodoProjectSection`，再用 `projectChipIndex` / `goalBarTaskIds` 决定组外行（手头 / 今天 / 已排期）画项目名 chip 还是画绿竖条。排他改变的是 inbox 的**内容**，想法重力的水位线（`splitInboxByGravity`）作用在排他之后的 inbox 上——两者顺序不可换。
- **契约**：`TodoProjectGroup` 形状与分组投影落在 `lib/tasks/goalMembership.ts`（§2/§3 是它的语义合同）；呈现判定纯函数（`projectMemberState` / `sortProjectMembers` / `summarizeProjectGroup` / `projectChipIndex` / `goalBarTaskIds`）落在 `lib/tasks/projectZone.ts`，UI 侧合同见 §5。`Goal` 实体 schema 本身不归本文，见 [goals](../goals.md)。
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

1. 只收根任务（`parentId === null`），且 `recurrence === null && ruleId === null`——重复模板与 occurrence 不参与归属。
2. **排他与归集共用同一个布尔量**。这是红线：若排他单独判 `projectMemberIndex.has(id)`，一条被写进 `members` 的 occurrence 会既被归集守卫挡在项目区外、又被踢出收件箱，整条消失。
3. 未完成成员进 `group.tasks`；已完成成员**只折成计数**，不再保留 `Task[]`。`doneCount` 是全部已完成 task 成员数，供 `allDone` 和全完成标题行使用；`recentDoneCount` 是 `[now - 7d, now]` 闭区间内完成数，供标题行的「近 7 天 +M」使用。两者口径不同，不得互相派生。
4. `memberCount` 取 `goal.members?.length ?? 0` 的**原始数组长度**，含 track 成员与悬空 ref。它只服务 500 上限预警，不能用 `tasks.length + doneCount` 近似：后者只数可解析 task 成员，会漏掉真实容量占用。
5. 组间按**全部可解析成员（含已完成）**的 `max(updatedAt)` 倒序，并列按 `goal.createdAt` 倒序 —— 已完成成员参与排序键，故「某组全部完成」不会让它掉到末尾。
6. 组内未完成成员由 `sortProjectMembers` 排成「在手头 → 今天 → 躺着 → 已排期」。前三段内保持传入顺序（即 `listTasks` 的 `sortOrder`）；已排期段按 `scheduledAt` 升序。已排期沉底是刻意的：项目组展开是为了挑下一条能动手的，未来有主的先让位。逾期一次性任务由 `placementForTask` 回落 inbox，自然归入 idle 段，不单开逾期态。
7. 项目内 `+` 新建成功后，组件本地用 `recentTaskIds` 把新建的 idle 成员临时提到 idle 段顶部；这只是反馈层覆盖，不持久化、不改 `sortOrder`。
8. 查不到的成员 ref 直接丢弃、**不做清理**：悬空 ref 正是 goals 星图 ghost 节点的唯一数据源（见 [goals](../goals.md)）。但这些 ref 仍计入 `memberCount`，因为 500 闸看的是原始数组。
9. 零可解析 task 成员的目标不进项目区（纯 track 目标在星图里已有位置）。

## 4. 归属写入：同事务 touch + 单一归属

### 4.1 `assignTaskToProject` 是唯一收口单一归属的入口

`members` 没有跨目标唯一约束，一条任务可同时挂多个 active project。`assignTaskToProject(goalId, taskId)` 在**一个** Dexie 事务里「先摘后加」——遍历裸行找出持有它的其它 active project 逐个 `removeGoalMember`，再 `addGoalMember` 进目标组——使单一归属成为**写入侧不变量**。

- **摘/加复用既有两个函数而不是自己读改写**：它们已负担幂等、`prerequisites` 边清理、`goalLayoutPins` 回收、成员 touch + syncLog 四件事。Dexie 的嵌套事务在表是父集子集时并入父事务，故任一步抛错整包回滚。**没有外层事务会怎样是实测过的**：摘除已提交而加入失败 → 任务从两个组里同时消失，是静默的归属丢失。
- **目标组必须仍是 active project**（`status`/`kind` 双判，与读侧 `projectMemberIndex` 逐字同一个表达式）。缺这道闸时，目标组在另一端被归档/改 theme 后拖入会照常摘除、照常写入，而读侧只认 active project → 这条任务不再属于任何组。判据与读侧同源是构造性保证：**凡能被渲染成落点的组必然通过这道闸**。
- **只摘 active project**：theme 归属走绿竖条那条独立通道（§2），归档目标读侧本来就不认，摘它只是白写一行 syncLog。
- **读侧仲裁仍是长期承重件，不得当死代码删**：单一归属只在这一个入口上成立。归档组被**解档**（goals 页 5 处入口）、goals 页的 `addGoalMember`/`updateGoal({members})`、跨设备并发、存量数据、缺 `status` 字段的老行，都能重新造出多重归属。
- **摘除的连带删除是 schema 硬后果**：成员一走，源组里引用它的 `prerequisites` 边就非法（superRefine 要求 prerequisite 必须指向成员），不删则整行 parse 失败、整个目标从 UI 与同步里消失。所以它不是可选副作用。触发门槛在待办页降到了「手滑一拖」，故拖拽路径落库前用 `prerequisiteLossOnAssign` 先问一句（§6）。

项目标题行的 `+` 不直接改 `Goal.members`，而是走 `createTaskForProject(goalId, { title })`：先用 `buildNewRootTask({ toInbox: true })` 生成根任务，再在覆盖 `goals/goalLayoutPins/tasks/tracks/syncLog` 的外层事务里 `insertNewTaskInCurrentTransaction`，随后调用 `assignTaskToProject`。因此 active project 闸、任务侧准入、500 上限、先摘后加、touch 与 syncLog 仍只有一份实现；任何一步失败都会回滚任务 create 与目标成员更新，不留下孤立任务。

### 4.2 归属变更同事务刷新成员任务 `updatedAt`

`lib/goals.ts` 的 `addGoalMember` / `removeGoalMember` / `updateGoal` / `deleteGoal` 在同一 Dexie 事务内调用 `touchTasksInCurrentTransaction`，刷新归属发生变化的成员任务并各记一条 `syncLog`。

原因是重力沉降按 `task.updatedAt` 年龄判定（`isTaskSunken`）：任务失去归属会回落收件箱，不刷新就按旧时间戳参与水位线判定、直接沉进默认折叠的水下区，体感是「退出项目 = 任务消失」。释放通道有四条（`status→archived`、`kind→theme`、`members` 整包替换、删除目标），`updateGoal` 用**前后归属差集**（`releasedProjectTaskIds`）统一覆盖前三条而非逐条特判；`addGoalMember`/`removeGoalMember` 的幂等早退分支**不 touch**（否则重复点一下就把任务从水下顶上来）。

这是**本机副作用、不是跨设备不变量**——入站 sync apply 按域写单表、无跨域钩子，其它设备改归属不会 touch 本机 task 行。故项目区必须完全由 goals 推导，不得依赖 task 行上的反向标记。

## 5. 呈现契约

- **位置**：收件箱正上方（两种布局都是）。零 active project 时整区不渲染。
- **组三态**：0 可解析成员 → 不进项目区；有成员且全部完成 → `已完成 · M 条` + 「去归档」深链 `/goals/:id`；有未完成 → `还剩 N`，若近 7 天有完成则追加 `· 近 7 天 +M`。`+0` 不画，长期项目不再显示总数分母。全完成态**不特殊置顶**（置顶会让已完成项目抢占进行中项目的注意力）。
- **组内已完成不再渲染**：已完成成员退出组内列表，标题行只回答「总共完成多少」与「最近推进多少」。当前没有等价的项目内已完成清单；低频出口是更多菜单的「在 goals 页打开」。
- **内容区限高**：展开态内容区使用 `max-h-[45vh] overflow-y-auto`，限高加在内容区而不是组块外框。外框仍是 droppable 落点，内容区限高让落点 rect 有界且稳定，收件箱（唯一拖入源）不再被大组推出视口。已知限制：落点反馈滚到组外框，不保证滚到内部那条成员；语义仍是「告诉你它在哪个组」。
- **标题行操作**：未全完成组显示 `+`，点击后展开组并在内容区顶部显示就地输入框；Enter 以 trim 后标题调用 `createTaskForProject`，成功清空输入并保持打开，Esc 关闭。全完成组不显示 `+`，仍显示「去归档」。所有失败由页面 action toast 报原因，输入框保留草稿；筛选激活时，创建成功但新任务不匹配筛选条件会提示「任务已创建，但当前筛选未显示它」，写入结果不受筛选影响。
- **更多菜单**：每组标题行有 `⋯`（Phosphor `DotsThree`，role=menu/menuitem），提供「改名」与「在 goals 页打开」。菜单沿用 QuickNoteActionMenu 的交互：打开时首项聚焦，Escape / 外点关闭并把焦点还给触发按钮；菜单按钮和输入框点击不得穿透成展开/折叠。改名走 `updateGoal(id, { title })`，空标题不提交、失焦/Escape 恢复原名；打开目标跳 `/goals/:id`。
- **上限预警**：`memberCount >= Math.ceil(GOAL_MEMBERS_MAX * 0.9)` 且组未全完成时显示轻量「接近上限」提示。阈值从上限推导，不写死 450；预警不改变写入行为，真正撞线仍由 `ProjectAssignError("full")` 拒绝。
- **展开态记忆**：组件内 `Map<goalId, boolean>` 覆盖表，不持久化。无筛选时默认全折叠，展开由用户点击或 `revealGoals`（落点反馈 / chip 回跳）驱动；筛选激活时匹配组强制展开，但不改写覆盖表，清除筛选后恢复用户偏好。曾有一档「存量提示条未读时首次全展开」，2026-07-27 随提示条一并退役。
- **成员状态点**：`projectMemberState` 判四态——`at-hand`（焦点轴优先于时间轴）/ `today` / `scheduled` / `idle`。`idle` 是默认多数态，渲染层不画胶囊：没有胶囊本身就是答案。**没有「逾期」态**：`placementForTask` 只对重复模板与 occurrence 给 `overdue`，一次性任务过期会被退回 `inbox`，而项目区的归集守卫恰好把前两类挡在门外——项目区成员拿不到 overdue。
- **项目名 chip**：只出现在**手头 / 今天 / 已排期（含水下尾）**。它与绿竖条**不得同屏**——chip 说得出是哪个项目（携带该项目的身份色）、点得开，竖条只说「有去处」（全场同一个绿），同屏出现时后者是前者的冗余——`goalBarTaskIds` 把有 chip 的行从竖条集合里裁掉，竖条退回只表达 theme 归属。chip 需 `relative z-20` 才能压过行左 2/5 的 `z-10` 拖拽 activator。裁剪后的 `goalLinkedIds` 同时也喂给了翻牌区 / 水下收件箱 / 收件箱这三个**不渲染 chip** 的分区，看着像多裁了，其实零语义损失：「chip 集合 ∩ 收件箱 = ∅」是**构造性**成立的——`projectChipIndex` 的输入是 `buckets.projects`，而它与 inbox 排他共用同一个 `ownedByProject`（§3 第 2 条），进得了 chip 索引的就一定进不了 inbox——这行不是笔误。chip 与组卡片标题行各画一个同色圆点，色取自 `TodoBuckets.projectTints`（集合内避撞分配，见 [design-language](../design-language.md) §1），构成「点↔点」的同一项目认同；两处都不自行取色——避撞只有拿着全部 active project 才算得出，组件手上只有显示出来的组；组卡片不另加左侧色条——同一张卡片上两个颜色信号与本条的「chip / 竖条不得同屏」是同一条裁剪规则。
- **退出项目**：行内动作调 `removeGoalMember`，任务浮在水上回落收件箱。组内最后一条成员退出后 **Goal 保留不自动归档**（归档是 goals 页的显式动作）。
- **落点反馈**：排他打开后「回到 inbox 池」不再等于「出现在收件箱」——项目成员会落进项目区里一个默认折叠的组，而组 header 的「还剩 N / 共 M」本来就把它算在内、数字纹丝不动，全屏零反馈，体感是「任务凭空消失」。故凡是让成员回落 inbox 池的路径，动作后都要复用 chip 的回跳机制（`revealProjectHome`）展开它的归属组并滚过去：行尾/左滑「回收件箱」、拖进 `pool:inbox`、移出手头、子任务升根、详情抽屉改「重复与时间」、取消勾选。**「拖入项目」不在此列**——它是把成员送**进**组、不是回落 inbox 池，落点就在手指下方，自动展开反而会在连续拖入第二条时改变布局；它的反馈走 toast（§6）。
  - **判据只在 `revealProjectHome` 一处判，入参是写入后的 `Task`**。调用方各自判必然分裂成「动作前的行 / 拖拽意图 / `choice.kind`」几种口径，每种都漏一半（详情抽屉尤其：`choice.kind === "none"` 漏掉「仅某天」选到过去日期那支，又误报已完成 / 在手头的任务）。三道闸：① 归集守卫里 placement 判不出的两条（子任务、`ruleId` 非空的混合体行——它们 scheduledAt 为空照样被判 inbox，但投影层根本不收，展开的是不含它的组）；② 焦点轴压过落点（`listTasks` 把未完成的手头成员截进 `atHand` 并 `continue`，它在页面最顶上、本来就看得见）；③ `placementForTask(...).pool === "inbox"`。`done` 与 `recurrence` 不必单列——placement 首行就把它们判成 `completed` / `today`·`recurring`；**已完成成员现在只计入标题行计数、组内没有可展开行，展开组也看不到它，给的是错误指认、比零反馈更糟**，正是靠 placement 这一支挡住。
  - **写入失败不反馈**：详情抽屉的 `onTimeChanged` 只在写入成功时报，交出去的是写入结果。若不管成败都报，任务被并发删除时会一边弹错一边把页面滚去展开一个空组（查归属认 `members` 原始事实，不校验 task 行还在不在）。
  - 查归属分两级：先查 `projectChipIndex`（渲染期闭包，覆盖"动作前就是未完成根成员"的情形），未命中再 `findActiveProjectGoalIdForTask` 读一次库——**子任务不在任何客户端投影里**；已完成成员现在只计入 `doneCount`、不在 `projectChipIndex`，两者都得查库才补得上归属。查库要 `catch` 后静默降级：`TaskRow` 的 `onToggle` 是裸调用，抛出去没人接。
  - **reveal 是待消费意图，不是脉冲**：`revealProjectHome` 只等一次 `db.goals.toArray()`，而项目区要等整轮 `listTasks` 才产出新组，前者几乎必然先落——若置位后立刻消费，那一帧 `rowRefs` 上还没有节点，`scrollIntoView` 静默跳过且永不重试（展开那一半却生效了，成了「展开了但没滚到」）。故宿主持一份待消费 `goalId` **集合**（单槽会被 React 自动批处理合并、丢掉先置位的那个），组件只消费**这一帧真的渲染出来**的组、其余留到下一轮 `groups` 变化时补上，消费后回报宿主清空。**清空是硬要求**：不清的话，跨 1024px 断点时项目区整棵重挂（换了父容器），mount effect 会把上一次的意图重放一遍——用户手动折叠的状态丢失、页面被滚走。
- **项目区标签与搜索筛选（`filterActive`）**：项目区支持全域标签与关键字筛选。当筛选激活时，项目组内部按筛选规则过滤任务，包含匹配任务的项目组自动展开，无匹配任务的组隐去；筛选期间收到的 `revealGoals` 仍会滚动并消费，但不写入展开覆盖表，筛选清除后恢复用户原有的折叠/展开偏好。零 active project 时整区仍不渲染；有 active project 但全部组均无匹配任务时显示项目区空态。手头区（AtHand）维持焦点隔离，不受筛选影响；`tagOptions` 的来源包含项目区成员。
- **存量提示条已退役**（2026-07-27）：排他上线时收件箱顶部那条「N 条任务已归入 M 个项目」连同它挂着的「首次默认展开」一起删除，`ProjectZoneIntroBar`、`timedata_todo_project_zone_intro_dismissed` 与两个 `workbenchPrefs` 读写函数均已移除。**没有替代物**——排他语义已被用户吸收，不需要常驻解释。老浏览器里的残留 localStorage 值不再被任何代码读取。

## 6. 拖拽归入（动作二）

从**今天 / 收件箱**把根任务拖到项目组上 = 归入该组。落点判定表与容器域在 [todo](../todo.md) §DnD；这里管归属侧的契约。

- **落点是整个组块**（标题行 + 展开态内容区），不是只有标题行：展开后标题行仅一行高、下面是一整片列表，只认标题行在展开态几乎瞄不准。组内不做用户自定义重排、组内行也不注册 sortable（`TaskList` 不传 `sortable`/`containerId` → 不渲染拖柄），因此整块当落点没有落点竞争。`useDroppable` 落点共两族：本处（id `project:<goalId>`）与宽屏投递坞的药丸（id `dock:*`，见 [todo](../todo.md) §3.14），与其余 droppable（全部来自 `useSortable`，id 是 task uuid）不可能相撞——**同一条今天区任务确实同屏出现两次，但项目区那一份零 dnd 注册**。
- **碰撞策略必须让项目卡优先**（`preferProjectCollisions`）。页面用 `closestCenter`，它按 droppable 矩形**中心点**算距离，而展开的项目卡是几百像素高的大块、中心离手指很远，会被隔壁收件箱某一行抢走落点——整块 droppable 在展开态近乎失灵。故指针真落在项目卡内时只认它，否则原样退回 `closestCenter`；宽屏投递坞的药丸浮在列表之上，坞命中又优先于项目卡（[todo](../todo.md) §3.14）。`fallback` 传 thunk：指针已落在卡内时 `closestCenter` 的结果注定被丢弃，没必要每帧遍历全部 droppable。**已知限制**：键盘拖拽没有指针坐标，`pointerWithin` 恒空 → 走 fallback，项目组在纯键盘下仍难命中。
- **对缩进系统让位**：横向位移触发的缩进判定与「拖进项目」共用同一次手势，`canBecomeChild` 优先于目标容器。两道闸——`hoveredRootIdFromOver` 对 `project:` 容器恒返回 null，且 `canBecomeChild` 显式排除 project——第二道在当前调用路径上不可构造，是明写的防御闸。没有它，斜着拖进项目会被判成 `move-to-parent`（拆/接父子关系）。
- **准入四拒，判在两处，不重合**：
  - **子任务 / 重复待办**由**页面**判（`dragDropBlocked`），给悬停禁止态。子任务这一支**必须从 dnd 容器 id 认**（`parent:` 前缀）：`listTasks` 主循环第一行就跳过 `parentId !== null` 的行，子任务不在任何 bucket 里，按 task 查恒为 null——`activeParentId` 同理恒为 null，不能用它判。
  - **满员 / 目标组失效**由**写入侧**抛（`ProjectAssignError`），组件判不了：它手上只有 `TodoProjectGroup`，既无 `goal.status`/`kind`，也无 `members` 数组长度（500 闸看的是含 track 成员与悬空 ref 的整个数组，拿可解析成员数近似会撒谎）。
  - 因此存在一个**刻意窗口**：组在拖拽途中于另一端被归档时仍显示「可落」高亮，松手才弹拒绝。它换掉的是「高亮 → 静默吞掉归属」，方向是净改善。
- **成功也要给反馈**（`已归入「X」`）。组间排序键是组内成员 `max(updatedAt)`（§3 规则 5），而归入恰好刷新它——**目标组必然跳到项目区第一位**。「不展开组」挡不住这种布局变化：三张折叠卡外观一样，用户按视觉位置拖第二条就会落进别的组，且成功路径若无反馈，误归入几乎不可见（组不展开、任务同时因排他从收件箱消失）。
- **拒绝也要说原因**。子任务那支走的是 `resolveTodoDragOperation` 返回 null 的路径，`handleDragEnd` 在 `if (!op) return` 就早退了，toast 分支根本到不了，必须在早退处补。无声失败会被读成「应用坏了」。
- **兜底 toast 不可省**：目标组的裸行过不了 `GoalSchema.parse` 时抛的是 `ZodError` 而非 `ProjectAssignError`。红线「读裸行不 parse」保证这种组**照常渲染成落点**，用户拖多少次都一样——静默吞掉等于应用坏了。文案要中性（真正坏掉的常是任务**原来所在**的源组，指认目标组会让用户换组反复重试）。
- **前置边确认**：`prerequisiteLossOnAssign(taskId, nextGoalId)` 读裸行算出「摘除会连带删掉几条边、来自几个组」，非空则落库前 `useConfirm` 问一句。判据与 `removeGoalMember` 内那句 filter 同源（跳过目标组自身、只认 active project、`blocker`/`blocked` 双侧）。多源组时文案只说组数与总条数、不点名（`count` 是各组之和而 `goalTitle` 取边最多那组，点名会把总数栽给单个组）。**它在准入闸之前调用**，故满员/归档/occurrence 等被拒场景会「先警告后失败」——方向是过度警告，不是数据丢失。

## 7. 多选建组 / 批量归入（动作一）

页面级模式态 `selectionMode`：从收件箱勾一批，圈成新项目、或整批放进已有组。

- **入口**在收件箱标题右侧常驻（`CollapsibleSection` 的 `action` 插槽），零 active project 时也在——那正是冷启动入口。插槽的拦截用 **`preventDefault` 而不是 `stopPropagation`**：`<summary>` 的折叠是浏览器对 `details` 的**默认行为**（activation behavior），在事件派发结束后才执行，不经 React 冒泡，`stopPropagation` 对它完全无效。代价是包裹层会吃掉内部所有点击的默认动作，故 **action 里只放按钮、不放 `<a>` 或 `type="submit"`**。
- **可选范围 = 收件箱的三处渲染点**（浮动区 / 水下尾 / 重力翻牌区），三处都要显式接 selection 三 prop，不能混进 `...rowHandlers` 让它自己流过去。水下的陈年任务恰恰最该被圈——归组会 touch `updatedAt` 让它当场浮上水面（§4.2），这一下就是整理的即时回报。
- **不做禁选态**：`listTasks` 主循环三处早退保证 inbox 桶只含 `parentId === null && recurrence === null && ruleId === null` 的根任务（子任务首行 `continue`；重复模板走 `if (t.recurrence)` 进 scheduled；occurrence 必带 `scheduledAt`，落 today/upcoming）。准入闸仍留在写入侧兜底，但 UI 上没有可禁的行。
- **进多选顺带展开收件箱**（`setInboxCollapsed(false)`）。入口挂在 `<summary>` 里、与 `<details open>` 无关，而折叠状态是持久化的：折叠着点进去，全页其余区块变灰 `inert` + 底部「已选 0 条」操作栏，收件箱却还收着，一条可选行都看不见，第一眼是「模式坏了」。**只写 localStorage 不够**：`<details open>` 是 React 的受控值，用户在页面里手动折叠只改 DOM 与 localStorage、不触发重渲染，React 手上仍是上一次渲染的 `true`；这时再写一次 localStorage，下一帧算出的 `open` 还是 `true`，React 判成「没变」、根本不碰 DOM。故收件箱的展开态在 `TodoPage` 另存一份 state（`inboxOpen`），开合两处都写，localStorage 只管跨会话持久化。代价是把用户的折叠偏好改成展开——可以接受，他点「圈成项目」就是要看收件箱。
- **其余区块用 `inert` 而不是 `pointer-events-none`**：后者只挡指针，Tab 键照样聚焦进去、回车照样开详情，而那正是多选中最容易误触的路径。窄屏与宽屏两套布局**各包一次**，漏一处那种屏幕下模式态形同虚设。**包装层恒定存在，进出多选只切 `inert` 与 className，绝不切元素类型**——换类型会让 React 在这个插槽上卸载重挂整棵子树，`TodoProjectSection` 的组展开态（组件本地 state）每次进/出多选全部清空，建组成功时表现为「新组展开」被「其余全塌」的布局跳动淹掉。空区块（无已完成任务 / 无项目组）由此多出的 flex 子项靠 Tailwind `empty:hidden` 消掉，前提是那层里**一个节点都没有**，塞任何占位内容 `:empty` 就不匹配、`gap-4` 的 16px 会静默回来。
- **多选态下行右端的悬停动作条整条关掉**。多选是「圈一批」的模式，单条处置在这个模式里没有位置；更要紧的是整行就是勾选命中区，用户往右点必然压到「排进今天」上——任务离开收件箱 → 被 §7.1 的剪枝踢出选中集（无提示）→ 落进一个 `opacity-40` 且 `inert` 的区块 → 多选态里再也弄不回来（「抓到手头」更重，它顺带开/换了一个活跃会话）。与 `TaskList` 关掉拖拽（`canSort`）和滑动（`blockSwipe`）是同一条理由的三处落点，改一处要想到另外两处。
- **Esc 要让位给弹窗**。`Sheet` 与 `TaskDetailSheet` 的 Esc handler 同样挂在 window 上、与多选那条互不知情，同一次 keydown 两个都会跑——用户想关弹窗，选了半天的那批一起没了，**而退出后的页面和「成功建组」长得一模一样**（操作栏消失、记录框回来），只少一条 toast。判据用 `[role="dialog"]` 在场而不是给 `useConfirm` 加 `isOpen`：能与多选同屏的弹窗不止确认框，按 hook 逐个开洞会漏。
- **底部避让量按「此刻谁站在底部」算**，不能按 composer 算。多选态下 `TodoComposer` 不渲染而 `TodoSelectionBar` 顶上，若沿用 `composerHiddenByScroll` 那套，滚动隐藏底栏时避让归零、toast 落进操作栏的盒子被完全遮住——而多选态下 toast 是**唯一**的失败反馈通道（提交失败刻意不退出多选、只靠它说原因），压住就等于「点了没反应」。同款问题 `QuickNotesPage` 的 `bottomInsetPx` 早处理过。
- **「放进…」的组列表选完即收**。操作栏与 toast 容器同为 `z-backdrop` 且它在 DOM 里排其后 → 后绘制的它赢，而列表向上展开、不透明、最高 `max-h-60`，正铺在 toast 那条带上。列表只由用户点「放进…」切换、不会自己收，等他合上时 6 秒的 toast 早已消失——纯粹的「点了没反应」。**z 层级解决不了这件事**：那会把「列表要盖住页面」与「toast 要盖住操作栏」这两个各自自洽的决定改成互相打架的两个数字。

### 7.1 `selectedIds` 必须跟着可选集合剪枝

选中集只存 id，而 `useLiveQuery` 回流不会通知它。不剪枝就会攒出**幽灵 id**：在多选态里勾完成一行（复选框在多选态下仍是「完成」，是刻意的）、另一端同步下来一条删除、或另一端把这行收进某个 project 组，那行离开收件箱而 id 还攥在手上 → 操作栏说「已选 2 条」屏幕上只剩 1 行 → 提交时 `db.tasks.get` 拿不到人，抛的是裸 `Error` 不是 `ProjectAssignError`，落进兜底文案；而失败**不退出多选**，用户原地重试、每次都失败，屏幕上没有任何东西指向那个幽灵。

- **剪枝源照着渲染点写**（`floatingInbox ∪ sunkenInbox`），不能用 `buckets.inbox` 代替：此刻两者恒等，但将来哪一处渲染改了口径（比如水下尾不再可选），剪枝会跟着变而 `buckets.inbox` 会静默继续放行，那正是幽灵回来的方式。
- **取未经 `f()` 筛选的列表**：筛选是临时视图，不该让"筛一下"丢掉选中；何况多选态下 composer 不渲染，用户根本改不了筛选条件。
- **防死循环靠 updater 内「真的少了东西才换引用」**，不靠依赖数组——那个 Set 每次渲染都是新引用，写进依赖数组也是每渲染必跑，只是多骗一层。
- 剪掉的**不是**「已完成任务不能当成员」（它可以，§3 规则 4 的 `doneCount` 就是数它），剪掉的是「用户没在看的东西别替他提交」。

### 7.2 两个写入入口，单事务，全成全败

| 入口 | 事务内容 |
|---|---|
| `createProjectWithMembers({title, taskIds})` | `db.goals.add` + 一条 goals create syncLog → 转交下一行 |
| `assignTasksToProject(goalId, taskIds)` | 目标组 active+project 校验（一次）→ 摘旧组 → 加入 → 成员 touch |

- **500 上限判在整批之上**（`members.length + 新增数 > 500`），不是逐条问「已经满了吗」——逐条判要到第 501 条才抛，而前 500 条已经写进去了，与「全成全败」直接矛盾。为此把 `projectAssignBlock` 拆成 `taskAssignBlock`（任务侧三条件）+ `exceedsGoalMemberCap(memberCount, addCount)`（容量），单条入口传 `addCount=1`，两个口径同源不漂。
- **`taskIds` 入口去重**。`existing` 是循环外快照、不随写入更新，重复 id 会让新增数多记，恰好卡在边界时误报满员；`addGoalMember` 的幂等只挡重复写 members，管不到容量判定。不能外包给调用方——撞 `.max(500)` 不是报错，是整行 parse 失败、整个 goal 从 UI 与同步里消失。
- **建组也走摘除路径**，不因「收件箱里的任务必无 project 归属」而跳过：摘旧组 / 准入闸 / 容量 / touch 只有一份实现，将来改归属语义不会漏掉建组这一侧。
- **不做「能进多少进多少」**：部分成功会留下「选了 6 条为何只进去 4 条」的哑谜，而撞 500 在真实使用里近乎不发生。
- **提交要有在途闸**（ref 不是 state——state 要等一次渲染，同 tick 第二发读到旧值），且覆盖异步全程含确认框。没有它，在项目名输入框里**按住回车**（系统自动重复约 30ms 一发）会建出两个同名 goal，第二个把成员从第一个摘走、留一个空壳组 + 一条推给别的设备的 create 日志。

### 7.3 批量路径的前置边确认只剩一个窄窗口

归属轴排他的判据与 `prerequisiteLossOnAssignMany` 取源组的判据逐字相同（`status === "active" && kind === "project"`），叠上 §7.1 的剪枝——「选中项带 project 归属」在常规时序下**不可能成立**，确认框恒不弹。

仍然保留，因为剩一个真窗口：远端 goal 行**已落进 Dexie**、而 liveQuery 通知与剪枝 effect 还没跑完，用户恰在这几毫秒里松手。此时选中集还是旧的，而预测函数读的是最新库——该弹，不问就是静默丢边。**承重在数据层**（`goals.test.ts` 的 `prerequisiteLossOnAssignMany` 一节）；页面这一段测不了，jsdom 里 `act()` 会把渲染和 effect 一口气跑完。**它不是死代码。**

调用点必须**在两条提交路径的 `try` 之内**：它第一句就是 `db.goals.toArray()`，DatabaseClosed / 版本升级期会 reject，而提交是 `void submitXxx(...)` 发出的——留在 try 外既不进兜底 toast 也没人接这个 rejection，用户只看到「点了没反应」。用户点「取消」返回的是 `false` 不是异常，在 try 里照旧原地返回，不会被兜底 toast 当成错误。

## 8. 模块速查

| 入口 | 职责 |
|---|---|
| `lib/tasks/goalMembership.ts` | 读侧两份索引与分组投影：`goalLinkedTaskIds`（全 kind active）/ `projectMemberIndex`（active project）/ `buildTodoProjectGroups`（未完成列表、`doneCount`、`recentDoneCount`、原始 `memberCount`、组间排序键、同挂多组的仲裁）/ `GOAL_MEMBERS_MAX` 与 `isProjectMemberCountNearCap` |
| `lib/tasks/projectZone.ts` | 呈现判定纯函数（不碰 db / React，落 node 快桶）：`projectMemberState` 四态 / `sortProjectMembers` 四段排序与 recentTaskIds 覆盖 / `summarizeProjectGroup` 组三态计数 / `projectChipIndex` / `goalBarTaskIds` 竖条裁剪 |
| `pages/todo/TodoProjectSection.tsx` | 项目区 UI：受控展开的组 header（`revealGoals` 待消费意图 → 组渲染出来才展开 + `scrollIntoView`，并经 `onRevealConsumed` 回报宿主清空）、成员行「当前在哪」胶囊与「退出项目」、内容区限高、`+` 项目内创建、`⋯` 改名 / 跳 goals、90% 上限预警；同文件另导出 `ProjectNameChip`（组外行的项目名 chip） |
| `lib/tasks.ts: listTasks()`（归 [todo](../todo.md) covers） | 归集与排他的同源判据 `ownedByProject`、`buckets.projects` 出桶、`goalLinkedIds` |
| `pages/TodoPage.tsx`（归 [todo](../todo.md) covers） | 接线：项目区挂收件箱正上方（宽窄两种布局）、chip → `openProject` 回跳、成员回落 inbox 池时 `revealProjectHome`（唯一落点判据 `landsInCollapsedProjectGroup`，六条路径一律传写入后的 `Task`）、`exitProject` → `removeGoalMember`、`tagOptions` 纳入项目区成员 |
| `lib/goals.ts`（归 [goals](../goals.md) covers） | 写侧四条归属通道 + `touchTasksInCurrentTransaction`（§4.2）；`assignTaskToProject` 单事务先摘后加（§4.1）+ `ProjectAssignError`；`createTaskForProject` 组合项目内创建；`prerequisiteLossOnAssign` 只读预测（§6）；批量版 `assignTasksToProject` / `createProjectWithMembers` / `prerequisiteLossOnAssignMany`（§7.2、§7.3） |
| `pages/todo/TodoSelectionBar.tsx` | 多选态底部操作栏：已选计数、项目名就地输入（回车即提交，`disabled` 挡不住回车故另有早退闸）、「放进…」组列表、取消。零业务依赖，数据全走 props、动作全走回调 |
| `pages/todo/CollapsibleSection.tsx` | 通用折叠区块；`action` 插槽渲染在 summary 内并 `preventDefault`（§7），16 个调用方不传即行为不变 |
| `pages/todo/todoDnd.ts`（归 [todo](../todo.md) covers） | `project:<goalId>` 容器域与 `assign-to-project` 操作、对缩进系统让位、`preferProjectCollisions` 碰撞策略（§6） |

测试：`lib/tasks/goalMembership.test.ts`（两份索引口径、分组投影、近 7 天窗口上下界、`memberCount` 原始口径、组间排序、同挂多组仲裁、悬空 ref、上限阈值）、`lib/tasks/projectZone.test.ts`（成员四态、组计数、四段排序、recentTaskIds 覆盖、chip 索引、竖条裁剪）、`lib/tasks.test.ts`（`describe("listTasks projects 桶")`：归集/排他同源、手头正交、重复模板与 occurrence 挡在门外、组内排序接线）、`pages/todo/TodoProjectSection.test.tsx`（组展开折叠、标题文案、状态胶囊、退出项目、已完成零渲染、限高结构、`+` 创建输入、`⋯` 菜单、改名、上限预警、`revealGoals` 消费与「组还没渲染出来就留着、出现后补上」、chip）、`pages/TodoPage.test.tsx`（页面级：排他后成员离开收件箱、项目内创建成功/满员拒绝、菜单改名和跳转、零 project 不渲染、chip 回跳、回收件箱后展开归属组、红线 3 竖条不同屏，以及落点判据的三条反向用例——手头区取消勾选 / 抽屉清时间但已完成 / 抽屉选未来某天都**不**展开，外加「抽屉→页面」这根线本身）、`lib/goals.test.ts`（`createTaskForProject` 的同事务成功/满员/失效目标/裸行解析失败回滚，`describe("归属变更同事务刷新成员任务 updatedAt")` 与 `describe("assignTaskToProject")`：单一归属先摘后加、theme/归档组不被摘、目标组失效被拒、准入四拒、幂等重入不动钉点、事务原子性）。

多选的用例分三层：`pages/todo/TodoSelectionBar.test.tsx`（计数、命名必填与 trim、回车两条路径、「放进…」列表、零项目时不渲染该按钮）、`pages/todo/TaskRow.test.tsx` 与 `TaskList.test.tsx`（行点击/Enter/Space 三种勾选路径、复选框在多选态下仍是「完成」、内层控件上按键不连带勾选、多选态不渲染拖柄与禁滑）、`pages/TodoPage.test.tsx`（进出多选、三处渲染点可选、其余区 inert 且窄屏宽屏**各一条**、Esc 退出与「有弹窗时让位」、建组/批量归入成功、满员拒绝、兜底文案两侧、剪枝四条、在途闸两条）。`lib/goals.test.ts` 覆盖批量写入的原子性（全成全败、撞 500 一条不写、摘除闸的 `status`/`kind` **各一条**、去重占位、`prerequisiteLossOnAssignMany` 的边去重与源组口径）。

拖拽归入的页面级用例在 `pages/TodoPage.test.tsx`（成功 toast、子任务拒绝 toast、禁止态三支、确认弹窗取消/确认两路）。**它们的落点稳定性依赖一条实现细节**：jsdom 里 rect 全为 0 → `closestCenter` 全部并列 → dnd-kit 取 `droppableContainers` 的**挂载顺序**第一名（不是 DOM 顺序）。键盘拖拽无指针坐标，`preferProjectCollisions` 在这些用例里一次都没生效。**在项目区之前新增任何 droppable，这几条会以超时报红**——那是响亮失效不是 flaky（原委记在 `keyboardDrag` 上方的注释里），加重试只会把它埋掉。

## 9. 当前的归属路径边界

**只有 `pool:today` / `pool:inbox` 两个拖拽源能归入项目**——已排期（非今天）与手头的任务没有归入路径，绕法是先清日期或等它到期。

归档 Goal 不弹「N 条未完成任务将回到收件箱」提示：归档是 toggle，5 处入口都无确认（属 goals 页的呈现范围）；数据安全由 §4 的 touch 兜住，不依赖提示。
