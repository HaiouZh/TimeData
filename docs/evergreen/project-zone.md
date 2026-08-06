---
type: evergreen
title: 项目区与归属轴
covers:
  - packages/client/src/lib/tasks/goalMembership.ts
  - packages/client/src/lib/tasks/projectZone.ts
  - packages/client/src/pages/todo/TodoProjectSection.tsx
contracts:
  - packages/client/src/lib/tasks/projectZone.ts
  - packages/client/src/lib/goals.ts
last-reviewed: 2026-08-06
---

# 项目区与归属轴

> 邻居：[todo](todo.md) 讲 Task 字段、四分区落点与待办主流程；本文讲项目区这条独立归属轴。
> 本文管的是**任务属于谁**——`Goal(kind="project")` 成员在待办页的分组投影、归属轴对收件箱的排他、归属变更的写入侧不变量，以及项目区的呈现契约。
> 目标实体本身（`Goal` schema、星图、未归类托盘）在 [goals](goals.md)；焦点轴见 [todo/at-hand](todo/at-hand.md)；重力见 [todo/gravity](todo/gravity.md)。
> 多选建组 / 批量归入（动作一）是一条独立读者路径，归纵切子文档 [project-zone/multi-select](project-zone/multi-select.md)；本文管其余三节：投影与写入、拖拽归入（动作二）、组内父子收纳（动作三）。

## 承上启下

- **上游**：唯一输入是 `db.goals` 全表**裸行**（`listTasks` 每轮另读一次，刻意不过 `GoalSchema`，见 §2）与 `db.tasks` 的根任务。写入面都写同一份 `Goal.members`：goals 页的星图 / 未归类托盘、项目区成员行内的「退出项目」、项目标题行的 `+` 创建，以及 `⋯` 改名——经 `lib/goals.ts` 的成员/项目组合入口与 `updateGoal`（§4 的 touch 挂在这些归属通道上）。
- **下游**：`listTasks` 出桶时多产出 `TodoBuckets.projects`（分组投影）与 `goalLinkedIds`（绿竖条集合），并就地从 `buckets.inbox` 里扣掉 active project 成员。`TodoPage` 据此渲染 `TodoProjectSection`，再用 `projectChipIndex` / `goalBarTaskIds` 决定组外行（手头 / 今天 / 已排期）画项目名 chip 还是画绿竖条。排他改变的是 inbox 的**内容**，想法重力的水位线（`splitInboxByGravity`）作用在排他之后的 inbox 上——两者顺序不可换。
- **契约**：`TodoProjectGroup` 形状与分组投影落在 `lib/tasks/goalMembership.ts`（§2/§3 是它的语义合同）；呈现判定纯函数（`projectMemberState` / `sortProjectMembers` / `summarizeProjectGroup` / `projectChipIndex` / `goalBarTaskIds`）落在 `lib/tasks/projectZone.ts`，UI 侧合同见 §5。`Goal` 实体 schema 本身不归本文，见 [goals](goals.md)。
- **邻居**：[goals](goals.md)（`Goal` schema、`members` 的第一个写入面、悬空 ref 的 ghost 节点）、[todo](todo.md)（Task 字段全貌与四分区落点）、[todo/at-hand](todo/at-hand.md)（焦点轴与归属轴正交，故归集必须早于手头的 `continue`）、[todo/gravity](todo/gravity.md)（水位线按 `updatedAt` 判定，是 §4 的 touch 存在的直接原因）、[sync](sync.md)（touch 是本机副作用而非跨设备不变量，且属「非用户直接编辑」的批量写入）。

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
3. 未完成成员进 `group.tasks`；已完成成员**只折成计数**，不保留 `Task[]`。**标题行的三个数都含子任务**（与 [todo/at-hand](todo/at-hand.md) 的 `atHandPendingTotal` 同源）——把几条活收成父子只是整理结构，活一件没少，数字就不该跟着掉。子任务不在任何投影桶里（`listTasks` 主循环按 `parentId` 早退），故由 `listTasks` 另建 `parentId → 子任务[]` 索引交给 `buildTodoProjectGroups`，`skipped` 一律剔除：
   - `pendingChildByMember` 是**未完成成员 id → 它名下未完成子任务数**的表，只收未完成成员，与 `atHandPendingTotal` 的 `pendingRootIds.has(t.parentId)` 逐字同源。标题的「还剩 N」由 `summarizeProjectGroup` 按 `group.tasks` 逐个查表求和得出。**刻意不是一个加总好的标量**：筛选激活时页面裁剪 `tasks`（`filteredProjects`），而标量结构上不可能跟着裁，「还剩 N」就会把看不见的成员名下的子任务算进去、用户展开组数不出 N。分桶后求和发生在消费端，裁剪自动生效。
   - `doneCount` / `recentDoneCount` 反过来数**全部成员**名下的已完成子任务。**两侧刻意不对称，不是笔误**：前者答「展开组你还能数出几条」，而已完成成员在组内不渲染，把看不见的活数进「还剩」，用户展开组数不出 N，比少报更糟；后者答「这个组总共完成了多少」，而已完成成员本身也从不渲染却照样计入，按同一把尺子它名下的已完成子任务也该计入。
   - 已知边角：**爹已完成、子任务未完成**的那几条两个数都不进。这是有意的——上一条的直接推论。
   - 三个数口径不同，不得互相派生。`allDone` 判据是 `remaining === 0 && doneCount > 0`；无未完成成员时 `pendingChildByMember` 恒空，不参与该判据。`doneCount` / `recentDoneCount` 与筛选无关——已完成成员本来就不在 `tasks` 里，那两个数回答的是组级事实。
