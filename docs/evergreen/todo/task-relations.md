---
type: evergreen
title: 待办 · 前置关系表
covers:
  - packages/client/src/lib/taskRelations.ts
  - packages/client/src/lib/goalPrerequisiteHydration.ts
contracts:
  - packages/shared/src/entitySchemas.ts:TaskRelationSchema
  - packages/shared/src/taskRelations.ts
  - packages/client/src/lib/taskRelations.ts
last-reviewed: 2026-08-18
---

# 待办 · 前置关系表

> [todo](../todo.md) 的**子文档**：「A 挡着 B」这件事存在哪、谁在读、什么时候被清掉、恒满足什么。
> 不讲：一层父子（那是 `Task.parentId`，见 [todo](../todo.md) §2）、推进桶语义（见 [progress-axis](progress-axis.md)）、目标成员模型（见 [project-zone](../project-zone.md)）。

## 1. 它是什么

一张**独立的表** `taskRelations`，一行 = 一条有向边「blocker 挡着 blocked」。两端各自可以是任务或轨道，四种组合都合法。

```ts
{ blockerKind: "task" | "track", blockerId, blockedKind, blockedId, type: "blocks", createdAt, updatedAt }
```

主键是**四元复合键** `[blockerKind+blockerId+blockedKind+blockedId]`（Dexie 与 SQLite 两端一致），因此同一对端点之间最多一条边，重复写入是幂等的。`type` 目前只有 `"blocks"` 一个取值——留着这一列是为了以后加关系类型时不必改主键。

**为什么独立成表，而不是挂在任务上**：前置是**多对多**且两端异质（任务能被轨道挡）。挂成 `Task.blockedBy: string[]` 要么存不下轨道端，要么让每次连边都变成对两条任务记录的写——而 LWW 同步下并发改同一条任务会整条覆盖，边就丢了。独立成表后每条边是自己的同步单元，两台设备各连各的边不会互相覆盖。

## 2. 一层父子不在这张表里

**父子关系仍然是 `Task.parentId`**，没有搬进关系表。

这一条与阶段2 拍板文里的措辞（「父子与前置合并成一张关系表」）不同，以本文为准：实际落地只搬了前置边。父子留在 `parentId` 的理由是它**恒为一层**、且承载排序与级联删除语义，搬进通用关系表会把那些语义摊平成需要额外校验的约定。子任务的松绑（能升格轨道、能有自己的前置、能排日期）是在 `parentId` 结构不变的前提下逐条解除守卫做到的。

## 3. 不变量

1. **无自引用**：schema 层 `superRefine` 拒绝两端相同的记录，写入层 `addTaskRelation` 另抛 `RELATION_SELF_REFERENCE`。两道都在是因为 schema 挡的是「存进去的数据」，写入层挡的是「用户点了自己」——后者要给人话提示。
2. **无环**：`addTaskRelation` 在事务内跑 `wouldCreateCycle`（从 blocked 端出发沿 blocker→blocked 方向 DFS，走得回 blocker 就是环），命中抛 `RELATION_WOULD_CREATE_CYCLE`。**环检测只在本地写入路径上**——从远端同步下来的边不检测，见 §7。
3. **前置完成或消失即自动解锁**：没有「已满足」标记位。`buildBlockedByIndex` 构建索引时跳过两类 blocker——**已完成的**（勾掉前置的那一刻被挡的那条就不再被挡）与**已不存在的**（指向已删任务/轨道的悬空边）。后者由调用方传入的 `liveKeys` 判定，**该参数必传**：给默认全集会让「忘了传」静默退回「悬空边永远挡着」的旧行为，而那会让被挡的活从「今天」区消失、卡在「在等」区显示「等（已删除）」，只能手动删边才解得开。**不存已解锁状态**是刻意的：存了就要维护，而它可以从两端的存活与完成态算出来。
4. **端点悬空不阻塞读取**：blocker 指向的任务被删而边还在时，界面显示「（已删除）」占位，不丢边也不崩（**也不再挡着被挡的一方**，见不变量 3）。正常路径下删除会连带清边（§5），悬空只出现在混合版本同步的窗口里。

## 4. 谁在读

三条消费链，口径同源但各取所需：

| 消费方 | 入口 | 拿到什么 |
|---|---|---|
| 待办页分区 | `listTasks` → `buildBlockedByIndex` | 被挡的任务分流进「在等」区，附 blocker 标题 |
| 项目组徽章与展开态 | `listTasks` → `TodoProjectGroup.blockedByMember` | 组内被挡成员 id → 挡着它的标题；徽章对可见成员求交计数，展开态据它沉底、画分界、标「等 XX」（见 [project-zone](../project-zone.md)） |
| 目标详情页 | `hydrateGoalPrerequisites` | 把边填回 `goal.prerequisites`，`splitGoalMembers` 等既有判定零改动 |

