---
type: evergreen
title: 待办 · 拖拽投递坞
covers:
  - packages/client/src/pages/todo/TodoDragDock.tsx
  - packages/client/src/pages/todo/todoDnd.ts
  - packages/client/src/pages/todo/todoDockDrop.ts
last-reviewed: 2026-08-03
---

# 待办 · 拖拽投递坞

> 母主题：[todo](../todo.md)。
> 本文管的是**拖着一条任务时，怎么把它送到别处**——坞的三档车道手势、三形态渲染、命中资格裁决，以及"坞不发明语义"这条红线。
> 落点本身的语义（今天/收件箱/项目/手头各自意味着什么）不在这里：见 [invariants](invariants.md) 与 [todo/at-hand](at-hand.md)、[todo/project-zone](project-zone.md)。

## 承上启下

- **上游**：`TodoPage` 的 `DndContext`。拖起时 `handleDragStart` 量来源区块（`[data-section]`）左缘存 `dockAnchorLeftPx`、记起手指针视口坐标（`dragStartPointRef`）与是否键盘拖拽（`keyboardDragRef`）；此后由 window 上的 `pointermove`/`touchmove` 驱动 `syncLaneFromPointer` 算车道，写 `laneRef` 并派生 `dockEngaged` state。**不走 dnd-kit 的 `onDragMove`**，理由见 §3.1。
- **下游**：`TodoDragDock` 按 `dragging`/`dockEngaged`/`targets` 推导三形态；`preferProjectCollisions` 按车道决定坞参不参与命中；`handleDragEnd` 经 `resolveTodoDockDrop`/`applyTodoDockDrop` 落库。
- **契约**：车道判定与落点解析的纯函数全在 `pages/todo/todoDnd.ts`（归母文 covers）：`resolveTodoDragLane` / `laneToIndentLevel` / `preferProjectCollisions` / `todoDockId` / `parseTodoDockId` / `todoDockTargets` / `resolveTodoDockDrop`。本文 §1–§4 是它们的语义合同。
- **邻居**：[todo](../todo.md)（Task 落点全貌、缩进收纳手势、[invariants](invariants.md) 第 5 条的 dnd 身份规则）、[todo/at-hand](at-hand.md)（手头源整区不出坞的理由、子任务投手头的两步落库）、[todo/project-zone](project-zone.md)（子任务不可入组的拒绝口径）。

## 1. 坞不发明语义

坞只是**既有落点的快捷方式**，不新增任何一种数据操作：

- `dock:pool:today` / `dock:pool:inbox` / `dock:project:<goalId>` 折算成对应容器 id 后走 `resolveTodoDragOperation`，与把行拖到那个池/项目卡逐字同义。
- `dock:hand` 是坞独有分支：对 root 源 = `grabTaskToHand`；对 child 源 = `promote-to-hand`（先升根再抓，`grabTaskToHand` 对子任务的硬拒因此不被这条路径触发，见 [todo/at-hand](at-hand.md) §7.2）。
- **坞永不产生 reorder**：坞没有位置语义，`resolveTodoDockDrop` 一律拦成 `invalid`。正常也不可达（当前池的药丸不渲染），这道拦截是隐藏规则漏了时的兜底。
- 药丸集合由 `todoDockTargets` 决定：被拖行**所在池**的药丸不显示；**拖子任务时「手头」药丸照常显示**；手头源（含"父在手头"的子任务）返回空数组——手头区整区不出坞，移出手头走 × 按钮。
- 子任务投项目药丸的拒绝口径与项目卡一致（`projectAssignBlockMessage("subtask", …)`），不因为换了入口就放宽。
- `hoveredRootIdFromOver` 对 dock id 恒返回 `null`：**坞不是缩进落点**。不加这道守卫，`parseTodoContainerId("dock:hand")` 解析失败会 fall 到 activeContainerId，把 dock id 当"根行 id"返回，下游拼出 `parent:dock:hand` 这种垃圾落点。

## 2. 三档车道：一根横轴，三件事互斥

坞**拖起不现身，左拉过阈值才现身**。这不是装饰性动效，是为了让三个手势各走各的道：

```text
 ←左拉过阈值           中间              右推过阈值→
 【投坞档 dock】 ←→ 【排序档 root】 ←→ 【收纳档 child】
  坞展开、接投递      无坞、正常排序      无坞、候选父高亮
```

