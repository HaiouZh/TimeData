---
type: evergreen
title: 目标层 · 星图画布
covers:
  - packages/client/src/lib/goalGraphModel.ts
  - packages/client/src/lib/goalGraphEdges.ts
  - packages/client/src/lib/goalGraphLayout.ts
  - packages/client/src/lib/goalGraphViewport.ts
  - packages/client/src/lib/goalGraphLod.ts
  - packages/client/src/lib/goalGalaxyRollup.ts
  - packages/client/src/lib/goalGalaxyLod.ts
  - packages/client/src/lib/goalGalaxyModel.ts
  - packages/client/src/lib/goalGalaxyLayout.ts
  - packages/client/src/lib/goalGalaxySettle.ts
  - packages/client/src/lib/galaxyEngineMode.ts
  - packages/client/src/lib/goalUnassigned.ts
  - packages/client/src/pages/goals/**
last-reviewed: 2026-07-25
---

# 目标层 · 星图画布

> [goals](../goals.md) 的子文档。星图画布是目标层的**视图与就地编辑面**：`/goals` 的全局星图（每颗恒星一个 active Goal）与 `/goals/:id` 的局部图编辑器（Goal 锚 + 成员卫星），两者共享一套确定性布局纯函数与 React Flow 壳。
> 本文讲：`/goals` 视图模式与三段式工作台、全局画布纯函数分层、就地编辑与 pin 写入语义、未归类托盘与拖入命中、引擎模式开关、局部编辑器布局/交互/轻撤销口径、画布侧模块速查与 galaxy scoped palette。
> 不讲：`Goal` schema 与 `members`/`prerequisites` 契约、存储与同步域登记、roll-up 计算口径（均见母文档 [goals](../goals.md)）。

## 承上启下

- **上游**：`GoalsPage` 按视图偏好分流到 `GoalGalaxyCanvas`（星图）或 `GoalsListPage`（列表）；`GoalDetailPage` 用 live query 给 `GoalGraphEditor` 喂 Goal/Task/Track/Step/布局钉点快照。
- **下游**：所有结构写入仍只经 `lib/goals.ts`、`lib/tasks.ts` 与 `lib/goalLayoutPins.ts` 的既有 Dexie + `syncLog` 边界（写入经 `recordSyncLog` 自动调度上传），画布自己不碰同步层。
- **契约**：布局坐标落 `goal_layout_pins`（复合 recordId 与域登记见母文档 [goals](../goals.md) §2）；节点/边模型由 `buildGoalOverview` 派生，画布不新增反向索引表。
- **邻居**：[goals](../goals.md)（schema / 同步 / roll-up）、[todo](../todo.md)（成员任务资格口径与深链 `/todo?taskId=`）、[tracks](../tracks.md)（Track 状态仍回轨道页处理）、[todo/at-hand](../todo/at-hand.md)（未归类托盘的“手头”组读活跃 Session）、[design-language](../design-language.md)（galaxy scoped token）。

## 1. 全局星图就地编辑

`/goals` 的视图模式以 localStorage `timedata_goals_view_mode` 为准：手选过就一直用手选值、窗口尺寸翻转不覆盖；从未手选时才按宽窄给默认（宽屏星图、窄屏列表）。两端都提供“星图 / 列表”切换。模式是派生值（`resolveGoalsViewMode(wide, stored)`）而非 state 副本，`GoalsPage` 里没有按宽窄重置模式的 effect。全局星图只展示 `status:"active"` 的 Goal；archived Goal 仍在列表的归档区，不进入画布。宽屏星图是三段式目标工作台：中间保持 Goal 星座画布，左侧“目标”抽屉是 active Goal 索引，右侧“未归类”抽屉是未被任何 active Goal 收编的活跃 Task/Track 托盘。两个抽屉默认收起，由左上控件群的 pill 唤起，作为画布内 overlay 出现，不推动 React Flow 布局重排。

全局星图是 Goal-centered portfolio view，不是自由画布或跨 Goal 依赖编辑器：每个 active Goal 是一颗恒星，展开时该 Goal 的 Task / Track 成员作为卫星；同一个成员被多个已展开 Goal 引用时，只绘制一个桥接节点并用 tether 连到多个 Goal 锚。桥接节点只是共享成员的可视化，不改变进度账、不写反向索引，也不落 `goal_layout_pins`，因为现有钉点复合键没有跨 Goal 所属格式。

未归类不是画布散点池，也不是伪 Goal。`goalUnassigned` 只把全部 active Goal 的成员并集当排除集：普通未完成根 Task 或 active pending root occurrence（排除子任务、重复模板及 done/skipped 历史发）、`status:"active"` Track 且不属于任何 active Goal 的项进入托盘；只属于 archived Goal 的成员会自动回流到未归类。托盘计数与列表使用同一任务资格口径。全局托盘额外纯读当前活跃 Session：候选 Task 的 `sessionId` 与活跃 Session id 精确相等时进入置顶“手头”组；只带已散场历史 `sessionId` 的任务仍按今天/收件箱/已排期落点，不把 `sessionId !== null` 误当当前状态。这个分组只作用于全局未归类托盘，目标详情添加成员 picker 仍维持原分组。托盘复用 Goal 添加成员候选的搜索、标签筛选和任务/轨道分组；细指针下行使用 HTML5 drag payload `application/x-goal-member`。把托盘行拖到某颗 Goal 星上时，画布用 React Flow `screenToFlowPosition` 与 `goalStarHitTest` 按星体中心 bounds 命中，命中则调用 `addGoalMember(goalId, ref)`（写入经 `recordSyncLog` 自动调度上传），落空或 payload 非法则忽略。粗指针下托盘行改为点按，先弹“加入哪个目标” Sheet，选择 active Goal 后再调用同一写入 helper。加入后候选重算，该项自然离开托盘。窄屏不挂抽屉、不做拖入，继续使用现有列表和每 Goal 添加成员 picker。

全局画布的纯函数地基分层：

- `goalUnassigned` 反查未归类 Task/Track，不新增同步域，不写成员行，也不影响 roll-up。
- `goalGalaxyRollup` 汇总 active project Goal 的完成数 / 总数 / ratio，并按 typed member 去重统计 7 天内推进成员；`activeGoals` 取有近期动量的 active Goal 数。
- `goalGalaxyLod` 按 viewport zoom 和滞回阈值在 `collapsed` / `expanded` 间切换，避免缩放边界横跳。
- `goalGalaxyModel` 复用 `buildGoalOverview` 与 `buildGoalGraphModel`，但把局部裸 Goal 锚改写为全局唯一 `goal:<goalId>`，跳过 ghost，并把共享成员合并成多锚节点。
- `goalGalaxyLayout` 使用确定性布局，不引 `d3-force`。恒星读 `goal_layout_pins` world pin，无 pin 时用确定性螺旋种子；单 Goal 成员有 pin 时使用“锚 + 相对偏移”，无 pin 时使用该 Goal 局部 `goalGraphLayout` seed；桥接成员放在多锚质心附近，再做全局确定性碰撞推挤。

全局画布 C2 起支持就地编辑，但仍不做跨 Goal 依赖编辑器：恒星与单 Goal 成员可拖拽，拖停后经 `goal_layout_pins` 写 pin，恒星保存 world pin，成员保存相对该 Goal 锚点的偏移；桥接成员不可拖、不可落 pin。已钉节点显示图钉角标，选中后的“恢复自动”删除对应 pin。进入局部编辑器有两条路径：桌面双击恒星；任意指针下选中恒星后动作单第一项“打开目标”。聚焦编辑器工具栏提供“返回目标页”回到 `/goals`（文案中性：`/goals` 可能是星图也可能是列表）。

点节点只选中，显式动作才写入或导航：Task 可就地完成/取消完成；单 Goal 成员可确认后移出；同 Goal 内成员可用“连前置”建立 blocker -> blocked 前置，进入连前置草稿态后关闭动作单，并在画布顶部提示“点击目标节点完成连接”与“取消”；选择前置边可删除；恒星可打开添加成员 picker，也可进入目标设置 sheet 编辑、归档或确认删除 Goal。所有结构写入仍只经 `lib/goals.ts`、`lib/tasks.ts` 与 `lib/goalLayoutPins.ts` 的既有 Dexie + `syncLog` 边界，写入经 `recordSyncLog` 自动调度上传。桥接节点的原子动作（如 Task 完成）就地生效；“移除成员 / 连前置”这类需要判定“哪个 Goal”的操作会先让用户选择 Goal，再导航到对应 `/goals/:id` 聚焦编辑器处理。

全局星图顶部 HUD 显示 canvas-level rollup（全局完成百分比、本周推进、在动 Goal），它只读现有 Goal/Task/Track/Step 快照；旁边的“目标”“未归类”“回到全图”控制都在同一控件群中，“目标”打开左索引并可 `fitView` 聚焦某颗星，“未归类(N)”打开右托盘且 N 是当前未归类候选数。星图线透明度控件可在“归属线 / 连接线”之间切换：归属线只调 Goal -> 成员 tether 的本地透明度，默认 5%，可拉到 0 隐藏；连接线调前置边整体星云层透明度，默认 100%，不改变前置语义。全局星图继续复用 `goalGraphActions`、`GoalGraphNodeView`、添加成员 picker、目标编辑 sheet 和确认 sheet 等编辑叶子；`GoalGraphEditor` 仍是 `/goals/:id` 的局部编辑器，没有被抽成共享大内核，也不单独提供透明度滑杆。布局默认仍是确定性引擎，OFF 路径不引 `d3-force`。

全局星图另有本地引擎模式开关，localStorage key 为 `timedata_galaxy_engine`：默认 `deterministic` 完全沿用确定性布局；`settle` 模式才通过 hook 动态 import `d3-force`，跑短暂物理 settle 后冻结。`/goals` 壳会等 Goal/Task/Track/Step/布局钉点 live query 全部返回后再挂载星图画布，避免 settle 引擎从空数据或半数据布局起跑；settle 的第一帧位置以当前完整静态布局 seed 为准。settle 模式下 Goal 恒星一律固定在当前画布坐标，只让 Task/Track 成员参与物理排布；用户 pin 仍是硬锚，单 Goal 成员钉点继续按“相对恒星偏移”落 `goal_layout_pins`，桥接成员不落 pin。切回静态模式会回到确定性布局；`/goals/:id` 的局部编辑器不受该开关影响。

## 2. 局部星图编辑器

`/goals/:id` 默认进入局部图编辑器，不提供文字详情 fallback。图节点只表达 Goal 锚、真实 Task/Track 成员和 ghost 失效引用；前置边方向固定为 `blocker -> blocked`，Goal 锚和 ghost 不参与新建前置边。归属 tether 只表示成员属于 Goal，不作为可编辑前置关系。

`GoalDetailPage` 壳层的加载门与 `/goals` 壳同口径：Goal、Task、Track、TrackStep、布局钉点**五个 live query 全部返回**才挂编辑器，一律不给 `useLiveQuery` 传 `[]` 默认初值。用 `[]` 兜底会让 `buildGoalOverview` 把全部成员判成失效引用，首帧渲染成 ghost、数据到位后整图重排跳位。

B 阶段后，`goalGraphLayout` 输出确定性星环 seed：Goal 居中，成员按前置 rank 与成员顺序环绕；自动布局不持久化，也不由 force settle 主导。Goal 锚读 `goal_layout_pins` world pin（无 pin 为 `{x:0,y:0}`），`task` / `track` pins 存相对锚偏移并覆盖 seed。打开 `/goals/:id` 等 pins 后定格并局部解碰撞；拖成员只动当前节点，拖停找最近不重叠落点再写 pin，不重排其它节点；拖 Goal 平移整团并写 world pin。ghost 不可拖且不写 pin。

已钉节点显示图钉角标。选中已钉节点的「恢复自动」删单点 pin；工具栏「恢复自动布局」只清当前 goal 的 task/track pins，保留 Goal world pin。pan/zoom 视口按 Goal id 本地保存，不同步；只有用户钉住坐标进入 `goal_layout_pins`。React Flow 坐标按节点中心解释，`fitView` 只负责初次纳入视野；防重叠按视觉占位计算，包含 ToDo 圆点右侧外置标题、Track 胶囊、Goal 卡片和连接把手余量。settle 模式下 Goal 恒星一律固定在当前画布坐标，只让 Task/Track 成员参与物理排布；settle 是纯观赏模式：拖动不落 `goal_layout_pins`、既有钉点只作为 seed 参与不做硬锚，钉点角标与「恢复自动」在该模式下隐藏，拖停给一次「灵动模式不保存位置」提示；切回静态模式会回到确定性布局（含既有钉点）。前置语义看箭头（`blocker -> blocked`）；四向 handle 默认低存在感，边按两端相对位置选最近 handle，避免反侧绕线。完整标题用应用内 tooltip。

交互语义以防误触为先：点节点只选中，显式“打开”才进入源页面。打开 Task 使用 `/todo?taskId=<id>` 深链；打开 Track 使用 `/tracks/:id`。Task 可在图内快速完成/取消完成，Track 状态仍回轨道页处理。结构写入仍只经 `lib/goals.ts` 和 Task 写入 helper：加已有成员、移出成员、快建任务、增删前置、编辑/归档/删除 Goal 都复用既有 Dexie + `syncLog` 边界。

图上浮层默认不拦截画布手势，但工具栏自身必须恢复可点击命中；“添加成员 / 回到全图 / 返回目标页 / 目标菜单”都属于图编辑器的主操作入口，不能被画布 pass-through 容器吞掉。

宽屏下，添加成员与目标设置使用星图局部右侧面板；窄屏/粗指针继续使用底部 sheet。添加成员面板复用 ToDo 的搜索和标签筛选口径；任务候选只含普通未完成任务与 active pending occurrence，目标详情 picker 按今天/收件箱/已排期分组，全局未归类托盘在其前额外显示当前活跃场的“手头”组；重复模板及 done/skipped 历史发不进入候选；轨道按 active / parked / concluded 分组并显示看板信号和最新步骤提示。

轻撤销只覆盖破坏性结构操作：删除前置边、移出成员、移出失效引用。移出成员的撤销会恢复成员列表和被级联删除的前置边；Task 完成、加成员、快建任务、新建前置等非破坏操作不进入这条 undo 口径。

## 3. 不做

- 全局星图不做跨 Goal 依赖编辑、自由便签画布或成员反向索引表。
- 不做自由便签、多层目标或软顺序。

数据侧的“不做”（互斥边 / 权重边 / 步骤级 roll-up、`Track.refs` 自动展开、agent 写 Goal 端点）见母文档 [goals](../goals.md) §4。

## 4. 模块速查

| 入口 | 职责 |
|---|---|
| `client/src/lib/goalGraphModel.ts` | `GoalOverview` → Goal 锚、真实节点、ghost 节点、tether / 前置边模型 |
| `client/src/lib/goalGraphEdges.ts` | 前置边自环、重复、环、Goal 锚、非成员校验与增删纯函数 |
| `client/src/lib/goalGraphLayout.ts` | 围绕 Goal 的确定性星环自动布局，不持久化坐标 |
| `client/src/lib/goalGraphViewport.ts` | 按 Goal id 保存本地 pan/zoom 视口，不同步 |
| `client/src/lib/goalGraphLod.ts` | zoom → near/far 两档显示密度 |
| `client/src/lib/goalGalaxyRollup.ts` | `/goals` 全局星图 HUD 汇总：完成度、7 天推进、在动 Goal |
| `client/src/lib/goalGalaxyLod.ts` | 全局星图 cluster collapsed / expanded 滞回 LOD |
| `client/src/lib/goalGalaxyModel.ts` | active Goals → 恒星、成员卫星、共享成员桥接节点、多锚 tether |
| `client/src/lib/goalGalaxyLayout.ts` | 全局星图确定性多锚布局、pin/seed/质心和碰撞推挤 |
| `client/src/lib/goalGalaxySettle.ts` | 全局星图可选 settle 引擎工厂；Goal 恒星和已 pin 成员按 seed 固定，成员短暂解碰撞后冻结 |
| `client/src/lib/galaxyEngineMode.ts` | `/goals` 星图引擎本地偏好读写；默认 deterministic，只有 settle 模式才启用动态引擎 |
| `client/src/lib/goalUnassigned.ts` | 全 active Goal 成员并集排除，得到未归类活跃 Task/Track 托盘候选 |
| `client/src/pages/goals/GoalsPage.tsx` | `/goals` 视图模式壳：偏好优先、无偏好按宽窄默认、手动切换落偏好 |
| `client/src/pages/goals/goalsViewPrefs.ts` | `/goals` 视图模式本地偏好读写与 `resolveGoalsViewMode` 纯函数 |
| `client/src/pages/goals/GoalGalaxyCanvas.tsx` | 全局星图 React Flow 画布、HUD、左目标索引/右未归类托盘、拖入加入、就地编辑动作、pin 写入、桥接节点路由 |
| `client/src/pages/goals/GoalGalaxyActionBar.tsx` | 全局星图节点/边选中后的动作条与窄屏 sheet |
| `client/src/pages/goals/GoalIndexPanel.tsx` | 左抽屉 active Goal 索引，显示 mini 进度 / 本周势头并聚焦目标星 |
| `client/src/pages/goals/GoalUnassignedTray.tsx` | 右抽屉未归类 Task/Track 托盘，复用搜索/标签筛选/分组，行可拖 |
| `client/src/pages/goals/goalMemberDragData.ts` | 未归类托盘拖拽载荷协议，读写 `application/x-goal-member` |
| `client/src/pages/goals/goalStarHitTest.ts` | drop flow 坐标命中 Goal 星的纯函数，多命中取最近中心 |
| `client/src/pages/goals/GoalDetailPage.tsx` | live-query 壳，等齐五个 live query 再给图编辑器提供 Goal/Task/Track/Step 快照与导航回调 |
| `client/src/pages/goals/GoalGraphEditor.tsx` | Adaptive Goal Graph Editor：选中、动作分发、写入 helper 接线、轻撤销 |
| `client/src/pages/goals/**` | 目标列表、图节点/边、工具栏、添加成员 picker、宽屏右侧面板、Goal 编辑 sheet、撤销 toast |

**Galaxy scoped palette**：星图节点的状态光晕（ready/blocked/completed/parked/active/anchor）和星核边框通过 `--galaxy-*` scoped token 消费（见 [design-language](../design-language.md) §1）。`--galaxy-edge` / `--galaxy-edge-glow` / `--galaxy-star-core` 是颜色 token，`--shadow-galaxy-*` 是对应状态光晕的 shadow token；组件用 `var(--galaxy-*)` 和 `shadow-[var(--shadow-galaxy-*)]`，不写裸 rgba。这些 token 只允许 `pages/goals/**` 使用，不外溢全站 chrome。
