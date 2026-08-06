---
type: evergreen
title: 待办 · 手头
covers:
  - packages/client/src/lib/sessions.ts
  - packages/client/src/pages/todo/AtHandSection.tsx
  - packages/server/src/lib/session-rows.ts
contracts:
  - packages/client/src/lib/sessions.ts
last-reviewed: 2026-08-06
---

# 待办 · 手头

> [todo](../todo.md) 的子文档。手头 = **软会话**（`Session` 实体，只存 `{id, startedAt, endedAt, note, createdAt, updatedAt}` 元数据）+ `Task.sessionId` 反挂指针：用户"抓"几条 root 任务放进当前场，做完/散场后场行归档但不删除，任务的 `sessionId` 保留作历史归属。手头不是新的任务分类，是运行在既有 `tasks` 表之上的一层"当前在忙什么"投影。
> 本文讲：单活跃场判定、抓/移/散/续四个动作的事务与 syncLog、`sessions` 域登记、`listTasks` 里的排他投影规则、续场的场迁移语义、读纯写显式自愈规则、关键不变量与测试清单。
> 不讲：Task 字段全貌与四分区落点（见母文档 [todo](../todo.md)）、同步账本与域登记簿机制（见 [sync](../sync.md) / [sync/domain-registry](../sync/domain-registry.md)）。

## 承上启下

- **上游**：`TaskRow` 行尾 overlay 按钮 / `TaskList` 滑出菜单「抓到手头」/ `TaskDetailSheet` 抽屉按钮三处入口调 `grabTaskToHand`；`AtHandSection` 顶部区「散场」调 `endActiveSession`，行内「移出手头」调 `releaseTaskFromHand`，无活跃场时的「续场」调 `resumeSession`。`TodoPage` 把同一份 `rowHandlers.onToHand` 透传给今天/收件箱列表、翻牌复查区（`GravityReviewSection`）和水下找回尾部（`SunkenInboxTail`/`SunkenScheduledTail`），三者共享同一套抓取入口（见 §7.3）。
- **下游**：`lib/tasks.ts: listTasks()` 出桶时读 `getActiveSession()` 做排他投影（见 §4）；`TodoPage` 用 `useEffect` 在 `buckets.handSession?.id` 变化时触发 `healActiveSessions()`。
- **契约**：`Session` schema 见本文 §3；生命周期动作签名（`grabTaskToHand` / `releaseTaskFromHand` / `endActiveSession` / `resumeSession` / `getActiveSession` / `healActiveSessions`）落在 `lib/sessions.ts`，本文 §2/§5/§6 描述其语义合同。
- **邻居**：[todo](../todo.md)（`Task.sessionId` 字段落在 Task schema 里、四分区落点、模块速查）、[todo/gravity](gravity.md)（重力只作用于排他投影之后的 inbox）、[sync/domain-registry](../sync/domain-registry.md)（`sessions` 域登记）、[data-model](../data-model.md)（Dexie v16 / SQL 映射）。

## 1. 概念：软会话 + 单活跃场

"手头"回答的是"我现在正在忙哪几件事"，不是新的任务状态：

- **`Session`** 只是一段时间区间的元数据：`{id, startedAt, endedAt, note, createdAt, updatedAt}`。它自己不持有任务列表——任务经 `Task.sessionId` 反过来指向它。`note` 是活跃场的随时可改小便签：`AtHandSection` 标题位展示（空回落显示「手头」），点标题行内编辑（Enter/失焦保存、Escape 取消、输入层 `maxLength=200`），经 `updateSessionNote` 写入（trim 后空串归一存 `null`）。散场不清 note，随场归档；续场列表态标题不可编辑、不消费历史场 note。
- **活跃场** = `endedAt === null` 的行里 `startedAt` 最大的那个（`getActiveSession()` / 内部 `pickActive()`）。正常情况下全库只有 0 或 1 个活跃场；抓活时零仪式自动开场，找不到活跃场才新建，已有活跃场就复用。
- 任意时刻至多一个活跃场是**期望不变量**，不是数据库约束——跨设备并发开场可能短暂产生多行 `endedAt===null`，靠 §6 的显式自愈收敛，不靠事务锁或唯一索引。

## 2. 数据流：抓 / 移 / 散 / 续

四个动作都在单个 Dexie `transaction("rw", ...)` 内完成，业务写入与 `syncLog` 同事务：