判定分两层：页面唯一入口 `resolveTodoDragLaneAtPointer`（吃指针真实坐标，含 `holdDock` 几何，见 §3）委托阈值状态机 `resolveTodoDragLane(deltaX, previous, base, keyboard, holdDock)`。阈值与缩进档同构叠加：

| 基线 | 出坞阈值 | 释放线 | 说明 |
|---|---|---|---|
| `base="root"`（拖根任务） | `deltaX ≤ -28` | `deltaX ≥ -12` 释放回 root | 与缩进的 +28/12 对称 |
| `base="child"`（拖子任务） | `deltaX ≤ -56` | `deltaX ≥ -40` 释放回 root | -28 先升根（缩进档既有语义），再深一档才出坞 |

- **子任务是两次等距越档，不是一步跨两档**：-28 升根、-56 出坞。升根瞬间绝不同时满足出坞条件——一步跨两档是设计违例。
- **右移语义一字不变**：root/child 之间的判定原样委托 `resolveIndentLevel`。
- **`laneToIndentLevel` 派生缩进语义**：`child → child`，`root`/`dock` → `root`。**dock 档绝不是收纳**——左拉出坞后松手若落在某一行上，按 root 解析（通常无操作或同容器重排），不能把任务收纳成那一行的子任务。这条派生落在纯函数而非页面的三元里：写在页面时，把它合并成 `lane !== "root" ? "child" : "root"` 这类似是而非的写法整套页面测试照绿，而真机上左拉出坞松手会静默改数据。
- **换档要清缩进高亮**：`indentTargetId` 只在 `handleDragOver` 里重算，而 dnd-kit 只在 `over` 变化时触发它。右移亮起高亮后不纵移、直接左拉出坞，高亮会一直挂着与坞同屏——两个互相矛盾的落点承诺，且按高亮松手其实不会收纳（`indentLevel` 此刻已是 root）。故 `syncLaneFromPointer` 里换出 child 档就清掉它。

## 3. 两个坐标陷阱：位移从哪来，坞画在哪

### 3.1 位移必须自己算，不能用 dnd-kit 的 `delta`

事件里的 `delta`（`onDragMove` / `onDragEnd`）**不是原始手势位移**，而是过了 `modifiers` 之后的值（dnd-kit 6.3.1：`applyModifiers` → `scrollAdjustedTranslate` → 事件的 `delta`）。本页挂着 `clampTodoIndentPreview`，它把根任务的 x 夹进 `[0,28]`、子任务夹进 `[-28,0]`——**出坞阈值（-28/-56）落在钳制值域之外，dock 档结构性不可达**，坞左拉多远都只停在细条态。

- **缩进档当时没跟着坏纯属边界巧合**：modifier 的钳制上限与缩进阈值同为 `TODO_CHILD_INDENT_PX`，恰好够得着。
- **两侧各自的单元测试都不会红**：纯函数层直接喂 -28 当然进 dock，modifier 层只断言自己钳得对。闸只能落在跨两者的接缝上（`todoDnd.test.ts` 的"防回潮"用例）与页面接线层（`TodoPage.test.tsx` 的鼠标左拉用例）。
- **驱动源也得一起换**：`delta` 变了才发 `onDragMove`，x 被钳死时纯水平左拉根本不发事件。

故车道判定走 `resolveTodoDragLaneAtPointer`，吃**指针真实视口坐标**——由页面挂在 window 上的 `pointermove` / `touchmove` 直接喂（`pointerPosRef`），位移 = 当前坐标 − 起手点（`dragStartPointRef`，取自 `activatorEvent`）。`modifiers` 只管视觉预览。

### 3.2 位移是相对量，坞画在绝对位置

车道判定吃的是位移——相对**起手点**；而坞画在**绝对位置**——来源区块左缘（`anchorLeftPx`），宽 `w-44`。两者是不同的坐标系。

坞锚来源区块左缘：拖柄在行左 2/5，锚右缘意味着去坞全程向右横穿，恰是缩进手势（+28px 变子任务）的方向、极易误触；锚左缘让去坞行程向左，与缩进方向岔开。

