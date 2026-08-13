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
> 本文管的是**任务属于谁**——`Goal(kind="project")` 成员在待办页的分组投影、归属轴对收件箱的排他、归属变更的写入侧不变量。
> 目标实体本身（`Goal` schema、星图、未归类托盘）在 [goals](goals.md)；焦点轴见 [todo/at-hand](todo/at-hand.md)；重力见 [todo/gravity](todo/gravity.md)。
> 多选建组 / 批量归入（动作一）见纵切子文档 [project-zone/multi-select](project-zone/multi-select.md)；呈现契约与拖拽归入 / 组内收纳（动作二、三）见 [project-zone/presentation](project-zone/presentation.md)。本文管投影与写入侧契约。

## 承上启下

- **上游**：唯一输入是 `db.goals` 全表**裸行**（`listTasks` 每轮另读一次，刻意不过 `GoalSchema`，见 §2）与 `db.tasks` 的根任务。写入面都写同一份 `Goal.members`：goals 页的星图 / 未归类托盘、项目区成员行内的「退出项目」、项目标题行的 `+` 创建，以及 `⋯` 改名——经 `lib/goals.ts` 的成员/项目组合入口与 `updateGoal`（§4 的 touch 挂在这些归属通道上）。
- **下游**：`listTasks` 出桶时多产出 `TodoBuckets.projects`（分组投影）与 `goalLinkedIds`（绿竖条集合），并就地从 `buckets.inbox` 里扣掉 active project 成员。`TodoPage` 据此渲染 `TodoProjectSection`，再用 `projectChipIndex` / `goalBarTaskIds` 决定组外行（手头 / 今天 / 已排期）画项目名 chip 还是画绿竖条。排他改变的是 inbox 的**内容**，想法重力的水位线（`splitInboxByGravity`）作用在排他之后的 inbox 上——两者顺序不可换。
- **契约**：`TodoProjectGroup` 形状与分组投影落在 `lib/tasks/goalMembership.ts`（§2/§3 是它的语义合同）；呈现判定纯函数（`projectMemberState` / `sortProjectMembers` / `summarizeProjectGroup` / `projectChipIndex` / `goalBarTaskIds`）落在 `lib/tasks/projectZone.ts`，UI 侧合同见 [project-zone/presentation](project-zone/presentation.md) §1。`Goal` 实体 schema 本身不归本文，见 [goals](goals.md)。
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
- **摘除的连带删除是 schema 硬后果**：成员一走，源组里引用它的 `prerequisites` 边就非法（superRefine 要求 prerequisite 必须指向成员），不删则整行 parse 失败、整个目标从 UI 与同步里消失。所以它不是可选副作用。触发门槛在待办页降到了「手滑一拖」，故拖拽路径落库前用 `prerequisiteLossOnAssign` 先问一句（见 [project-zone/presentation](project-zone/presentation.md) §2）。

项目标题行的 `+` 不直接改 `Goal.members`，而是走 `createTaskForProject(goalId, { title })`：先用 `buildNewRootTask({ toInbox: true })` 生成根任务，再在覆盖 `goals/goalLayoutPins/tasks/tracks/syncLog` 的外层事务里 `insertNewTaskInCurrentTransaction`，随后调用 `assignTaskToProject`。因此 active project 闸、任务侧准入、500 上限、先摘后加、touch 与 syncLog 仍只有一份实现；任何一步失败都会回滚任务 create 与目标成员更新，不留下孤立任务。

### 4.2 归属变更同事务刷新成员任务 `updatedAt`

`lib/goals.ts` 的 `addGoalMember` / `removeGoalMember` / `updateGoal` / `deleteGoal` 在同一 Dexie 事务内调用 `touchTasksInCurrentTransaction`，刷新归属发生变化的成员任务并各记一条 `syncLog`。