4. `memberCount` 取 `goal.members?.length ?? 0` 的**原始数组长度**，含 track 成员与悬空 ref，**不含子任务**（子任务从不进名单）。它只服务 500 上限预警，不能用 `tasks.length + doneCount` 近似：后者只数可解析 task 成员，会漏掉真实容量占用；也不能掺进子任务——那是给上限闸喂假数。
5. 组间按**全部可解析成员（含已完成）**的 `max(updatedAt)` 倒序，并列按 `goal.createdAt` 倒序 —— 已完成成员参与排序键，故「某组全部完成」不会让它掉到末尾。
6. 组内未完成成员由 `sortProjectMembers` 排成「在手头 → 今天 → 躺着 → 已排期」。前三段内保持传入顺序（即 `listTasks` 的 `sortOrder`）；已排期段按 `scheduledAt` 升序。已排期沉底是刻意的：项目组展开是为了挑下一条能动手的，未来有主的先让位。逾期一次性任务由 `placementForTask` 回落 inbox，自然归入 idle 段，不单开逾期态。
7. 项目内 `+` 新建成功后，组件本地用 `recentTaskIds` 把新建的 idle 成员临时提到 idle 段顶部；这只是反馈层覆盖，不持久化、不改 `sortOrder`。
8. 查不到的成员 ref 直接丢弃、**不做清理**：悬空 ref 正是 goals 星图 ghost 节点的唯一数据源（见 [goals](goals.md)）。但这些 ref 仍计入 `memberCount`，因为 500 闸看的是原始数组。
9. 零可解析 task 成员的目标不进项目区（纯 track 目标在星图里已有位置）。

<a id="project-zone-ownership-write"></a>

## 4. 归属写入：同事务 touch + 单一归属

### 4.1 `assignTaskToProject` 是唯一收口单一归属的入口

`members` 没有跨目标唯一约束，一条任务可同时挂多个 active project。`assignTaskToProject(goalId, taskId)` 在**一个** Dexie 事务里「先摘后加」——遍历裸行找出持有它的其它 active project 逐个 `removeGoalMember`，再 `addGoalMember` 进目标组——使单一归属成为**写入侧不变量**。

- **摘/加复用既有两个函数而不是自己读改写**：它们已负担幂等、`prerequisites` 边清理、`goalLayoutPins` 回收、成员 touch + syncLog 四件事。Dexie 的嵌套事务在表是父集子集时并入父事务，故任一步抛错整包回滚。**没有外层事务会怎样是实测过的**：摘除已提交而加入失败 → 任务从两个组里同时消失，是静默的归属丢失。
- **目标组必须仍是 active project**（`status`/`kind` 双判，与读侧 `projectMemberIndex` 逐字同一个表达式）。缺这道闸时，目标组在另一端被归档/改 theme 后拖入会照常摘除、照常写入，而读侧只认 active project → 这条任务不再属于任何组。判据与读侧同源是构造性保证：**凡能被渲染成落点的组必然通过这道闸**。
- **只摘 active project**：theme 归属走绿竖条那条独立通道（§2），归档目标读侧本来就不认，摘它只是白写一行 syncLog。
- **读侧仲裁是长期承重件，不是死代码**：单一归属只在这一个入口上成立。归档组被**解档**（goals 页 5 处入口）、goals 页的 `addGoalMember`/`updateGoal({members})`、跨设备并发、存量数据、缺 `status` 字段的老行，都能重新造出多重归属。
- **摘除的连带删除是 schema 硬后果**：成员一走，源组里引用它的 `prerequisites` 边就非法（superRefine 要求 prerequisite 必须指向成员），不删则整行 parse 失败、整个目标从 UI 与同步里消失。所以它不是可选副作用。触发门槛在待办页降到了「手滑一拖」，故拖拽路径落库前用 `prerequisiteLossOnAssign` 先问一句（§6）。

项目标题行的 `+` 不直接改 `Goal.members`，而是走 `createTaskForProject(goalId, { title })`：先用 `buildNewRootTask({ toInbox: true })` 生成根任务，再在覆盖 `goals/goalLayoutPins/tasks/tracks/syncLog` 的外层事务里 `insertNewTaskInCurrentTransaction`，随后调用 `assignTaskToProject`。因此 active project 闸、任务侧准入、500 上限、先摘后加、touch 与 syncLog 仍只有一份实现；任何一步失败都会回滚任务 create 与目标成员更新，不留下孤立任务。

### 4.2 归属变更同事务刷新成员任务 `updatedAt`

`lib/goals.ts` 的 `addGoalMember` / `removeGoalMember` / `updateGoal` / `deleteGoal` 在同一 Dexie 事务内调用 `touchTasksInCurrentTransaction`，刷新归属发生变化的成员任务并各记一条 `syncLog`。

