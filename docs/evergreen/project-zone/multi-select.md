---
type: evergreen
title: 项目区 · 多选建组与批量归入
contracts:
  - packages/client/src/lib/goals.ts
last-reviewed: 2026-08-06
---

# 项目区 · 多选建组与批量归入

> 母主题：[project-zone](../project-zone.md)。
> 本文管的是**从收件箱勾一批任务，圈成新项目或整批放进已有组**——`selectionMode` 这个页面级模式态的边界、选中集与库的对账、批量写入的事务口径。
> 归属轴本身（三根轴、两份索引、投影规则、写入不变量、呈现契约）在母文档；单条拖拽归入见母文档 §6，组内父子收纳见母文档 §6.1。

## 承上启下

- **上游**：收件箱标题右侧的常驻入口把 `TodoPage` 切进 `selectionMode`。可选行来自收件箱的三处渲染点（浮动区 / 水下尾 / 重力翻牌区），选中集 `selectedIds` 是页面 state，只存 id。
- **下游**：`TodoSelectionBar` 收集标题或目标组，提交走 `lib/goals.ts` 的 `createProjectWithMembers` / `assignTasksToProject` 两个单事务入口；写入后由 `useLiveQuery` 回流，成员因排他离开收件箱、落进项目区。
- **契约**：模式态的 UI 合同落在 `pages/todo/TodoSelectionBar.tsx` 与 `TodoPage` 的包装层；批量写入的原子性合同落在 `lib/goals.ts`（本文 §3 / §4 是它的语义合同，单条版本的口径见母文档 §4.1）。
- **邻居**：[project-zone](../project-zone.md)（归属轴与排他红线）、[goals](../goals.md)（`Goal.members` 与 500 上限）、[todo/gravity](../todo/gravity.md)（水下与翻牌区是可选范围的两处来源，归组 touch 会把它们浮上水面）。

<a id="project-zone-batch"></a>

## 1. 模式态的边界

页面级模式态 `selectionMode`：从收件箱勾一批，圈成新项目、或整批放进已有组。

- **入口**在收件箱标题右侧常驻（`CollapsibleSection` 的 `action` 插槽），零 active project 时也在——那正是冷启动入口。插槽的拦截用 **`preventDefault` 而不是 `stopPropagation`**：`<summary>` 的折叠是浏览器对 `details` 的**默认行为**（activation behavior），在事件派发结束后才执行，不经 React 冒泡，`stopPropagation` 对它完全无效。代价是包裹层会吃掉内部所有点击的默认动作，故 **action 里只放按钮、不放 `<a>` 或 `type="submit"`**。
- **可选范围 = 收件箱的三处渲染点**（浮动区 / 水下尾 / 重力翻牌区），三处都要显式接 selection 三 prop，不能混进 `...rowHandlers` 让它自己流过去。水下的陈年任务恰恰最该被圈——归组会 touch `updatedAt` 让它当场浮上水面（见母文档 §4.2），这一下就是整理的即时回报。
- **不做禁选态**：`listTasks` 主循环三处早退保证 inbox 桶只含 `parentId === null && recurrence === null && ruleId === null` 的根任务（子任务首行 `continue`；重复模板走 `if (t.recurrence)` 进 scheduled；occurrence 必带 `scheduledAt`，落 today/upcoming）。准入闸仍留在写入侧兜底，但 UI 上没有可禁的行。
- **进多选顺带展开收件箱**（`setInboxCollapsed(false)`）。入口挂在 `<summary>` 里、与 `<details open>` 无关，而折叠状态是持久化的：折叠着点进去，全页其余区块变灰 `inert` + 底部「已选 0 条」操作栏，收件箱却还收着，一条可选行都看不见，第一眼是「模式坏了」。**只写 localStorage 不够**：`<details open>` 是 React 的受控值，用户在页面里手动折叠只改 DOM 与 localStorage、不触发重渲染，React 手上仍是上一次渲染的 `true`；这时再写一次 localStorage，下一帧算出的 `open` 还是 `true`，React 判成「没变」、根本不碰 DOM。故收件箱的展开态在 `TodoPage` 另存一份 state（`inboxOpen`），开合两处都写，localStorage 只管跨会话持久化。代价是把用户的折叠偏好改成展开——可以接受，他点「圈成项目」就是要看收件箱。
- **其余区块用 `inert` 而不是 `pointer-events-none`**：后者只挡指针，Tab 键照样聚焦进去、回车照样开详情，而那正是多选中最容易误触的路径。窄屏与宽屏两套布局**各包一次**，漏一处那种屏幕下模式态形同虚设。**包装层恒定存在，进出多选只切 `inert` 与 className，绝不切元素类型**——换类型会让 React 在这个插槽上卸载重挂整棵子树，`TodoProjectSection` 的组展开态（组件本地 state）每次进/出多选全部清空，建组成功时表现为「新组展开」被「其余全塌」的布局跳动淹掉。空区块（无已完成任务 / 无项目组）由此多出的 flex 子项靠 Tailwind `empty:hidden` 消掉，前提是那层里**一个节点都没有**，塞任何占位内容 `:empty` 就不匹配、`gap-4` 的 16px 会静默回来。
- **多选态下行右端的悬停动作条整条关掉**。多选是「圈一批」的模式，单条处置在这个模式里没有位置；更要紧的是整行就是勾选命中区，用户往右点必然压到「排进今天」上——任务离开收件箱 → 被 §2 的剪枝踢出选中集（无提示）→ 落进一个 `opacity-40` 且 `inert` 的区块 → 多选态里再也弄不回来（「抓到手头」更重，它顺带开/换了一个活跃会话）。与 `TaskList` 关掉拖拽（`canSort`）和滑动（`blockSwipe`）是同一条理由的三处落点，改一处要想到另外两处。
- **Esc 要让位给弹窗**。`Sheet` 与 `TaskDetailSheet` 的 Esc handler 同样挂在 window 上、与多选那条互不知情，同一次 keydown 两个都会跑——用户想关弹窗，选了半天的那批一起没了，**而退出后的页面和「成功建组」长得一模一样**（操作栏消失、记录框回来），只少一条 toast。判据用 `[role="dialog"]` 在场而不是给 `useConfirm` 加 `isOpen`：能与多选同屏的弹窗不止确认框，按 hook 逐个开洞会漏。
- **底部避让量按「此刻谁站在底部」算**，不能按 composer 算。多选态下 `TodoComposer` 不渲染而 `TodoSelectionBar` 顶上，若沿用 `composerHiddenByScroll` 那套，滚动隐藏底栏时避让归零、toast 落进操作栏的盒子被完全遮住——而多选态下 toast 是**唯一**的失败反馈通道（提交失败刻意不退出多选、只靠它说原因），压住就等于「点了没反应」。同款问题 `QuickNotesPage` 的 `bottomInsetPx` 早处理过。
- **「放进…」的组列表选完即收**。操作栏与 toast 容器同为 `z-backdrop` 且它在 DOM 里排其后 → 后绘制的它赢，而列表向上展开、不透明、最高 `max-h-60`，正铺在 toast 那条带上。列表只由用户点「放进…」切换、不会自己收，等他合上时 6 秒的 toast 早已消失——纯粹的「点了没反应」。**z 层级解决不了这件事**：那会把「列表要盖住页面」与「toast 要盖住操作栏」这两个各自自洽的决定改成互相打架的两个数字。

