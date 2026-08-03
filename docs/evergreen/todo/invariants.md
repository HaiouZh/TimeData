---
type: evergreen
title: 待办任务 · 不变量与坑
covers:
contracts:
  - packages/shared/src/types.ts:Task
  - packages/shared/src/entitySchemas.ts
  - packages/shared/src/taskCompletion.ts
last-reviewed: 2026-08-03
---

# 待办任务 · 不变量与坑

> [todo](../todo.md) 的**纵切子文档**：待办域恒满足什么、哪里踩过坑、哪些红线不能碰。
> 读它的时机与母文档不同——母文档回答「数据怎么流、字段是什么」，本文回答「为什么这么写、改了会炸哪」。
> 不讲：数据流与 Schema（见 [todo](../todo.md)）、各子域机制（见母文档的子文档索引）。

## 关键不变量 / 坑 / 红线

1. **完成走 occurrence 代理，模板不承载完成态**：非重复任务就地完成（`done=true` + `completedAt=now`），取消完成（仅客户端 `toggleTaskDone` 翻回）清 `completedAt=null`；重复模板完成代理到该 rule 的 occurrence——有 active 完成它，无 active 先按引擎物化到期发。client 人工入口在下一发未到期时会继续强制物化下一发并完成，允许提前消耗配额；server agent `done=true` 不提前完成，未到期/耗尽仍 409 `RULE_NOT_DUE`。模板的 `done`/`lastDoneAt`/`completedCount` 永不推进（纯遗留字段）；耗尽由账本判定（`isRuleExhausted`），耗尽模板保留 `recurrence`、由 `listTasks` 沉入 completed。落点判据：普通任务是 `done`（`placement.ts`），模板是账本。细节见 [recurrence](recurrence.md) §3。
2. **"取消完成"两端不对称（root only）**：agent root `done=false` 仅置 `done=false`、**不清 `completedAt`**，而客户端 root reopen 会清 `completedAt=null`（且对 occurrence 会连删后来物化的 active 发防双 active）。child 是例外：agent child `done=true/false` 走轻量路径并与客户端子任务勾选对齐（true 写 now，false 清 `completedAt=null`）。撤销完成的 root 语义两端不一致，是当前状态而非疏漏。
3. **schedule 端点绕过 applyChange**（见 [todo](../todo.md) §1.3）：tasks 有三条 server 写通道（sync push 的 LWW apply、agent status 的 applyChange、schedule 的事务内直写+记账），机制不同；schedule 必须保持提交后 SSE 通知。
4. **四分区是读时视图**：`today` / `inbox` / `scheduled` / `completed`，另有全量去重桶 `recurring` 供标签来源去重。`today` 只读 pending occurrence（`ruleId!==null && !skipped && !done`），重复模板不投影到今天，归入 `scheduled` 规则管理区；`scheduled` = 一次性未来排期 + 重复模板，按下一发生日升序，行内显示重复摘要与下一发生日，`listTasks` 同时给出 7 天水位线切点 `scheduledSunkenFromIndex`（第一个下一发生日超出「今天+7 天」的下标，本地日历口径与排序键一致），UI 把切点后的行折叠进 `SunkenScheduledTail`「更远还有 N 条」（搜索/标签过滤激活时水位线失效、命中即显示）；`completed` 收纳普通完成任务、done occurrence 与账本判耗尽的模板（`completedAt=null` 沉底），按 `completedAt` 倒序、**无日期过滤**；`scheduled` 内规则的下一发生日与耗尽判定读 occurrence 账本（`nextDueDate`/`isRuleExhausted`），不读模板游标。改 `recurrence` 或 `startAt` 视为重锚：`startAt` 移到新值或当下，同事务级联删旧活跃 occurrence 及其 children、即时物化；锚点前历史发保留但不计入配额/游标；规则/起始日未变则保留进度（见 [recurrence](recurrence.md) §3）。
5. **DnD 拓扑：顶层单一 `DndContext`，可拖区只有今天 / 收件箱 / 某 root 的 children / 手头区未完成行**。
   - **拓扑**：`TodoPage` 顶层一个 `DndContext`，下挂 droppable/SortableContext 命名空间 `pool:today` / `pool:inbox` / `parent:<rootId>` / 手头 `hand`；收件箱按天分段，**每段各建一个 SortableContext**（容器 id 都是 `pool:inbox`）。`upcoming` / `completed` / `recurring` / 水下找回尾部 **不参与拖拽**——每个任务在可拖范围内只渲染一次，draggable id 全局唯一。root 行拖拽 activator 在行左 2/5 区域（复选框独立 `stopPropagation`，右侧标题区保留打开详情/选词）。
   - **缩进判定**（`todoDnd.resolveIndentLevel`）：层级由横向位移**相对被拖项自身基线**判定，两侧带滞回防纵向排序抖动误触。

     | 起拖基线 | 判 child | 回落 root/child | 静止时 |
     |---|---|---|---|
     | root（从池起拖） | 右移 ≥28px | ≤12px 回 root | root |
     | child（从 `parent:*` 起拖） | 恒 child；左移越过 -28px 才升 root | 回 -12px 内回落 child | child |

     基线区分是关键红线：子任务竖直重排（delta.x≈0）必须保持 child，否则会被误判成 root 而 `promoteToRoot` 拽出父任务。`clampTodoIndentPreview` 按基线把横向预览夹到根 `0..28px` / 子 `-28..0px`；拖拽期 `.todo-dnd-dragging .swipeable-list-item` 只放开纵向 overflow、横向继续 clip，防右拖把 `<main>` 撑出横向可滚面。
       - **落点派发**（`handleDragEnd` → `todoDnd.resolveTodoDragWithIndent`，内层 `resolveTodoDragOperation`）：结合 active/over container、候选 root、目标池、root 是否已有 children 派发——同容器重排（池 `persistTaskOrder`、child `reorderChildren`、手头区 `hand` `persistTaskOrder`，见本文第 12 条）；child→pool→`promoteToRoot`；child→`hand`→`promoteTaskToHand`（升根落 `"inbox"` 再 `grabTaskToHand`，两步串行不合事务——中途失败是「升了根落在收件箱」，可见可重试）；root/child→合法候选 root→`nestTaskUnderParent`（追加到目标父 children 末尾、`nextChildSortOrder` 取 max+1 不撞值；带 children 的 root 即使右移也不能降级）；root 在今天↔收件箱互拖→`scheduleTask`/`unscheduleTask`；root（仅池容器、`activeParentId === null`）→ `project:<goalId>` → `assign-to-project`（**不动 `scheduledAt`**，归属轴与时间轴正交），子任务落在项目组一律判 `null`（不做「先升根再入组」的复合动作）。项目组容器的落点契约、碰撞策略与准入判定见 [project-zone](project-zone.md) §6。
   - **重排写入**：`persistTaskOrder` 在 Dexie transaction 内回填现有 `sortOrder` 槽位、更新 `updatedAt`、为每个变化项写 `syncLog`，只对同作用域 ids 使用。**重排是乐观的**：放手瞬间先以新序渲染（`applyOptimisticOrder` 按 containerId 覆盖显示序，手头区只重排未完成段），落库在后台，下一次 liveQuery 回流时乐观态收敛清除，落库失败回滚并 toast——避免「先弹回原位再硬跳」的两段视觉。**child 重排必须走 `reorderChildren`**（非 `persistTaskOrder`）：child `sortOrder` per-parent 独立，回填连续 `0..n-1`（只写变化行）以自愈撞值脏数据——撞值时槽位回填式算不出变化会静默不写、"拖了不动"。**池同容器重排只有今天**：收件箱显示序 = 按 `createdAt` 分天 + 段内 `createdAt` 倒序（`inboxGrouping.ts`），不读 `sortOrder`，落库既弹回又把 `updatedAt` 推到当下、重置该行的重力下沉时钟（`isTaskSunken` 读 `updatedAt`），故 `resolveTodoDragOperation` 对 `pool:inbox` 同容器直接返回 `null`；收件箱行仍注册 sortable——拖去今天（`schedule-root`）与缩进成子任务（`move-to-parent`）依赖它。
   - 拖拽中只高亮候选父、不提前展开真实 children；落定为 child 后目标父展开一次。