原因是重力沉降按 `task.updatedAt` 年龄判定（`isTaskSunken`）：任务失去归属会回落收件箱，不刷新就按旧时间戳参与水位线判定、直接沉进默认折叠的水下区，体感是「退出项目 = 任务消失」。释放通道有四条（`status→archived`、`kind→theme`、`members` 整包替换、删除目标），`updateGoal` 用**前后归属差集**（`releasedProjectTaskIds`）统一覆盖前三条而非逐条特判；`addGoalMember`/`removeGoalMember` 的幂等早退分支**不 touch**（否则重复点一下就把任务从水下顶上来）。

这是**本机副作用、不是跨设备不变量**——入站 sync apply 按域写单表、无跨域钩子，其它设备改归属不会 touch 本机 task 行。故项目区必须完全由 goals 推导，不得依赖 task 行上的反向标记。

<a id="project-zone-presentation"></a>

## 5. 呈现契约

- **位置**：收件箱正上方（两种布局都是）。零 active project 时整区不渲染。
- **组三态**：0 可解析成员 → 不进项目区；有成员且全部完成 → `已完成 · M 条` + 「去归档」深链 `/goals/:id`；有未完成 → `还剩 N`，若近 7 天有完成则追加 `· 近 7 天 +M`。`+0` 不画，长期项目不显示总数分母。全完成态**不特殊置顶**（置顶会让已完成项目抢占进行中项目的注意力）。
- **组内已完成不渲染**：已完成成员退出组内列表，标题行只回答「总共完成多少」与「最近推进多少」。没有等价的项目内已完成清单；低频出口是更多菜单的「在 goals 页打开」。
- **组内行可拖**：`TaskList` 接 `sortable` + `containerId = projectContainerId(goalId)` + `dndIdPrefix`，`childrenModeOverride` 从 `"static"` 改 `"draggable"`（升根手势的前提）。拖柄、缩进高亮环（`data-indent-target`）、收纳后展开父行的落点反馈（`revealChildren`）全部由页面透传的判定结果驱动，**组件不自己判**——跨组不亮高亮是页面侧 `hoveredRootIdFromOver` 就已过滤掉的结果，组件手上并没有「当前拖拽来自哪个组」这份信息。手势语义见 §6.1。
- **内容区限高**：展开态内容区使用 `.todo-project-group-body` 语义类承载 `max-height: 45vh` 与 `overflow-anchor: none`，组件另挂 `overflow-y-auto`；限高加在内容区而不是组块外框。外框仍是 droppable 落点，内容区限高让落点 rect 有界且稳定，收件箱（唯一拖入源）不被大组推出视口。已知限制：落点反馈滚到组外框，不保证滚到内部那条成员；语义仍是「告诉你它在哪个组」。
- **标题行操作**：未全完成组显示 `+`，点击后展开组并在内容区顶部显示就地输入框；Enter 以 trim 后标题调用 `createTaskForProject`，成功清空输入并保持打开，Esc 关闭。全完成组不显示 `+`，仍显示「去归档」。所有失败由页面 action toast 报原因，输入框保留草稿；筛选激活时，创建成功但新任务不匹配筛选条件会提示「任务已创建，但当前筛选未显示它」，写入结果不受筛选影响。
- **更多菜单**：每组标题行有 `⋯`（Phosphor `DotsThree`，role=menu/menuitem），提供「改名」与「在 goals 页打开」。菜单沿用 QuickNoteActionMenu 的交互：打开时首项聚焦，Escape / 外点关闭并把焦点还给触发按钮；菜单按钮和输入框点击不得穿透成展开/折叠。改名走 `updateGoal(id, { title })`，空标题不提交、失焦/Escape 恢复原名；打开目标跳 `/goals/:id`。
- **上限预警**：`memberCount >= Math.ceil(GOAL_MEMBERS_MAX * 0.9)` 且组未全完成时显示轻量「接近上限」提示。阈值从上限推导，不写死 450；预警不改变写入行为，真正撞线仍由 `ProjectAssignError("full")` 拒绝。
- **展开态记忆**：组件内 `Map<goalId, boolean>` 覆盖表，不持久化。无筛选时默认全折叠，展开由用户点击或 `revealGoals`（落点反馈 / chip 回跳）驱动；筛选激活时匹配组强制展开，但不改写覆盖表，清除筛选后恢复用户偏好。
- **成员状态点**：`projectMemberState` 判四态——`at-hand`（焦点轴优先于时间轴）/ `today` / `scheduled` / `idle`。`idle` 是默认多数态，渲染层不画胶囊：没有胶囊本身就是答案。**没有「逾期」态**：`placementForTask` 只对重复模板与 occurrence 给 `overdue`，一次性任务过期会被退回 `inbox`，而项目区的归集守卫恰好把前两类挡在门外——项目区成员拿不到 overdue。
- **成员行动作按两根轴各自渲染**：组内列表按 `pool="inbox"` 铺（组内不排序也不换池），但行右端的换池箭头与「抓到手头」各走自己的轴——`projectMemberRowActions` 同时给出 `atHand`（焦点轴）与 `pool`（时间轴：在今天 → `today` 显示「回收件箱」，其余含排到未来 → `inbox` 显示「排进今天」），经 `TaskList` 的 `rowPool` / `atHandIds` 落到行上，悬停按钮与滑动菜单共用这同一份判定。**项目区是唯一会撞上这件事的区域**：别处 `listTasks` 早把在手头 / 在今天的行截去各自的区，只有这里按 §1「一条被抓到手头、或排到今天的成员仍留在项目区」原样留着，跟着列表级 `pool` 走就会给它们挂上空动作（已在手头的还显示「抓到手头」、已排今天的还显示「排进今天」）。与 `projectMemberState` 的四态互斥刻意不同：那个答的是「当前在哪」（焦点轴压过时间轴）、只用来画胶囊，拿它开关按钮会把「在手头且已排今天」判成没排今天、箭头指反。时间轴刻意不给 `upcoming`——`TaskRow` 拿到它会再画一枚排期日胶囊，与状态胶囊重复。
- **项目名 chip**：只出现在**手头 / 今天 / 已排期（含水下尾）**。它与绿竖条**不得同屏**——chip 说得出是哪个项目（携带该项目的身份色）、点得开，竖条只说「有去处」（全场同一个绿），同屏出现时后者是前者的冗余——`goalBarTaskIds` 把有 chip 的行从竖条集合里裁掉，竖条退回只表达 theme 归属。chip 需 `relative z-20` 才能压过行左 2/5 的 `z-10` 拖拽 activator。裁剪后的 `goalLinkedIds` 同时也喂给了翻牌区 / 水下收件箱 / 收件箱这三个**不渲染 chip** 的分区，看着像多裁了，其实零语义损失：「chip 集合 ∩ 收件箱 = ∅」是**构造性**成立的——`projectChipIndex` 的输入是 `buckets.projects`，而它与 inbox 排他共用同一个 `ownedByProject`（§3 第 2 条），进得了 chip 索引的就一定进不了 inbox——这行不是笔误。chip 与组卡片标题行各画一个同色圆点，色取自 `TodoBuckets.projectTints`（集合内避撞分配，见 [design-language](design-language.md#design-language-s1)），构成「点↔点」的同一项目认同；两处都不自行取色——避撞只有拿着全部 active project 才算得出，组件手上只有显示出来的组；组卡片不另加左侧色条——同一张卡片上两个颜色信号与本条的「chip / 竖条不得同屏」是同一条裁剪规则。
- **退出项目**：行内动作调 `removeGoalMember`，任务浮在水上回落收件箱。组内最后一条成员退出后 **Goal 保留不自动归档**（归档是 goals 页的显式动作）。**另有一条不经表层 API 的退出路径**：把任务收纳为子任务（`lib/taskNesting.ts: nestTaskUnderParent`）会遍历所有 goal，静默清空该任务在其中的成员资格——子任务不持有任何归属指针（见 [todo](todo.md#todo-s2-2)）。
- **落点反馈**：「回到 inbox 池」不等于「出现在收件箱」——项目成员会落进项目区里一个默认折叠的组，而组 header 的「还剩 N / 共 M」本来就把它算在内、数字纹丝不动，全屏零反馈，体感是「任务凭空消失」。故凡是让成员回落 inbox 池的路径，动作后都要复用 chip 的回跳机制（`revealProjectHome`）展开它的归属组并滚过去：行尾/左滑「回收件箱」、拖进 `pool:inbox`、移出手头、子任务升根、详情抽屉改「重复与时间」、取消勾选。**「拖入项目」不在此列**——它是把成员送**进**组、不是回落 inbox 池，落点就在手指下方，自动展开反而会在连续拖入第二条时改变布局；它的反馈走 toast（§6）。
  - **判据只在 `revealProjectHome` 一处判，入参是写入后的 `Task`**。调用方各自判必然分裂成「动作前的行 / 拖拽意图 / `choice.kind`」几种口径，每种都漏一半（详情抽屉尤其：`choice.kind === "none"` 漏掉「仅某天」选到过去日期那支，又误报已完成 / 在手头的任务）。三道闸：① 归集守卫里 placement 判不出的两条（子任务、`ruleId` 非空的混合体行——它们 scheduledAt 为空照样被判 inbox，但投影层根本不收，展开的是不含它的组）；② 焦点轴压过落点（`listTasks` 把未完成的手头成员截进 `atHand` 并 `continue`，它在页面最顶上、本来就看得见）；③ `placementForTask(...).pool === "inbox"`。`done` 与 `recurrence` 不必单列——placement 首行就把它们判成 `completed` / `today`·`recurring`；**已完成成员只计入标题行计数、组内没有可展开行，展开组也看不到它，给的是错误指认、比零反馈更糟**，正是靠 placement 这一支挡住。
  - **写入失败不反馈**：详情抽屉的 `onTimeChanged` 只在写入成功时报，交出去的是写入结果。若不管成败都报，任务被并发删除时会一边弹错一边把页面滚去展开一个空组（查归属认 `members` 原始事实，不校验 task 行还在不在）。
  - 查归属分两级：先查 `projectChipIndex`（渲染期闭包，覆盖"动作前就是未完成根成员"的情形），未命中再 `findActiveProjectGoalIdForTask` 读一次库——**子任务不在任何客户端投影里**；已完成成员只计入 `doneCount`、不在 `projectChipIndex`，两者都得查库才补得上归属。查库要 `catch` 后静默降级：`TaskRow` 的 `onToggle` 是裸调用，抛出去没人接。
  - **reveal 是待消费意图，不是脉冲**：`revealProjectHome` 只等一次 `db.goals.toArray()`，而项目区要等整轮 `listTasks` 才产出新组，前者几乎必然先落——若置位后立刻消费，那一帧 `rowRefs` 上还没有节点，`scrollIntoView` 静默跳过且永不重试（展开那一半却生效了，成了「展开了但没滚到」）。故宿主持一份待消费 `goalId` **集合**（单槽会被 React 自动批处理合并、丢掉先置位的那个），组件只消费**这一帧真的渲染出来**的组、其余留到下一轮 `groups` 变化时补上，消费后回报宿主清空。**清空是硬要求**：不清的话，跨 1024px 断点时项目区整棵重挂（换了父容器），mount effect 会把上一次的意图重放一遍——用户手动折叠的状态丢失、页面被滚走。
- **项目区标签与搜索筛选（`filterActive`）**：项目区支持全域标签与关键字筛选。当筛选激活时，项目组内部按筛选规则过滤任务，包含匹配任务的项目组自动展开，无匹配任务的组隐去；筛选期间收到的 `revealGoals` 仍会滚动并消费，但不写入展开覆盖表，筛选清除后恢复用户原有的折叠/展开偏好。零 active project 时整区仍不渲染；有 active project 但全部组均无匹配任务时显示项目区空态。手头区（AtHand）维持焦点隔离，不受筛选影响；`tagOptions` 的来源包含项目区成员。
- **排他语义无常驻解释**，是刻意的：收件箱顶部不挂「N 条任务已归入 M 个项目」这类提示条，项目区也不因此首次全展开。

<a id="project-zone-drag-in"></a>

## 6. 拖拽归入（动作二）

从**今天 / 收件箱**把根任务拖到项目组上 = 归入该组。落点判定表与容器域在 [todo/invariants](todo/invariants.md) 第 5 条；这里管归属侧的契约。

- **落点是整个组块**（标题行 + 展开态内容区），不是只有标题行：展开后标题行仅一行高、下面是一整片列表，只认标题行在展开态几乎瞄不准。`useDroppable` 落点共两族：本处（id `project:<goalId>`）与宽屏投递坞的药丸（id `dock:*`，见 [todo/invariants](todo/invariants.md) 第 14 条）。
- **组块与组内行同时是落点，靠碰撞策略分流**：组内每行另注册 sortable，dnd id 带 `project-row:<goalId>:` 前缀（见 §6.1）。指针落在卡内时谁赢由 `preferProjectCollisions` 裁决——**来源是本组则同组行优先，来源是外区则只认卡片**，故外区归入这条路径够不着组内行。组内不做用户自定义重排（组内序由 §3 规则 6 的四段排序算出）。
- **碰撞策略必须让项目卡优先**（`preferProjectCollisions`）。页面用 `closestCenter`，它按 droppable 矩形**中心点**算距离，而展开的项目卡是几百像素高的大块、中心离手指很远，会被隔壁收件箱某一行抢走落点——整块 droppable 在展开态近乎失灵。故指针真落在项目卡内时只认它，否则原样退回 `closestCenter`；宽屏投递坞的药丸浮在列表之上，坞命中又优先于项目卡（见 [todo/invariants](todo/invariants.md) 第 14 条）。`fallback` 传 thunk：指针已落在卡内时 `closestCenter` 的结果注定被丢弃，没必要每帧遍历全部 droppable。**已知限制**：键盘拖拽没有指针坐标，`pointerWithin` 恒空 → 走 fallback，项目组在纯键盘下仍难命中。
- **对缩进系统让位**：横向位移触发的缩进判定与「拖进项目」共用同一次手势，`canBecomeChild` 优先于目标容器。两道闸——`hoveredRootIdFromOver` 对 `project:` 容器恒返回 null，且 `canBecomeChild` 显式排除 project——第二道在当前调用路径上不可构造，是明写的防御闸。没有它，斜着拖进项目会被判成 `move-to-parent`（拆/接父子关系）。
- **准入四拒，判在两处，不重合**：
  - **子任务 / 重复待办**由**页面**判（`dragDropBlocked`），给悬停禁止态。子任务这一支**必须从 dnd 容器 id 认**（`parent:` 前缀）：`listTasks` 主循环第一行就跳过 `parentId !== null` 的行，子任务不在任何 bucket 里，按 task 查恒为 null——`activeParentId` 同理恒为 null，不能用它判。
  - **满员 / 目标组失效**由**写入侧**抛（`ProjectAssignError`），组件判不了：它手上只有 `TodoProjectGroup`，既无 `goal.status`/`kind`，也无 `members` 数组长度（500 闸看的是含 track 成员与悬空 ref 的整个数组，拿可解析成员数近似会撒谎）。
  - 因此存在一个**刻意窗口**：组在拖拽途中于另一端被归档时仍显示「可落」高亮，松手才弹拒绝。它换掉的是「高亮 → 静默吞掉归属」，方向是净改善。
- **成功也要给反馈**（`已归入「X」`）。组间排序键是组内成员 `max(updatedAt)`（§3 规则 5），而归入恰好刷新它——**目标组必然跳到项目区第一位**。「不展开组」挡不住这种布局变化：三张折叠卡外观一样，用户按视觉位置拖第二条就会落进别的组，且成功路径若无反馈，误归入几乎不可见（组不展开、任务同时因排他从收件箱消失）。
- **拒绝也要说原因**。子任务那支走的是 `resolveTodoDragOperation` 返回 null 的路径，`handleDragEnd` 在 `if (!op)` 就早退，走不到正常的 toast 分支——拒绝提示因此发在那个早退分支内部（`projectAssignBlockMessage("subtask", …)`）。无声失败会被读成「应用坏了」。
- **兜底 toast 不可省**：目标组的裸行过不了 `GoalSchema.parse` 时抛的是 `ZodError` 而非 `ProjectAssignError`。红线「读裸行不 parse」保证这种组**照常渲染成落点**，用户拖多少次都一样——静默吞掉等于应用坏了。文案要中性（真正坏掉的常是任务**原来所在**的源组，指认目标组会让用户换组反复重试）。
- **前置边确认**：`prerequisiteLossOnAssign(taskId, nextGoalId)` 读裸行算出「摘除会连带删掉几条边、来自几个组」，非空则落库前 `useConfirm` 问一句。判据与 `removeGoalMember` 内那句 filter 同源（跳过目标组自身、只认 active project、`blocker`/`blocked` 双侧）。多源组时文案只说组数与总条数、不点名（`count` 是各组之和而 `goalTitle` 取边最多那组，点名会把总数栽给单个组）。**它在准入闸之前调用**，故满员/归档/occurrence 等被拒场景会「先警告后失败」——方向是过度警告，不是数据丢失。

<a id="project-zone-nesting"></a>

## 6.1 组内父子收纳（动作三）

组内两个手势，**都只在同一个组内成立**：把 A 右移越线停在同组 B 上 = A 成为 B 的子任务（落库走 `lib/taskNesting.ts: nestTaskUnderParent`，同事务清 `sessionId` + 退出全部项目名单）；把组内子任务左移越线 = 升根并**重新入本组**（走 `promoteTaskToProject`，串行 `promoteToRoot(…, "inbox", …)` + `assignTaskToProject`）。阈值与判定层与其余各区共用同一套（见 [todo/invariants](todo/invariants.md) 第 5 条）。

- **升根回组不违反「子任务不持有归属指针」**：它是同一手势内的显式再入组写入，不是归属继承——落库层没有任何「记住原来属于谁」的字段。
- **三道守卫，方向不同，各自独立成立**：① `hoveredRootIdFromOver` 对 project 容器**比 `goalId` 而不只比 `kind`**（hand 是单例容器，比 kind 就够；项目区有 N 个容器，只比 kind 会放行跨组收纳，且拖到隔壁组的行上照样亮高亮、照样落库）；② 同一函数对 pool / parent 容器**拒绝项目区来源**——前一道挡「外区来源进不来」，这一道挡「组内来源出不去」；③ `resolveTodoDragWithIndent` 里 `canBecomeChild` 另有一道同判据的保险，防的是上游错传。②的代价是组内成员悬停在**同组另一个成员的子任务行**上不再是收纳落点（判定层分不出那个父在哪个组），主落点仍是成员行本身。
- **子任务拖到项目卡上有两种情形，容器 id 字符串逐字相同**：收件箱某任务的子任务拖过来（跨区的「先升根再入组」，**拒绝**）vs 组内子任务落回本组（**升根回组**）。判定层分不出，靠页面算好的 `activeParentProjectGoalId` 分流——它同时喂坞的关闭判据，页面只算一次。
- **`resolveTodoDragOperation` 里 `if (active.kind === "project") return null` 这道哨兵必须排在两条 project 分支之后**。挪到前面会把组内收纳短路成死代码——这条错法**天然静默**：返回值都是 null、行为「没变」，真机上只表现为「项目区的行拖了没反应」。守它的是 `todoDnd.test.ts` 的定向用例，挪位后从三个入口各红一条。**升根回组不在影响面内**：它的 active 是 `parent` 容器，够不到这道哨兵。
- **项目区整区不出投递坞**（含「父在项目组」的子任务）：本域不提供「拖出组」，退出项目走行内 × 按钮。机制同手头区，见 [todo/drag-dock](todo/drag-dock.md) §1。
- **计数口径的连带**：收纳会让被收纳那条退出 `goal.members`，`memberCount` 因此**只减不增**，收纳永远撞不上 500 闸；标题三个数含子任务（§3），所以收纳前后数字不变。

<a id="project-zone-row-dnd"></a>

### 6.1.1 组内行的 dnd 身份

组内行的 dnd id 是 `project-row:<goalId>:<taskId>`（`todoProjectRowIdPrefix` / `todoProjectRowId`），**不是裸 task uuid**。因为焦点轴与时间轴正交（§1）：一条被抓到手头 / 排了今天的成员**同屏出现两次**——那个区一份、项目区一份。两处都用裸 id 会在 dnd-kit 里撞 id。

- **前缀形状不能写成 `project:<goalId>:<taskId>`**：`parseTodoContainerId` 会把它误解析成 `goalId = "<goalId>:<taskId>"` 的项目容器，静默拼出一个不存在的组；`preferProjectCollisions` 里的 `startsWith("project:")` 也会把行当成卡片。带 `-row` 的形状对两者都天然不匹配。
- **任务 id 一律从 `over.data.current.taskId` / `active.data.current.taskId` 取**，不拿 `active.id` / `over.id` 当任务 id 用。全部各区的行注册都带了 `taskId`，让「取任务 id」只有一条路。漏改的症状是「拖了没反应」而非报错——拿带前缀的 id 查任务恒为 null。
- **`hoveredRootIdFromOver` 的第二参收的是任务 id，非行落点必须传空串**。组卡片自己也是 droppable，它的 data 里没有 `taskId`；不早退就会把 `"project:g1"` 这个容器 id 当成根行 id 返回，下游拼出 `parent:project:g1` 这种垃圾落点（与坞那条守卫是同一类事故）。

## 7. 多选建组 / 批量归入（动作一）

从收件箱勾一批、圈成新项目或整批放进已有组：`selectionMode` 的模式态边界（入口、可选范围、`inert` 与 Esc 让位、底部避让）、选中集与库的对账剪枝、两个批量写入入口的单事务口径、前置边确认剩下的那个窄窗口，全在纵切子文档 [project-zone/multi-select](project-zone/multi-select.md)。

## 8. 模块速查

| 入口 | 职责 |
|---|---|
| `lib/tasks/goalMembership.ts` | 读侧两份索引与分组投影：`goalLinkedTaskIds`（全 kind active）/ `projectMemberIndex`（active project）/ `buildTodoProjectGroups`（未完成列表、`doneCount`、`recentDoneCount`、`pendingChildByMember`、原始 `memberCount`、组间排序键、同挂多组的仲裁；第 5 参 `childrenByParent` **必传**，给默认空 Map 会让漏传静默退回不含子任务的旧口径）/ `GOAL_MEMBERS_MAX` 与 `isProjectMemberCountNearCap` |
| `lib/taskNesting.ts`（归 [todo/modules](todo/modules.md) covers） | 组内两个手势的落库：`nestTaskUnderParent`（收纳，同事务清 `sessionId` + 退出全部名单）、`promoteTaskToProject`（升根回本组，串行两步不合事务；失败停在「已升根、未入组」的可见态，`ProjectAssignError.block` 为 `recurring` 时它落的是重复管理区而非收件箱） |
| `lib/tasks/projectZone.ts` | 呈现判定纯函数（不碰 db / React，落 node 快桶）：`projectMemberState` 四态 / `sortProjectMembers` 四段排序与 recentTaskIds 覆盖 / `summarizeProjectGroup` 组三态计数 / `projectChipIndex` / `goalBarTaskIds` 竖条裁剪 |
| `pages/todo/TodoProjectSection.tsx` | 项目区 UI：受控展开的组 header（`revealGoals` 待消费意图 → 组渲染出来才展开 + `scrollIntoView`，并经 `onRevealConsumed` 回报宿主清空）、成员行「当前在哪」胶囊与「退出项目」、内容区限高、`+` 项目内创建、`⋯` 改名 / 跳 goals、90% 上限预警；同文件另导出 `ProjectNameChip`（组外行的项目名 chip）；`trackChipFor` 插槽把宿主的轨道徽章并进成员行 meta 带（与状态胶囊组合，两者皆空时返回 `null` 以免顶开 `TaskRow` 的 meta 带出现闸） |
| `lib/tasks.ts: listTasks()`（归 [todo](todo.md) covers） | 归集与排他的同源判据 `ownedByProject`、`buckets.projects` 出桶、`goalLinkedIds` |
| `pages/TodoPage.tsx`（归 [todo](todo.md) covers） | 接线：项目区挂收件箱正上方（宽窄两种布局）、chip → `openProject` 回跳、成员回落 inbox 池时 `revealProjectHome`（唯一落点判据 `landsInCollapsedProjectGroup`，六条路径一律传写入后的 `Task`）、`exitProject` → `removeGoalMember`、`tagOptions` 纳入项目区成员 |
| `lib/goals.ts`（归 [goals](goals.md) covers） | 写侧四条归属通道 + `touchTasksInCurrentTransaction`（§4.2）；`assignTaskToProject` 单事务先摘后加（§4.1）+ `ProjectAssignError`；`createTaskForProject` 组合项目内创建；`prerequisiteLossOnAssign` 只读预测（§6）；批量版三件套见 [project-zone/multi-select](project-zone/multi-select.md) §3、§4 |
| `pages/todo/todoDnd.ts`（归 [todo](todo.md) covers） | `project:<goalId>` 容器域与 `assign-to-project` 操作、`project-row:` 行 id 域（`todoProjectRowIdPrefix` / `todoProjectRowId`）、组内 `move-to-parent` 与 `promote-to-project` 两条分支及其哨兵次序、三道守卫、`preferProjectCollisions` 碰撞策略含「本组来源优先认行」一档、落点解析纯函数 `resolveTodoDropTarget` + `TodoDropLookup`（`parent:` 容器按根行反查所属池 / 组，项目成员被排他扣出 inbox 桶，那一支不能省）（§6 / §6.1） |

测试：`lib/tasks/goalMembership.test.ts`（两份索引口径、分组投影、近 7 天窗口上下界、`memberCount` 原始口径、组间排序、同挂多组仲裁、悬空 ref、上限阈值）、`lib/tasks/projectZone.test.ts`（成员四态、行动作两轴不互遮、组计数、四段排序、recentTaskIds 覆盖、chip 索引、竖条裁剪）、`lib/tasks.test.ts`（`describe("listTasks projects 桶")`：归集/排他同源、手头正交、重复模板与 occurrence 挡在门外、组内排序接线）、`pages/todo/TodoProjectSection.test.tsx`（组展开折叠、标题文案、状态胶囊、成员行动作按真实状态渲染、退出项目、已完成零渲染、限高结构、`+` 创建输入、`⋯` 菜单、改名、上限预警、`revealGoals` 消费与「组还没渲染出来就留着、出现后补上」、chip）、`pages/TodoPage.test.tsx`（页面级：排他后成员离开收件箱、项目内创建成功/满员拒绝、菜单改名和跳转、零 project 不渲染、chip 回跳、回收件箱后展开归属组、红线 3 竖条不同屏，以及落点判据的三条反向用例——手头区取消勾选 / 抽屉清时间但已完成 / 抽屉选未来某天都**不**展开，外加「抽屉→页面」这根线本身）、`lib/goals.test.ts`（`createTaskForProject` 的同事务成功/满员/失效目标/裸行解析失败回滚，`describe("归属变更同事务刷新成员任务 updatedAt")` 与 `describe("assignTaskToProject")`：单一归属先摘后加、theme/归档组不被摘、目标组失效被拒、准入四拒、幂等重入不动钉点、事务原子性）。

多选建组 / 批量归入的用例三层分布见 [project-zone/multi-select](project-zone/multi-select.md) §5。

拖拽归入的页面级用例在 `pages/TodoPage.test.tsx`（成功 toast、子任务拒绝 toast、禁止态三支、确认弹窗取消/确认两路）。**它们的落点稳定性依赖一条实现细节**：jsdom 里 rect 全为 0 → `closestCenter` 全部并列 → dnd-kit 取 `droppableContainers` 的**挂载顺序**第一名（不是 DOM 顺序）。键盘拖拽无指针坐标，`preferProjectCollisions` 在这些用例里一次都没生效。**在项目区之前新增任何 droppable，这几条会以超时报红**——那是响亮失效不是 flaky（原委记在 `keyboardDrag` 上方的注释里），加重试只会把它埋掉。

组内行 droppable（§6.1.1）**没有触发上面这条**，原因是结构性的、值得写下来：组默认折叠，而折叠态组内不渲染任何行，于是这批用例跑到时新增落点数为零、挂载顺序不变。`TodoProjectSection.test.tsx` 里那条「折叠的组内不渲染任何行落点」就是这个前提的守卫——**它红了意味着上面那批归入用例即将开始超时**，别把它当成一条无关紧要的渲染断言。

**组内收纳 / 升根回组的真落点用例写不出来，这是刻意留白不是遗漏**：① jsdom 里组卡片的 `useDroppable` 先于组内行挂载，`over` 恒是卡片、永远不是某一行；② 车道判定对键盘拖拽恒返回基线档，而 `keyboardDrag` 是该文件唯一的拖拽 helper（`MouseSensor` 有 180ms 激活延迟，仓库禁真实定时等待），拖根成员时收纳档结构性不可达。故落库证据落在 `todoDnd.test.ts` 的判定层用例与 `lib/taskNesting.test.ts` 的落库用例上，手势本身由真机验收——不写恒绿用例充数。页面级只测「拖起那一刻页面进入了什么状态」（项目区源坞恒空，各带一条收件箱对照断言，否则坞没渲染时结论也成立）。

## 9. 归属路径边界

**只有 `pool:today` / `pool:inbox` 两个拖拽源能归入项目**——已排期（非今天）与手头的任务没有归入路径，绕法是先清日期或等它到期。另有第三条进组路径但只在组内可达：组内子任务升根回本组（§6.1），它不接受任何外区来源。

**项目区不提供「拖出组」**：组内的行拖不到收件箱 / 今天 / 手头 / 别的组，坞对项目区整区关闭。退出项目走行内 × 按钮，换组走「先退出、再拖入」两步。**这条边界由三处共同保证，缺一处就有洞**：`resolveTodoDragOperation` 的哨兵挡根成员直落池 / 手头；同函数两条 `parent` 分支按 `activeParentProjectGoalId` 挡组内子任务升根离组；`hoveredRootIdFromOver` 对 pool / parent 落点拒绝项目区来源，挡的是**绕道缩进手势的收纳出组**——那条最隐蔽，落点行会照常亮起收纳高亮环，而 `nestTaskUnderParent` 同事务清空全部项目名单。

归档 Goal 不弹「N 条未完成任务将回到收件箱」提示：归档是 toggle，5 处入口都无确认（属 goals 页的呈现范围）；数据安全由 §4 的 touch 兜住，不依赖提示。