**`hydrateGoalPrerequisites` 是兼容层不是数据源**：`goal.prerequisites` 这个字段在库里已被迁移清空，读取侧每次把关系表的边填回内存中的 goal 对象，让阶段2 就写好的目标页判定逻辑不必改。**写入侧一律不碰这个字段**——有一道机器闸 `scripts/check-legacy-prerequisites.mjs` 盯着，任何往 `prerequisites:` 写非空字面量的代码都会让 `pnpm check:prereq` 红。

推进轴的 `bucketForTask` 也认这张表：被挡 → `waiting`。它与待办页分区的优先级**刻意不同**，见 [progress-axis](progress-axis.md) §3.1。

## 5. 什么时候被清掉

三个时机，都在调用方的事务内完成（保证「删任务」与「删它的边」不会只成一半）：

- **任务被删**：`deleteTaskCascade` 对 root 与每一条 child 各调一次 `removeTaskRelationsForInCurrentTransaction`。**子任务的边也要清**——它们能有自己的前置。
- **轨道被删**：同一个函数，`{ kind: "track", id }`。
- **成员被移出目标**：`removeTaskRelationsWithinScopeInCurrentTransaction`，只清「两端都在该目标成员内、且一端是被移出者」的边。**两端都在成员内**这个收窄是必须的：跨目标的边不该因为一次移出被连带删掉。

两个 `InCurrentTransaction` 后缀的函数**要求调用方的事务已经包含 `db.taskRelations` 与 `db.syncLog`**。Dexie 的事务作用域是声明式的，漏声明会在运行时抛 `NotFoundError` 而不是静默——但那要走到那一行才炸，所以新增删除路径时先看事务声明。

## 6. 同步

`task_relations` 是**自己的同步域**，不搭任何既有域的车。记录 id 是四元组编码出来的复合键（`taskRelationKey`），两端都用同一个编码函数，server 侧 `backfillSeq` 也按它算。

冲突策略与其他域一致（LWW）。边的语义使 LWW 在这里格外安全：一条边要么在要么不在，没有中间字段可以被部分覆盖。

## 7. 已知缺口

**混合版本同步会留下悬空边。** 一台还没升级的旧客户端删掉一条任务时，它只会推送 `tasks/delete`——它不知道关系表存在，不会推对应的 `task_relations/delete`。新客户端拉到这个删除后，指向该任务的边仍留在表里，显示为「（已删除）」。

不修的理由是修法都比病重：在 pull 侧对每个任务删除反查关系表，等于给每次同步加一轮全表扫描；而症状是一行占位文字，用户手动删掉那条边即可。**全部设备升级后此缺口自动关闭**。备份导入路径有同形的窗口。

**悬空边不再阻塞被挡的一方**（2026-08-18，阶段4）：判定层按存活端点筛掉它们，被挡的任务回到本该在的区。边本身不删——详情面板照样列得出来（显示为「（已删除）」），用户看得见、删得掉。根治点仍在同步 apply 的删除路径，不在读取侧。

**pull 尾部的补迁移会让已删的边复活。** pull apply 完会跑一次 `migrateGoalPrerequisitesToRelations`（`db/index.ts`），判据是「旧字段里有、关系表里没有」就重建并记 create。混合版本期这条判据有一面是错的：新客户端删边 E 并推 delete（服务端留 tombstone）→ 旧客户端本地 goal 仍带含 E 的旧字段，它编辑该目标任意字段就整行推上去、LWW 赢 → 新客户端 pull 到该 goal，补迁移把 E 重建出来并推回，边静默复活。

**复活是两害相权后选的那一害**：不跑补迁移的另一面是丢边——旧客户端推上来的整行把已迁移状态盖回旧字段，而没人再把它搬进关系表，边无声消失，用户看都看不见。复活至少可见，用户能再删一次。**备份导入是同一个补迁移的第二个窗口**：导入老备份会写入带非空旧字段的 goal，而导入路径不触发迁移（迁移只在启动时跑一次），导入后不重启就编辑该目标即同形，触发面更窄。两个窗口的共同根治方向是把迁移从「启动时跑一次」改成「任何写入 goals 的入口之后都跑」；**全部设备升级后前一个自动关闭**。

**环检测不覆盖同步下来的边。** 两台设备离线时各连一条边，合起来成环——本地都合法，同步后表里就有环了。当前后果有限：`buildBlockedByIndex` 不递归、只看直接前置，成环的两条会互相挡住（都进「在等」区），用户删掉任一条即解。真正需要拓扑序的功能（自动排下一步）出现之前不必修。