```text
抓活 grabTaskToHand(taskId)
  → 校验：root 且非重复模板且非 skipped occurrence（否则 throw，见 §7.1）
  → 无活跃场 → 零仪式新建 Session（create + syncLog）
  → putTaskSessionId(taskId, active.id)（tasks update + syncLog）

移出 releaseTaskFromHand(taskId)
  → 只把 Task.sessionId 置 null；Session 行不动

散场 endActiveSession()
  → 只把当前活跃场 Session.endedAt 置当前时间（update + syncLog）
  → 任务行（含其 sessionId）一律不碰——历史归属靠 sessionId 保留还原

续场 resumeSession(sessionId)
  → 见 §5
```

抓取的三道校验（`parentId !== null` 拒 / `recurrence !== null` 拒 / `skipped` 拒）都在 `grabTaskToHand` 内部执行，与三处 UI 入口的按钮可见性判定（§7.2）各自独立、互为纵深防御——UI 判定放宽或漏判，`grabTaskToHand` 仍会 throw，不会写出非法状态。

## 3. Session schema 与 sessions 域登记

```ts
// entitySchemas.ts: SessionSchema
{
  id: string;
  startedAt: string;       // UTC ISO
  endedAt: string | null;  // null = 活跃
  note: string | null;     // 默认 null，最长 200
  createdAt: string;
  updatedAt: string;       // 服务器分配
}
```

`sessions` 是普通 LWW 域（`syncDomains.ts`，`upsertPriority`/`deletePriority` 74，`countsInStatus:false`），零自定义 `validate`/`apply`，与 `tasks`/`tracks`/`goals` 走同一套通用 LWW 路径。服务端行映射 `sessionToRow`/`rowToSession`（`server/src/lib/session-rows.ts`）不写 `updated_at`（服务器记账时分配）。Dexie v16 新增 `sessions: "id, startedAt, updatedAt"` 表，`tasks` 索引串加入 `sessionId`，SQLite `tasks` 幂等补 `session_id` 列 + `idx_tasks_session_id` 索引；client upgrade hook 给旧 `tasks` 行补 `sessionId=null`，`SCHEMA_NORMALIZATION_VERSION` 同步跟随到 8 作双保险。`sessions` 客户端 backup 角色是 `bundled`（完整备份携带，但**不进** force-push 五域兜底契约，见 §7.4）。完整域登记 checklist 见 [sync/domain-registry](../sync/domain-registry.md)。

`Task.sessionId: string | null`（默认 `null`）是唯一挂钩：普通 create/update/delete 语义不变，`sessionId` 只是 `tasks` 域里新增的一个结构化字段，不新增同步域、不扩展 `SyncPushReasonCode`（与 `weight`/`ruleId` 同类先例）。

## 4. atHand 投影规则（`listTasks` 排他分桶）

`listTasks()` 每次出桶时先 `getActiveSession()` 拿到 `handSessionId`，再在四分区分桶循环最前面做排他判定：

```ts
if (handSessionId !== null && t.recurrence === null && (t.sessionId ?? null) === handSessionId) {
  atHand.push(t);
  if (!t.done) continue; // 未完只在手头；done 继续落 completed（战果双显）
}
```

规则拆开讲：

1. **排他**：root 且 `sessionId === 活跃场id` 的未完任务只出现在 `atHand`，不再进 `today`/`inbox`/`scheduled`——`continue` 短路了后续的 placement/scheduled 分支。
2. **done 双显**：本场已完成的任务不 `continue`，会继续走原有 placement 落进 `completed`——因此它同时出现在 `AtHandSection`「本场已完成」折叠区和主列表「已完成」区，两处显示的是同一行数据，不是两份状态。
3. **skipped/模板排除**：`t.recurrence !== null`（重复模板本体）与 `t.ruleId !== null && t.skipped`（已删·跳的发）在这段判定之前就被上层循环过滤/绕开，不会进入手头分桶。occurrence（`ruleId!==null && recurrence===null`）本身是普通 root 语义，可以被抓；模板本体不行（见 §7.1）。
4. **散场自然回桶**：`endActiveSession()` 不改任务的 `sessionId`，只是活跃场从此换成别的/none；下次 `listTasks()` 算出的 `handSessionId` 不再等于该任务的 `sessionId`，判定自然为假，任务落回原有 placement 分区。**这不是一次迁移操作，是投影结果**——没有代码"把任务搬回收件箱"，只是排他条件不再成立，零写零迁移。
5. 想法重力的水位线/翻牌只作用于**排他后**的 inbox（见 [todo/gravity](gravity.md)）：手头任务已被排他判定拿走，不会同时被重力沉底或抽入翻牌区。
6. **区内拖拽重排**：手头区未完成行是 sortable（容器 `hand`，`AtHandSection` 未完行注册 `SortableTaskRow` 并渲染拖柄），重排走 `persistTaskOrder` 槽位回填这些行的全局 `sortOrder`——只交换手头行之间的值，不影响其他任务；`updatedAt` 会被推到当下（重置重力下沉时钟，与池内重排同级副作用）。散场回桶：**today 按新序保留**（today 排序键含 sortOrder），**inbox 不保留**（收件箱显示序 = createdAt 分天 + 段内 createdAt 倒序，不读 sortOrder——见 [invariants](invariants.md) 第 5 条「池同容器重排只有今天」的同一理由），这是已知取舍。手头重排同步反映到项目区同组段内序（`sortProjectMembers` 段内保持全局 sortOrder 序）。手头行**整行不开放拖出手头**——这句特指**投递坞**：`todoDockTargets` 对 `hand` 源返回空坞，`resolveTodoDockDrop` 拦 invalid，坞不对手头源显示任何药丸——左拉现身机制下连左缘细提示条都不出（细条是坞的预告，无坞则无预告，见 [invariants](invariants.md) 第 14 条）；它与下文「经缩进手势收纳为别处的 child」是两条不同路径，不要混读。「本场已完成」折叠区行不注册 sortable。判定层细节见 [invariants](invariants.md) 第 5 + 12 条。