## 2. `selectedIds` 必须跟着可选集合剪枝

选中集只存 id，而 `useLiveQuery` 回流不会通知它。不剪枝就会攒出**幽灵 id**：在多选态里勾完成一行（复选框在多选态下仍是「完成」，是刻意的）、另一端同步下来一条删除、或另一端把这行收进某个 project 组，那行离开收件箱而 id 还攥在手上 → 操作栏说「已选 2 条」屏幕上只剩 1 行 → 提交时 `db.tasks.get` 拿不到人，抛的是裸 `Error` 不是 `ProjectAssignError`，落进兜底文案；而失败**不退出多选**，用户原地重试、每次都失败，屏幕上没有任何东西指向那个幽灵。

- **剪枝源照着渲染点写**（`floatingInbox ∪ sunkenInbox`），不能用 `buckets.inbox` 代替：此刻两者恒等，但将来哪一处渲染改了口径（比如水下尾不再可选），剪枝会跟着变而 `buckets.inbox` 会静默继续放行，那正是幽灵回来的方式。
- **取未经 `f()` 筛选的列表**：筛选是临时视图，不该让"筛一下"丢掉选中；何况多选态下 composer 不渲染，用户根本改不了筛选条件。
- **防死循环靠 updater 内「真的少了东西才换引用」**，不靠依赖数组——那个 Set 每次渲染都是新引用，写进依赖数组也是每渲染必跑，只是多骗一层。
- 剪掉的**不是**「已完成任务不能当成员」（它可以，母文档 §3 规则 4 的 `doneCount` 就是数它），剪掉的是「用户没在看的东西别替他提交」。

## 3. 两个写入入口，单事务，全成全败

| 入口 | 事务内容 |
|---|---|
| `createProjectWithMembers({title, taskIds})` | `db.goals.add` + 一条 goals create syncLog → 转交下一行 |
| `assignTasksToProject(goalId, taskIds)` | 目标组 active+project 校验（一次）→ 摘旧组 → 加入 → 成员 touch |