单靠位移判释放会与这个几何打架：**起手点距该左缘近于释放距离时，指针一进坞矩形就已经满足释放条件**，坞在指针够到药丸之前自己关掉——坞全幅展开、对着药丸松手，什么都不发生。拖柄命中区从行左缘就开始（`absolute left-0 w-2/5`），而行左缘恰好等于区块左缘，"抓行最左边拖起"这个常见起手位必然撞上。

因此判定含一项几何：指针落在坞矩形（四周各含 `TODO_DOCK_HOLD_BUFFER_PX` = 16px 缓冲，防贴边抖动）内时，`holdDock` 短路释放。几何全在 `resolveTodoDragLaneAtPointer` 里（因而可测），页面只负责把指针坐标与坞元素的 `getBoundingClientRect()`（`containerRef`）取来传进去。**`holdDock` 同样必须拿真实坐标**：按"起手点 + delta"拼装会算出一个根本不是指针所在的位置（手拉 200px 而 delta 只报 0），矩形判定整条失效——与 §3.1 同一个根因。

- **两轴都判，且矩形要量不要算**：坞垂直居中、高度随药丸数量变，纵向范围算不出来。只判 x 会把整条纵向带都算作"在坞上"——而拖柄贴着区块左缘，起手点几乎总落在坞的横向带内，那样一旦进档就再也释放不掉，右移回去坞也不关，纵向扫过药丸带松手即是一次误投。
- **只短路释放，不短路进档**：否则指针恰好扫过坞矩形就会凭空开坞。
- **量不到锚点则不进 dock 档**：`anchorLeftPx === null` 时坞退视口右缘，而出坞手势向左——方向互斥，指针结构性够不到药丸。与其让坞开在够不着的地方，不如不进档（坞至多停在细条态）。
- 键盘拖拽无指针坐标，`holdDock` 恒 false，不影响 §5 的键盘语义。

## 4. 命中资格：一处裁决，不挂 droppable

**非 dock 档时坞不参与命中**，这是"排序/收纳不被坞拦"的机制保证，不是视觉让路（坞浮在列表上方，视觉隐身不等于不抢落点）。

裁决点只有一个：`preferProjectCollisions` 的 `dockAllowed`，由页面传 `laneRef.current === "dock"`。

- **两条路都要滤**：`pointerHits` 与 `fallback()`（closestCenter 会把坞药丸的矩形一并算进去）在无资格时都得剔掉 `dock:` 前缀，只滤前者会让兜底路把坞重新放进来。
- **有资格时坞优先**：指针同时落在药丸与其下方行/项目组的矩形内时只认坞。
- **此闸不挂药丸的 `useDroppable({disabled})`**：那条路是 state 驱动的——值要先经一次 React 提交、再经 `useDroppable` 自己的 effect dispatch 一次，才落进 dnd-kit 的可碰撞集合，比车道 ref 慢两跳。慢出来的窗口两个方向都咬人：**刚释放**（坞视觉已收）时 `over` 仍指着药丸，松手落一次用户以为已放弃的真实投递；**刚进档**（坞已展开）时药丸还禁用着，对着药丸松手却漏接。读 ref 则两侧同拍。
- **`handleDragEnd` 另有末道闸**：`over` 指向坞、而结束时车道已非 dock，一律放弃——dnd-kit 的 `over` 账本只在指针移动时重算，可能比车道滞后一拍。
- **坞自己负责重测 droppable rect**：dnd-kit 默认只在拖起瞬间与可碰撞集合变化时测量（`measuring.droppable.frequency` 默认是字符串 `"optimized"`，周期重测那条 effect 直接早退）。而坞的横向落位要到 `dragStart` 那一批 `setState` 才定，拖起瞬间量到的是挪位前的矩形；药丸集合与静止态相同的来源（子任务源即是——它不摘任何池药丸）也不会触发第二次测量。故 `TodoDragDock` 在锚点落位后主动调 `measureDroppableContainers` 把坞的矩形对回来。挂 `disabled` 的老写法之所以没暴露这一条，是因为切 `disabled` 会顺带触发一次可碰撞集合变化。

## 5. 键盘拖拽：恒基线档

`resolveTodoDragLane` 对键盘拖拽（`keyboard=true`）恒返回基线档。键盘 sensor 的跨栏移动本身就是"位移"，不判 sensor 会把键盘重排误判成出坞/换档。守卫显式落在纯函数里，不靠"键盘不发指针事件、坐标恰好没动"这种隐式行为兜底——那是实现细节，换 sensor 或补键盘坐标就会失效。