**手头行参与缩进**（`clampTodoIndentPreview` 对 `hand` 按 root 基线夹 `[0, 28]`，阈值与池容器同一套 `resolveIndentLevel` 常量）：右移越线可把手头行收纳为候选 root 的 child，子任务列表以 `draggable` 模式渲染。收纳落库走 `nestTaskUnderParent`，被收纳行的 `sessionId` 同事务置空——**它因此退出手头**，跟着父显示。

**手头作为收纳落点只认手头来源**：`hoveredRootIdFromOver` 仅当拖拽来源也是 `hand` 时才把手头行当候选 root，外区来源返回 `null`（外区任务归到手头某件活底下的路径是先入手头、再在区内收敛）。该守卫落在这一层而非落点派发层，因为收纳高亮（`handleDragOver`）与落点派发共用同一函数，只拦落点会留下「亮了高亮却无反馈」。反方向不设防：`over` 落在池容器时走 pool 分支、不判来源，故手头行右移悬停在今天/收件箱某行上会收纳为该行的 child（并因清 `sessionId` 而脱离手头）。

**子任务回手头**：子任务拖到 `hand` 容器或投手头坞，走 `promoteTaskToHand`——先 `promoteToRoot(…, "inbox", …)` 升根再 `grabTaskToHand`。落 `"inbox"` 而非 `"today"`：抓到手头与排今天正交，`promoteToRoot` 会按 pool 写 `scheduledAt`，落 `"today"` 等于替用户排期。两步串行不合事务，中途失败是「升了根、落回它自身字段决定的分区（通常是收件箱；降级不清能力字段——见 [todo](../todo.md#todo-s2-2)——子任务可能带休眠 `recurrence`，升根后规则复活，会落重复管理区而非收件箱）」——可见可重试，非不可观测态。项目区有同款姊妹动作 `promoteTaskToProject`（组内子任务升根留在本组，先 `promoteToRoot(…, "inbox", …)` 再 `assignTaskToProject`），同样两步串行、同样的中途失败形状。

**标题计数口径**：手头标题右侧的数字读 `TodoBuckets.atHandPendingTotal` = 手头未完 root 数 + 这些 root 名下未完 child 数。子任务被投影层按 `parentId` 早退丢出所有桶，`atHand` 数组里只有 root，故该计数在 `listTasks` 里另从全表按 `parentId` 反查累加。这一口径**与收件箱/今天区的 root 计数不同**且是刻意的：那两区是清单，数 root 合理；手头是工作台，把几条活压成父子只是整理结构，活的件数没变。**项目区走同一口径**（组标题三个数全含子任务，理由同上——组是一份承诺，不是清单；见 [project-zone](../project-zone.md)），两处反查同在 `listTasks` 里、同样剔 `skipped`。

## 5. 续场 = 散当前场 + 开新场 + 迁移未完任务

`resumeSession(sessionId)`（`ResumableSession` 数据源 `listResumableSessions()`：`endedAt !== null` 且仍有 `!done && !skipped` 任务的场，按 `endedAt` 倒序取前 `limit` 个）：

```text
1. 若目标场本身就是当前活跃场 → 幂等 no-op（见下）
2. 若存在另一个（不同的）活跃场 → 先散场（该场 endedAt=now，写 syncLog）
3. 开一个全新 Session（不是把旧场 endedAt 清空复活）
4. 把「目标场」里 !done && !skipped 的任务批量把 sessionId 改指向新场
5. 目标场自身保持 endedAt 不变（它已经散过，续场不改写它的 endedAt）
```

不变量：

- **续场永远新建一个 Session**，绝不复活旧场（`endedAt` 单向只增不减）；旧场此后仍是一段已归档的历史区间。
- **done 留旧场**：只迁移未完成任务；已完成的任务 `sessionId` 继续指向原场，历史战果不随续场漂移。
- **对活跃场自身幂等 no-op**：如果传入的 `sessionId` 恰好是当前活跃场（例如跨设备并发下 UI 还持有一份 stale 的可续场列表），`resumeSession` 直接返回该场，不散场、不建新场、不迁移、零写——防止对自己续场产生一个多余的双活跃僵尸场。

## 6. 自愈规则：读纯写显式分离

- **`getActiveSession()` 是纯读**：`toArray()` 后在内存里挑 `endedAt===null` 中 `startedAt` 最大者（并列再比 `id`），不做任何写入，可以安全放在 `listTasks()` 这类被 `useLiveQuery` 反复重跑的路径里——纯读不会触发 liveQuery 的写后重新订阅循环。
- **`healActiveSessions()` 是显式自愈**：只有它会把"非最新的那些 `endedAt===null` 残留行"补上 `endedAt`，收敛回单活跃场。它必须由业务代码显式调用（`TodoPage` 用 `useEffect(() => void healActiveSessions(), [buckets.handSession?.id])`——依赖当前解析出的活跃场 id，只在其变化时跑一次），**不能塞进 `listTasks()`/`getActiveSession()` 内部**：`useLiveQuery` 的回调里如果发生写入，会把这次写入自己观测到的变化当成新一轮变化重新触发，读写混在一起容易死循环或产生竞态重复写——这是"读纯写显分离"存在的直接原因。
- 自愈是幂等的：收敛后再跑一次是零写（`healActiveSessions` 内部 `rows.length <= 1` 提前退出）。

## 7. 关键不变量 / 坑 / 红线

1. **`sessionId` 是历史归属指针，不是"当前状态"标记**：一个任务的 `sessionId` 只表示"它曾被抓进哪一场"；判断"是否在手头"永远要结合"该 `sessionId` 是否等于*当前*活跃场 id"，不能只看 `sessionId !== null`。散场/续场都不清空它；**清空只发生在两处**：**移出手头**（`releaseTaskFromHand(taskId)` 只把 `Task.sessionId` 置 `null`，见 §2）与**降级为子任务**（`moveTaskToParentInCurrentTransaction` 写回时置 `null`）——子任务不持有任何归属指针（见母文 [todo](../todo.md#todo-s2-2)）。后者这条清理是必需的：`listResumableSessions` 按 `sessionId` 直查且不排除子任务，指针留着的话，一条已成为子步骤的活会继续被算进「这个场还有 N 条未完」，续场时还会被批量迁到新场。occurrence 完成后物化出的下一发**不继承** `sessionId`——手头是"这一发在忙"的标记，不随重复规则引擎滚动到下一发。
2. <a id="at-hand-grab-hard-reject"></a>**模板与 child 不可抓，occurrence 可抓**：`grabTaskToHand` 拒绝 `parentId !== null`（子任务）、`recurrence !== null`（重复模板本体）与 `skipped` 的 occurrence；重复规则物化出来的 occurrence（`ruleId!==null && recurrence===null`）是普通 root 语义，可以被抓。子任务进手头**不是绕过这条硬拒**，而是 `promoteTaskToHand` 先升根再抓——进 `grabTaskToHand` 时它已是 root，硬拒依然成立，只是不被这条路径触发。
3. **三处入口的可见性判定各自独立、不完全相同**：`TaskRow` overlay 与 `TaskList` 滑出菜单都用 `recurrence===null && pool!=="completed"`；`TaskDetailSheet` 抽屉按钮用 `parentId===null && recurrence===null && !task.done`。UI 判定只影响按钮是否渲染，真正的红线在 `grabTaskToHand` 内部三道校验（§2），两层判定不同步不会破坏数据，只可能出现"按钮该出现没出现"的体验问题。翻牌复查区与水下找回尾部经同一份 `rowHandlers.onToHand` 透传同样具备抓取入口——**这是有意为之**：想法重力的翻牌/水下找回本身是收件箱任务的替代视图，理应享有同样的操作面，不是遗漏未收窄。
4. **手头不是新写入路径**：抓/移/散/续全部经既有 `tasks`/`sessions` 两个 LWW 域的普通 create/update，不新增写入通道，也不改变 `tasks` 的 force-push 契约。`sessions` 域本身不在 force-push 五域兜底范围内，但 `sessionId` 作为 `tasks` 字段仍随 `tasks` force-push 一起搬运——极端场景下可能在对端留下一个指向"尚未同步过来的 session"的悬空 `sessionId`；这只是历史归属指针失效，不影响任务本身，也不会被误判成活跃场（`getActiveSession()` 只从 `sessions` 表本身取活跃场，不会凭空对上一个不存在的 id）。
5. **演化口子（本期均不做，仅记录方向、不构成设计承诺）**：时间轴联动（拿 `startedAt`/`endedAt` 在 timeline 上画出手头区间）、战役常驻卡（把 `Session` 历史做成可回看的"战役"卡片，历史场的 `note` 便签可复用为卡片标签）、战报（按 `sessionId` 聚合一场做了什么生成摘要）。这三个方向都只需读现有 `Session`/`Task.sessionId` 数据，不需要现在改 schema。

## 8. 模块速查

| 入口 | 职责 |
|---|---|
| `lib/sessions.ts` | 生命周期：`getActiveSession`（纯读）/ `healActiveSessions`（显式自愈）/ `grabTaskToHand` / `releaseTaskFromHand` / `endActiveSession` / `listResumableSessions` / `resumeSession` / `updateSessionNote`（场便签） |
| `pages/todo/AtHandSection.tsx` | 手头区 UI：沿用待办区「独立标题行 + 等宽行面板」骨架；活跃场显示未完列表 / 「本场已完成」折叠 / 散场按钮，无活跃场时显示续场行列表，全无则隐藏；未完行是 sortable（容器 `hand`）并渲染拖柄，区内拖拽重排（见 §4.6） |
| `server/src/lib/session-rows.ts` | `sessionToRow` / `rowToSession`：SQL ↔ JS 映射，不写 `updated_at` |
| `pages/TodoPage.tsx`（归 [todo](../todo.md) covers） | 接线：`buckets.atHand`/`handSession` 渲染 `AtHandSection`；`rowHandlers.onToHand` 透传给 `TaskRow`/`TaskList`/`TaskDetailSheet`/`GravityReviewSection`/`SunkenInboxTail`/`SunkenScheduledTail`；`useEffect` 触发 `healActiveSessions` |
| `lib/tasks.ts: listTasks()`（归 [todo](../todo.md) covers） | `TodoBuckets.atHand`/`handSession` 字段与 §4 的排他投影判定 |

测试：`lib/sessions.test.ts`（抓/移/散/续/自愈/可续列表全部行为，含幂等 no-op；`updateSessionNote` 写入/空串归 null/不存在场 throw）、`pages/todo/AtHandSection.test.tsx`（活跃场渲染/移出/续场行/全无隐藏；场便签标题显示回退/行内编辑保存与取消/续场态不可编辑；拖柄：未完行渲染/已完成行不渲染/续场态不渲染）、`pages/TodoPage.test.tsx`（手头区键盘拖拽重排：sortOrder 落库 + 视图顺序更新）、`lib/tasks.test.ts`（`describe("listTasks atHand 投影")`：排他、done 双显、散场回桶、指向已散场 sessionId 不影响分桶、occurrence 物化下一发不继承 sessionId）、`pages/todo/todoDnd.test.ts`（hand 容器：解析/id 往返/同容器 reorder/拖池与拖项目 null/缩进父 null/坞不显示/坞落点 invalid/clamp 夹 0）、`pages/todo/TaskRow.test.tsx`（overlay 抓取入口按钮 + 重复模板不渲染 + 不传 onToHand 不渲染）、`pages/todo/TaskDetailSheet.test.tsx`（抽屉抓/移按钮）、`shared/src/entitySchemas.test.ts` / `shared/src/syncDomains.test.ts`（`SessionSchema` + `sessions` 域注册）、`server/src/db/schema.test.ts`（`session_id` 列 + 索引幂等补齐）、`server/src/sync/domains.test.ts`（sessions 域注册）、`client/src/sync/clientDomains.test.ts`（sessions 客户端域 + bundled backup）、`client/src/db/schemaNormalization.test.ts`（`sessionId` 归一）。