6. **`tags` 自由标签不驱动自动逻辑**（[ADR 0014](../../adr/0014-task-tags-vs-fields.md)）：只供人/agent 语义标记 + 展示/检索层消费——`filterTasks` 三轴 AND 过滤（含 AND/OR、排除 NOT、标题关键词），同一筛选投影覆盖普通任务池与项目区，手头区保持焦点隔离不受影响；标签色走 `lib/contentTint.ts` 的 `contentTint(标签名)`（确定性、不存储，见 [design-language](../design-language.md) §1），`TagFilterPanel` 底部召唤式三态填色带计数筛选面，`TaskRow` 行内最多 3 chip、着色的 `#` 标类型（圆点归项目）。项目区筛选的展开与空态契约见 [project-zone](project-zone.md) §5；需要代码可靠动作的维度应毕业为结构化字段。
7. **子任务 = 独立可拖 `Task`（`parentId` 一层）**：见 [todo](../todo.md) §2.2。child 勾选不联动父 `done`/`completedAt`（父进度 `m/n` 由 `InlineChildren` 实时聚合，不回写父行）。pending occurrence 物化时克隆模板当前 children 的标题 / `tags` / 顺序，但新 occurrence children 一律 `done=false`、`completedAt=null` 起步；Today 展开的是这一发自己的 children，不回退读取模板 children。scheduled 管理区展开重复模板时，规则行子任务复选框只代理显示/写入该 rule 最新非 skipped occurrence child（无 occurrence 时置灰），模板 child 本体不承载完成态。**重复 root 完成不动 children**：完成代理只写目标 occurrence 本体——client 侧 children 由物化引擎按模板克隆（`done=false` 起步），server agent 代理不镜像 children、也不 reset 模板 children（模板 child 的 `done` 无读方）。历史 occurrence 的 children 在「已完成」内只读显示。
8. **目标层只从 Goal 侧引用 Task**：Goal 可以把 Task 写入 `Goal.members` 并读取 `done` 计算项目完成度或主题活跃度，但不会改变 Task 的完成、重复、排序、子任务或排期语义。删除 / 归档 Goal 不改 Task 的上述任何语义，**只刷新受影响成员的 `updatedAt`**（见第 13 条，这是重力可见性所需，不是状态变更）；删除 Task 后，Goal 读取时把失效引用作为缺失成员提示。
9. **`tasks` 不引用分类/时间/速记/目标等业务域**：SQL 无外键，不参与分类校验/时间段重叠/时长统计/速记导入导出；目标组织关系属于 [goals](../goals.md)，不回流到 Task schema。
10. **轨道不是子任务系统**：`tracks` / `track_steps` 是独立监控域（见 [tracks](../tracks.md)），task 只会作为 `Ref{kind:"task"}` 被指向；轨道不镜像 `Task.done`、不回写父子进度，也不改变 `tasks` 的 force-push 契约。任务可挂轨道：行上徽章回显轨道信号、勾选附带归档该轨道（单向 best-effort，非镜像；桥的机制与落点见 [tracks](../tracks.md) §5）。
11. **想法重力只作用于 root inbox 展示层**：`Task.weight` 同步字段 + `updatedAt` 时间衰减，`TodoPage` 出桶后把 inbox 拆浮起/水下；`listTasks()`、排期分桶、tag/search、DnD 域登记都不感知。水位线 / 翻牌复查 / 已过目记忆 / 水下找回尾部 / 设置见 [gravity](gravity.md)。
12. **手头投影**：`Task.sessionId` 指向活跃 session 的 root（非重复模板）不进 `today`/`inbox`/`scheduled`，只出现在手头卡；散场零迁移自然回桶——`sessionId` 不清空，只是排他条件（等于*当前*活跃场 id）不再成立。`sessionId` 是历史归属指针，不是"当前状态"标记。手头区未完成行支持区内拖拽重排（容器 `hand`，只交换这些行的全局 `sortOrder` 槽位；散场后 today 按新序保留、inbox 不保留——收件箱不读 sortOrder）；手头行参与缩进，可被收纳为候选 root 的 child（`clampTodoIndentPreview` 对 `hand` 按 root 基线夹 `[0, 28]`），子任务可拖回 `hand` 容器升根站到手头；手头行整行不开放拖出手头——这句特指**投递坞**：`todoDockTargets` 对手头源不显示坞，`resolveTodoDockDrop` 拦 invalid，与「经缩进手势收纳为别处的 child」不是一回事。**手头作为收纳落点只认手头来源**：`hoveredRootIdFromOver` 仅当拖拽来源也是 `hand` 时才把手头行当候选 root，外区来源返回 `null`——该守卫必须落在这一层，因为收纳高亮（`handleDragOver`）与落点派发共用它，只拦落点会留下「亮了高亮却无反馈」。详见 [at-hand](at-hand.md)。
13. **项目区与归属轴**：`Goal(kind="project", status="active")` 的成员任务在待办页聚成「项目区」，并对收件箱**排他**——成员不进 `inbox`，收件箱因此回归「真·未归类托盘」；焦点轴（手头）与时间轴（今天/已排期）与它正交，成员同时出现在对应桶与项目区。两份 goal→task 索引口径不同且**不得互相派生**，归属变更必须同事务刷新成员 `updatedAt`（重力可见性所需）。完整契约（投影规则、排他红线、写入不变量、呈现约定）见 [project-zone](project-zone.md)。
14. **投递坞不发明语义、左拉才现身**：宽屏拖拽的落点药丸（`TodoDragDock`），`dock:pool:*`/`dock:project:*` 折算成既有容器走 `resolveTodoDragOperation`，`dock:hand` 对 root 源 = `grabTaskToHand`、对 child 源 = `promote-to-hand`（先升根再抓）；坞永不产生 reorder（`resolveTodoDockDrop` 拦截），也不是缩进落点（`hoveredRootIdFromOver` 对 dock id 恒返回 `null`）。拖起只出左缘细条（手头源等空坞连细条都不出），左拉过阈值才展开接投递——三档车道 `resolveTodoDragLane`（根任务 -28px 出坞；子任务 -28px 先升根、-56px 才出坞），非 dock 档坞不参与命中（`preferProjectCollisions` 的 `dockAllowed`），排序与收纳因此不被坞拦。dock 档缩进按 root 解析（`laneToIndentLevel`，左拉绝不是收纳）；键盘恒基线档、投坞不可达。手势几何、命中裁决与三形态渲染详见 [drag-dock](drag-dock.md)。