原因是重力沉降按 `task.updatedAt` 年龄判定（`isTaskSunken`）：任务失去归属会回落收件箱，不刷新就按旧时间戳参与水位线判定、直接沉进默认折叠的水下区，体感是「退出项目 = 任务消失」。释放通道有四条（`status→archived`、`kind→theme`、`members` 整包替换、删除目标），`updateGoal` 用**前后归属差集**（`releasedProjectTaskIds`）统一覆盖前三条而非逐条特判；`addGoalMember`/`removeGoalMember` 的幂等早退分支**不 touch**（否则重复点一下就把任务从水下顶上来）。

这是**本机副作用、不是跨设备不变量**——入站 sync apply 按域写单表、无跨域钩子，其它设备改归属不会 touch 本机 task 行。故项目区必须完全由 goals 推导，不得依赖 task 行上的反向标记。

## 5. 呈现契约（已外提）

组三态与成员行呈现、内容区限高、标题行操作与更多菜单、上限预警、展开态记忆、成员状态点与两轴行动作、项目名 chip、退出项目、落点反馈与 reveal 待消费意图、筛选行为，见子文档 [project-zone/presentation](project-zone/presentation.md) §1。

## 6. 拖拽归入与组内收纳（已外提）

拖拽归入（动作二）的落点、碰撞策略、准入四拒与前置边确认，组内父子收纳与升根回组（动作三）的三道守卫，以及组内行的 dnd 身份前缀，见子文档 [project-zone/presentation](project-zone/presentation.md) §2–§3。

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
| `lib/goals.ts`（归 [goals](goals.md) covers） | 写侧四条归属通道 + `touchTasksInCurrentTransaction`（§4.2）；`assignTaskToProject` 单事务先摘后加（§4.1）+ `ProjectAssignError`；`createTaskForProject` 组合项目内创建；`prerequisiteLossOnAssign` 只读预测（见 [project-zone/presentation](project-zone/presentation.md) §2）；批量版三件套见 [project-zone/multi-select](project-zone/multi-select.md) §3、§4 |
| `pages/todo/todoDnd.ts`（归 [todo](todo.md) covers） | `project:<goalId>` 容器域与 `assign-to-project` 操作、`project-row:` 行 id 域（`todoProjectRowIdPrefix` / `todoProjectRowId`）、组内 `move-to-parent` 与 `promote-to-project` 两条分支及其哨兵次序、三道守卫、`preferProjectCollisions` 碰撞策略含「本组来源优先认行」一档、落点解析纯函数 `resolveTodoDropTarget` + `TodoDropLookup`（`parent:` 容器按根行反查所属池 / 组，项目成员被排他扣出 inbox 桶，那一支不能省）（见 [project-zone/presentation](project-zone/presentation.md) §2–§3） |

测试：`lib/tasks/goalMembership.test.ts`（两份索引口径、分组投影、近 7 天窗口上下界、`memberCount` 原始口径、组间排序、同挂多组仲裁、悬空 ref、上限阈值）、`lib/tasks/projectZone.test.ts`（成员四态、行动作两轴不互遮、组计数、四段排序、recentTaskIds 覆盖、chip 索引、竖条裁剪）、`lib/tasks.test.ts`（`describe("listTasks projects 桶")`：归集/排他同源、手头正交、重复模板与 occurrence 挡在门外、组内排序接线）、`pages/todo/TodoProjectSection.test.tsx`（组展开折叠、标题文案、状态胶囊、成员行动作按真实状态渲染、退出项目、已完成零渲染、限高结构、`+` 创建输入、`⋯` 菜单、改名、上限预警、`revealGoals` 消费与「组还没渲染出来就留着、出现后补上」、chip）、`pages/TodoPage.test.tsx`（页面级：排他后成员离开收件箱、项目内创建成功/满员拒绝、菜单改名和跳转、零 project 不渲染、chip 回跳、回收件箱后展开归属组、红线 3 竖条不同屏，以及落点判据的三条反向用例——手头区取消勾选 / 抽屉清时间但已完成 / 抽屉选未来某天都**不**展开，外加「抽屉→页面」这根线本身）、`lib/goals.test.ts`（`createTaskForProject` 的同事务成功/满员/失效目标/裸行解析失败回滚，`describe("归属变更同事务刷新成员任务 updatedAt")` 与 `describe("assignTaskToProject")`：单一归属先摘后加、theme/归档组不被摘、目标组失效被拒、准入四拒、幂等重入不动钉点、事务原子性）。