- **500 上限判在整批之上**（`members.length + 新增数 > 500`），不是逐条问「已经满了吗」——逐条判要到第 501 条才抛，而前 500 条已经写进去了，与「全成全败」直接矛盾。为此把 `projectAssignBlock` 拆成 `taskAssignBlock`（任务侧三条件）+ `exceedsGoalMemberCap(memberCount, addCount)`（容量），单条入口传 `addCount=1`，两个口径同源不漂。
- **`taskIds` 入口去重**。`existing` 是循环外快照、不随写入更新，重复 id 会让新增数多记，恰好卡在边界时误报满员；`addGoalMember` 的幂等只挡重复写 members，管不到容量判定。不能外包给调用方——撞 `.max(500)` 不是报错，是整行 parse 失败、整个 goal 从 UI 与同步里消失。
- **建组也走摘除路径**，不因「收件箱里的任务必无 project 归属」而跳过：摘旧组 / 准入闸 / 容量 / touch 只有一份实现，将来改归属语义不会漏掉建组这一侧。
- **不做「能进多少进多少」**：部分成功会留下「选了 6 条为何只进去 4 条」的哑谜，而撞 500 在真实使用里近乎不发生。
- **提交要有在途闸**（ref 不是 state——state 要等一次渲染，同 tick 第二发读到旧值），且覆盖异步全程含确认框。没有它，在项目名输入框里**按住回车**（系统自动重复约 30ms 一发）会建出两个同名 goal，第二个把成员从第一个摘走、留一个空壳组 + 一条推给别的设备的 create 日志。

## 4. 批量路径的前置边确认只剩一个窄窗口

归属轴排他的判据与 `prerequisiteLossOnAssignMany` 取源组的判据逐字相同（`status === "active" && kind === "project"`），叠上 §2 的剪枝——「选中项带 project 归属」在常规时序下**不可能成立**，确认框恒不弹。

仍然保留，因为剩一个真窗口：远端 goal 行**已落进 Dexie**、而 liveQuery 通知与剪枝 effect 还没跑完，用户恰在这几毫秒里松手。此时选中集还是旧的，而预测函数读的是最新库——该弹，不问就是静默丢边。**承重在数据层**（`goals.test.ts` 的 `prerequisiteLossOnAssignMany` 一节）；页面这一段测不了，jsdom 里 `act()` 会把渲染和 effect 一口气跑完。**它不是死代码。**

调用点必须**在两条提交路径的 `try` 之内**：它第一句就是 `db.goals.toArray()`，DatabaseClosed / 版本升级期会 reject，而提交是 `void submitXxx(...)` 发出的——留在 try 外既不进兜底 toast 也没人接这个 rejection，用户只看到「点了没反应」。用户点「取消」返回的是 `false` 不是异常，在 try 里照旧原地返回，不会被兜底 toast 当成错误。

## 5. 模块速查

| 入口 | 职责 |
|---|---|
| `pages/todo/TodoSelectionBar.tsx`（归 [todo/modules](../todo/modules.md) covers） | 多选态底部操作栏：已选计数、项目名就地输入（回车即提交，`disabled` 挡不住回车故另有早退闸）、「放进…」组列表、取消。零业务依赖，数据全走 props、动作全走回调 |
| `pages/todo/CollapsibleSection.tsx`（归 [todo/modules](../todo/modules.md) covers） | 通用折叠区块；`action` 插槽渲染在 summary 内并 `preventDefault`（§1），16 个调用方不传即行为不变 |
| `lib/goals.ts`（归 [goals](../goals.md) covers） | 批量写入三件套 `assignTasksToProject` / `createProjectWithMembers` / `prerequisiteLossOnAssignMany`（§3、§4）；单条版本与 `ProjectAssignError` 见母文档 §4.1 |
| `pages/TodoPage.tsx`（归 [todo](../todo.md) covers） | 模式态接线：`selectionMode` / `selectedIds` 与剪枝 effect、两套布局各一层 `inert` 包装、Esc 让位判据、`inboxOpen` 第二份展开态 |

用例分三层：`pages/todo/TodoSelectionBar.test.tsx`（计数、命名必填与 trim、回车两条路径、「放进…」列表、零项目时不渲染该按钮）、`pages/todo/TaskRow.test.tsx` 与 `TaskList.test.tsx`（行点击/Enter/Space 三种勾选路径、复选框在多选态下仍是「完成」、内层控件上按键不连带勾选、多选态不渲染拖柄与禁滑）、`pages/TodoPage.test.tsx`（进出多选、三处渲染点可选、其余区 inert 且窄屏宽屏**各一条**、Esc 退出与「有弹窗时让位」、建组/批量归入成功、满员拒绝、兜底文案两侧、剪枝四条、在途闸两条）。`lib/goals.test.ts` 覆盖批量写入的原子性（全成全败、撞 500 一条不写、摘除闸的 `status`/`kind` **各一条**、去重占位、`prerequisiteLossOnAssignMany` 的边去重与源组口径）。