两个后果都是取舍，不是遗漏：

- **键盘投坞不可达**。替代入口齐全：行内滑出菜单、`TaskRow` 行尾 overlay、`TaskDetailSheet` 抽屉里的排今天/回收件箱/抓手头按钮。
- **键盘拖子任务跨栏悬停在某根行上，解析为收纳而非升根**：恒基线意味着子任务全程停在 child 档，跨栏移动不再判出"升根"。指针拖拽两条路径都在，键盘下要升根走详情抽屉。

## 6. 三形态渲染

| 态 | 条件 | 视觉 | 命中 |
|---|---|---|---|
| `hidden` | 未拖拽，或 `targets` 为空（手头源等） | 全透明 | 无药丸可命中（空坞时车道仍可能是 dock，无害） |
| `hint` | 拖拽中、未进 dock 档 | 只见左缘 accent 细条（`before:` 伪元素，4px） | 同上 |
| `engaged` | 拖拽中、dock 档 | 完整坞（一列等宽药丸） | 参与，坞优先 |

DOM 见证是容器上的 `data-dock-state`；药丸另有 `data-dock-engaged`。

- **空坞连细条都不出**：细条是坞的预告，无坞则无预告。
- **常驻挂载、恒宽 `w-44`**：droppable rect 在拖起瞬间测量，晚挂载或改宽都会让命中区错位。三形态只切透明度 / `pointer-events` / `overflow`。
- **`pointer-events` 仅 engaged 放开**：dnd-kit 命中走指针坐标不吃 DOM 事件，但坞内滚动要接滚轮——坞展开后滚轮才该归它，否则超出一屏的项目药丸够不到；细条态与平时都是 `none`，不拦点击。
- **纵向 `overflow-y` 也仅 engaged 开 auto**：细条态药丸虽透明仍占高度，恒 auto 会在经典（非覆盖式）滚动条系统上浮出一条孤零零的滚动条，旁边只有 4px 细条、什么内容都没有。`overflow-x-hidden` 恒定——纵向 overflow 会把横向 `visible` 自动算成 auto，任何内容溢出都会生出横向滚动条。
- **`aria-hidden` 仅 engaged 为 false**：hint 态的药丸既隐身又不接投递，不该报给读屏。
- **淡入 150ms 无 delay，隐藏 duration 0**（松手即散）。无需延迟淡入来防"短距重排闪坞"——出坞本身要求一个显式的左拉信号，短距重排到不了 dock 档。
- 坞**仅宽屏渲染**（`{wide && …}`）。

## 7. 测试清单

- `pages/todo/todoDnd.test.ts`：三档车道全阈值与滞回（含 base=child 的两次越档、单帧大位移一步进坞、dock 右甩落 child）、`holdDock` 短路释放与"不短路进档"、键盘守卫压过 holdDock、`laneToIndentLevel` 三档、`preferProjectCollisions` 的 `dockAllowed` 双路剔除、坞 id 域往返与落点解析矩阵。另有 `resolveTodoDragLaneAtPointer` 的几何用例（真实坐标进坞、两轴 `holdDock`、无锚点降级、坐标缺失保持原档）与**防回潮闸**：断言 `clampTodoIndentPreview` 的输出接回车道判定就够不到 dock（§3.1 的根因）。
- `pages/todo/TodoDragDock.test.tsx`：三形态 DOM 见证、`aria-hidden` 仅 engaged 放开、空坞（手头源/父在手头）不出细条、`dropBlocked` 项目药丸灰态。
- `pages/TodoPage.test.tsx`：键盘拖起时坞出细条预告（恒基线档）、手头子任务拖起坞恒空、**鼠标拖起后左拉过阈值坞展开、右拉回位收回细条**。
- **jsdom 造得出指针拖拽**：`mousedown`（带 `clientX/Y`）→ 等 `MouseSensor` 的 180ms delay → 往 window 发 `pointermove` 即可。车道判定只看坐标差，不依赖 jsdom 量不出的布局；坞矩形恒 0 使 `holdDock` 恒 false，正好把释放路径也测进去。
- **覆盖边界**：真投递（`dockAllowed` 传参、末道闸、药丸命中）要 droppable 矩形，jsdom 全 0 量不出，靠代码审读与真机验收，不写恒绿用例充数。
