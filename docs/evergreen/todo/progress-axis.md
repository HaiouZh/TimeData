---
type: evergreen
title: 待办 · 推进轴
covers:
  - packages/client/src/lib/progressAxis.ts
contracts:
  - packages/client/src/lib/progressAxis.ts
last-reviewed: 2026-08-16
---

# 待办 · 推进轴

> 本文讲：五个推进桶的语义、Task / Track / Goal 各自的判桶规则、推进单元的去重、进度三口径、排序。
> 这是**读时投影层**，零 schema 变更、不写库、不碰 UI。四分区落点见 [todo](../todo.md)，归属轴见 [project-zone](../project-zone.md)，轨道模型见 [tracks](../tracks.md)。

## 1. 它是什么

`progressAxis.ts` 把三种实体投影进同一组「推进桶」，产出一个去重后的**推进单元**列表。一行 = 一件在推进的事，不是一条 Task 也不是一条 Track。

**推进轴是第四根轴**，与既有的归属 / 焦点 / 时间三轴（[project-zone](../project-zone.md) §1）**正交**：它不排他、不替代四分区、不改变任何既有投影的输出。一条任务同时出现在待办的今天区和推进面板的「在做」桶里，是正常的。

**`bucketForTrack` 有两个消费者**：本文件内部的 `buildProgressItems`，以及待办页的 `tasks/todoTrackRows.ts`（轨道落进「今天」/「在等」两区）。**停滞阈值与开口步口径共用这一份，落区方不自行判定。** 但两者的**去重口径刻意不同**：`todoTrackRows` 只认 `useTaskTrackIndex` 的 `claimedTrackIds`，不复用 `buildProgressItems` 的 `consumedTrackIds`——后者多一道「被认领的任务本身要进面板」的条件，轨道挂在子任务上时两处判定相反，同一条轨道会既有徽章又独立成行。

**`buildProgressItems` 没有 UI 消费方**：待办页的轨道行走 `todoTrackRows`，不经本函数。

## 2. 五个桶

| 桶 | 标签 | 语义 |
|---|---|---|
| `doing` | 在做 | 已经动手了 |
| `waiting` | 在等 | 该动没动 |
| `queued` | 在排 | 已决定要做，还没轮到 |
| `todo` | 待办 | 还没分类 |
| `settled` | 已了结 | 不需要再看 |

`PROGRESS_BUCKET_ORDER` 的数组顺序即显示序。

**桶只回答「能不能动」，不回答「轮到谁」**——单人系统里没有第二个人，协作语义（等我接 / 等对方）在这里没有生产者。

## 3. 判桶

### 3.1 Task（`bucketForTask`）

先排除两类，返回 `null` 表示不成行：重复模板本体（`recurrence !== null`）、已跳过的发（`ruleId !== null && skipped`）。

**子任务曾经也在排除之列，阶段3 起不再排除**——子任务能有自己的前置、能升格轨道、能排日期，把它挡在推进轴外就看不见「这条子任务在等谁」。

**排除必须跑在 `placementForTask` 之前**：`{ pool: "recurring" }` 只在 `task.recurrence` 非空时产生（`tasks/placement.ts:62`），而那类已被第一条排除挡掉，所以判定链里**不可达**、也就没有对应分支。谁把排除挪到 `placementForTask` 之后，`recurring` 会落到最末的 `todo`，重复模板本体就会漏进面板。

其余按**优先级链**取第一个命中的：

| 序 | 桶 | 判据 |
|---|---|---|
| 1 | `settled` | `placement.pool === "completed"` |
| 2 | `doing` | `sessionId === 活跃场 id` |
| 3 | `doing` | `placement.pool === "today"` |
| 4 | `waiting` | **结构式**：`ctx.blockedBy` 里有未完成的前置 |
| 5a | `waiting` | **时间式**：`placement.pool === "inbox" && scheduledAt !== null` |
| 5b | `waiting` | **时间式**：`isTaskSunken(...)` |
| 6 | `queued` | `placement.pool === "upcoming"` |
| 7 | `queued` | 是某 active project 的成员 |
| 8 | `todo` | 其余 |

**判定一律走 `placementForTask` 的结果，不自行比较日期**——时区与 `localDayIndex` 口径只有一份。

**序 4 排在时间式之前**：「说得出在等什么」比「沉太久了」更具体，两者同时成立时前者的信息量更大。数据来自 `ctx.blockedBy`（调用方用 `buildBlockedByIndex` 算好塞进来，见 [task-relations](task-relations.md) §4），**这个字段可选**——不传就退化成没有结构式 waiting 的行为，不会因为某个调用方没接就崩。

**但 `buildProgressItems` 这条路上塞不进来**：`ProgressAxisInput` 没有对应字段，它构造 `ctx` 时 `blockedBy` 恒缺省，所以经它产出的推进单元只有时间式 `waiting`。目前无碍——`buildProgressItems` 没有 UI 消费方；将来接面板时要先给 `ProgressAxisInput` 补字段，否则结构式 `waiting` 会静默缺席。

**5a 与 5b 结构互斥**：一次性任务排期过期时 `placementForTask` 返回 `{ pool: "inbox" }`（`tasks/placement.ts:78`「非重复待办过期不堆在今天，回归收件箱」），无排期任务也返回 `inbox`，**两者靠 `scheduledAt` 是否为 null 区分**；而 `isTaskSunken` 自身就排除了 `scheduledAt !== null`（`tasks/gravity.ts:36`），够不着 5a 那类。逾期 occurrence（`ruleId !== null`）走 `placement.ts:72` 落 `today`，因此归序 3 `doing`——重复规则的这一发逾期了仍是今天要补的事。