多选建组 / 批量归入的用例三层分布见 [project-zone/multi-select](project-zone/multi-select.md) §5。

拖拽归入的页面级用例在 `pages/TodoPage.test.tsx`（成功 toast、子任务拒绝 toast、禁止态三支、确认弹窗取消/确认两路）。**它们的落点稳定性依赖一条实现细节**：jsdom 里 rect 全为 0 → `closestCenter` 全部并列 → dnd-kit 取 `droppableContainers` 的**挂载顺序**第一名（不是 DOM 顺序）。键盘拖拽无指针坐标，`preferProjectCollisions` 在这些用例里一次都没生效。**在项目区之前新增任何 droppable，这几条会以超时报红**——那是响亮失效不是 flaky（原委记在 `keyboardDrag` 上方的注释里），加重试只会把它埋掉。

组内行 droppable（[project-zone/presentation](project-zone/presentation.md) §3.1）**没有触发上面这条**，原因是结构性的、值得写下来：组默认折叠，而折叠态组内不渲染任何行，于是这批用例跑到时新增落点数为零、挂载顺序不变。`TodoProjectSection.test.tsx` 里那条「折叠的组内不渲染任何行落点」就是这个前提的守卫——**它红了意味着上面那批归入用例即将开始超时**，别把它当成一条无关紧要的渲染断言。

**组内收纳 / 升根回组的真落点用例写不出来，这是刻意留白不是遗漏**：① jsdom 里组卡片的 `useDroppable` 先于组内行挂载，`over` 恒是卡片、永远不是某一行；② 车道判定对键盘拖拽恒返回基线档，而 `keyboardDrag` 是该文件唯一的拖拽 helper（`MouseSensor` 有 180ms 激活延迟，仓库禁真实定时等待），拖根成员时收纳档结构性不可达。故落库证据落在 `todoDnd.test.ts` 的判定层用例与 `lib/taskNesting.test.ts` 的落库用例上，手势本身由真机验收——不写恒绿用例充数。页面级只测「拖起那一刻页面进入了什么状态」（项目区源坞恒空，各带一条收件箱对照断言，否则坞没渲染时结论也成立）。

## 9. 归属路径边界

**只有 `pool:today` / `pool:inbox` 两个拖拽源能归入项目**——已排期（非今天）与手头的任务没有归入路径，绕法是先清日期或等它到期。另有第三条进组路径但只在组内可达：组内子任务升根回本组（[project-zone/presentation](project-zone/presentation.md) §3），它不接受任何外区来源。

**项目区不提供「拖出组」**：组内的行拖不到收件箱 / 今天 / 手头 / 别的组，坞对项目区整区关闭。退出项目走行内 × 按钮，换组走「先退出、再拖入」两步。**这条边界由三处共同保证，缺一处就有洞**：`resolveTodoDragOperation` 的哨兵挡根成员直落池 / 手头；同函数两条 `parent` 分支按 `activeParentProjectGoalId` 挡组内子任务升根离组；`hoveredRootIdFromOver` 对 pool / parent 落点拒绝项目区来源，挡的是**绕道缩进手势的收纳出组**——那条最隐蔽，落点行会照常亮起收纳高亮环，而 `nestTaskUnderParent` 同事务清空全部项目名单。

归档 Goal 不弹「N 条未完成任务将回到收件箱」提示：归档是 toggle，5 处入口都无确认（属 goals 页的呈现范围）；数据安全由 §4 的 touch 兜住，不依赖提示。

## 子文档索引

| 子文档 | 拥有什么 |
|---|---|
| [project-zone/presentation](project-zone/presentation.md) | 组三态与成员行呈现契约、落点反馈与 reveal 意图、拖拽归入（动作二）、组内父子收纳与升根回组（动作三）、组内行 dnd 身份 |
| [project-zone/multi-select](project-zone/multi-select.md) | 多选建组 / 批量归入（动作一）：模式态边界、对账剪枝、批量写入单事务口径 |