**时间式 `waiting` 跟随重力设置**：5b 读 `/settings/todo-gravity` 的水位线天数、顶一下加成、新建保护期。重力关闭时 5b 恒不命中，5a 与序 4 仍生效。同一个「多久算旧」只有一份设置。

**待办页分区的优先级与本表刻意不同**：`listTasks` 把「被挡」排在「排了今天」**之前**，被挡的任务不进「今天」区。两层回答的问题不同——判桶回答「这条活是什么状态」，分区回答「它该出现在哪个区」，而用户不该在「今天」看到做不了的活。改动任一层的顺序前先读这一条。

### 3.2 Track（`bucketForTrack`）

| 桶 | 判据 |
|---|---|
| `settled` | `status !== "active"`（concluded / parked 都算） |
| `waiting` | 空闲超 `STALL_THRESHOLD_MS`（7 天） |
| `doing` | 有开口步（`endedAt === null`） |
| `queued` | 一步都没有 |
| `doing` | 有步、全闭合、且新鲜 |

停滞判定复用 `dispatchItems` 的口径（`tracksDispatch.ts:64-67`）：取 `lastActivityAt(steps)`，无步则用 `track.createdAt` 兜底——建了一直没动笔同样算停滞。

**`waiting` 刻意排在开口步之前**：挂着开口步但十几天没动，真相是卡住而不是在做。现有 `classify` 也是把 `stalled` 排在 `agent-running` 之前的同一判断。

### 3.3 Goal（`bucketForProject`）

只收 `status === "active"` 的 project。成员按各自类型判桶后 roll-up：

| 桶 | 判据 |
|---|---|
| `doing` | 任一成员在 `doing` |
| `settled` | 有成员且全部 `settled` |
| `waiting` | 无人在做，且所有未了结成员都在 `waiting` |
| `queued` | 其余 |

零可解析成员的目标不成行（返回 `null`）。

**两种成员都参与 roll-up**：`GoalMemberRef.kind` 是 `"task" | "track"`（`entitySchemas.ts:86-89`），task 成员按 §3.1 判、track 成员按 §3.2 判。只算 task 成员会让「成员全是轨道」的项目整个从面板消失。

**三种 `waiting` 的来源各不相同，别当成一个**：Goal 的是结构式（队列里还有没有能动的）；Track 的是时间式（空闲超阈值）；Task 的**两种都有**——阶段3 起有了前置关系表，「在等某条具体的活」是结构式的（序 4），「沉太久」仍是时间式的（5a/5b）。阶段3 之前这里写的是「单条任务没有结构可算」，那时确实没有。

`bucketForProject` 的入参只有桶数组、看不见成员种类：调用方各自判好桶再喂进来。

## 4. 推进单元与去重

行的类型是 `ProgressItem`，`kind` 为 `task` / `track` / `project`。去重规则决定同一件事出现几次：

1. **任务挂了 active 轨道 → 合并成一行**，`kind="task"`，`taskId` 与 `trackId` 都非空。反查走 `findActiveTrackForTask`（`taskTrackIndex.ts:11`）。
2. **轨道没指向任何存活任务 → 独立一行**。`refs` 指向已删除任务的是失效引用（[tracks](../tracks.md) 明写删除任务不解链），那种轨道仍要成行，否则会从面板上消失。
3. **项目组一行，其成员仍各自成行**——组是概览，成员是可动手的对象。同 project-zone「一条被抓到手头的成员仍留在项目区」。
4. **一任务挂多条 active 轨道 → 取 `updatedAt` 新者**。`findActiveTrackForTask` 的仲裁是严格大于，**并列时保留数组序在前者**。这里刻意不另立仲裁：todo 行的轨道徽章走的是同一个函数，面板自己算一套会让同一个任务在两处指向不同轨道。
5. **一轨道 refs 指多个任务 → 只合并到 `refs` 数组下标最小、且在库中查得到的那个**，其余任务各自独立成行、不带轨道。用下标而非 `updatedAt` 之类的动态键，同一份数据两次渲染才会合并到同一个任务上。

**桶冲突取任务的桶**，不取轨道的。轨道归档而任务未完成时，面板该显示这件事还没完。这条也传递到 roll-up：被合并进任务行的轨道，项目组算它的桶时用任务的桶，避免面板显示已了结而组内算在做。

## 5. 进度与排序

`ProgressMeter` 三种口径，互斥：

- `{ kind: "subtasks", done, total }` — 任务有子任务，`skipped` 从分母剔除
- `{ kind: "steps", count }` — 挂了轨道，**不减已闭合的步**
- `{ kind: "members", done, total }` — 项目组，`done` 数 `settled` 成员

任务同时有子任务和轨道时取步数。都没有则为 `null`。

排序按 `lastActivityAt` 倒序、空值沉底：轨道用 `lastActivityAt(steps)`，任务用 `updatedAt`，项目组用成员的 `max(updatedAt)`。**不做用户自定义排序**——面板是总览，排序应当自动反映什么在动。

## 6. 不变量

1. **本层纯读**：不写库、不改入参、不就地重排传入的数组。`progressAxis.test.ts` 的「正交性」一组是守这条的回归哨兵——现在恒绿，谁往这层加写操作就会红。
2. **不改既有投影**：`placementForTask` / `dispatchItems` / `latestTrackBoardSignal` / `listTasks` 的输出不因本层被调用而改变。
3. **依赖方向单向**：本层是 `tasks/**`、`tracksView`、`tracksDispatch`、`taskTrackIndex` 的**上层**消费者，不被它们 import。同 `taskTrackIndex` 的既有落点理由。
4. **`projectMemberIds` 只收 task 成员**（§3.1 序 6 判的是「任务是否属于某项目」），而 §3.3 的 roll-up 收两种成员。两处口径不同是刻意的。
