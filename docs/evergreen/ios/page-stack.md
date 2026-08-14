---
type: evergreen
title: iOS 壳 · 页面栈与边缘返回
covers:
  - packages/client/src/components/app-shell/KeptRouteStack.tsx
  - packages/client/src/components/app-shell/keptLayerActive.ts
  - packages/client/src/components/EdgeSwipeBack.tsx
  - packages/client/src/lib/edgeSwipe.ts
  - packages/client/src/lib/backNavigation.ts
  - packages/client/src/hooks/useUnsavedChangesGuard.ts
contracts:
  - packages/client/src/components/app-shell/KeptRouteStack.tsx
  - packages/client/src/components/app-shell/keptLayerActive.ts
  - packages/client/src/components/EdgeSwipeBack.tsx
last-reviewed: 2026-08-14
---

# iOS 壳 · 页面栈与边缘返回

> [ios](../ios.md) 的**子文档**：iOS 壳如何在钻进子页时保留上一页（`KeptRouteStack`）、保留层如何灭声（`keptLayerActive`）、边缘返回手势怎么起手与收尾（`EdgeSwipeBack`）。
> 不讲：调度器挂起死锁（见 [scheduler-resilience](scheduler-resilience.md)）、原生工程构建链路与工程为何不入库（见 [母文档](../ios.md) §2 / §1）。

## 承上启下

- **上游**：`AppShell` 按 `Capacitor.getPlatform() === "ios"` 二选一——iOS 渲染 `KeptRouteStack`，其余平台仍是单份 `<main>` + `<Routes>`，分叉之外零差异（分叉位置见 [architecture](../architecture.md) §4.5）。
- **下游**：每层各渲染一份 `<AppRoutes location={...}>`，全部页面路由都活在层内；「注册到全局、注册后不再自查可见性」的钩子（首个是 `hooks/useUnsavedChangesGuard`）要读保留层的活跃旗子（§3）。
- **契约**：栈的五条不变式与推进纯函数 `nextStack`（§1–§2）、`KeptLayerActiveContext` 缺省 `true`（§3）、手势四态状态机与起手判据（§4）。
- **邻居**：[scheduler-resilience](scheduler-resilience.md)（同属 iOS 壳：诊断「半瘫」现场时先与本文保留层 `inert` 盖屏鉴别）、[development](../development.md)（Android 返回键与手势共用 `backNavigation` 的同一张语义表）。

## 1. 保留式页面栈：五条不变式

`KeptRouteStack` 让钻进子页时**上一页不卸载**：栈最多 2 层，每层一份 `<AppRoutes location={...}>`，非栈尾那层留在 DOM 里供边缘返回手势露出，返回后滚动位置与组件 state 因此原样还在。五条不变式违反后都不报错、不红测，只在真机上表现为「返回后位置偶尔丢」或「起手瞬间整屏闪暗」：

1. **隐藏只用 `visibility: hidden`**，不用 `display:none` / `hidden` 属性 / 摘除节点——无 layout box 会让滚动容器 `scrollTop` 清零。
2. **幸存层永不被 React 移动**——只从头部丢（超限）或从尾部截断（回退命中栈内条目），剩下的层相对顺序不变，React 只做 removeChild。让它移动已挂载层会搬 DOM 节点，同样清 `scrollTop`。
3. **两层恒 `absolute inset-0`**，含栈尾那层；布局方式不对保留层单独特殊化。
4. **每层各自一个 `<Suspense fallback={null}>`**——共用边界会让子页懒加载时整个栈一起挂起，保留层跟着消失。
5. **暗化遮罩 `[data-kept-overlay]` 渲染在保留层子树内**，不提到栈容器下：提出去就按 DOM 顺序盖在栈尾那层之上，把正在跟手滑出的当前页也一起压暗。刻意不用 z-index 修——给栈尾层加 z-index 会让它成为层叠上下文，把页面内 `position: fixed` 的整屏浮层封在里面；调 DOM 顺序则会触发不变式 2。

## 2. 栈的推进：`nextStack` 纯函数

栈的推进是纯函数 `nextStack(prev, location, navigationType)`。导航类型必须与 location 一起读（`useNavigationType()` 与 `useLocation()` 同出一个 context，同帧一致），三种导航对栈的影响完全不同：

- **REPLACE** 只换栈尾渲染用的 location，**沿用该层原有的 React key**。replace 换 `location.key` 却不新增历史条目，跟着换 key 等于告诉 React「这是新页面」而整页重挂；切日期、改筛选这类 `setSearchParams(..., { replace: true })` 是高频路径。
- **查栈按 `location.key`（历史条目身份），不按 React key**。被 replace 过的那层两者已不同，按 React key 查会找不到、把回退当新页 append。
- **POP 到栈外**（回退超出 2 层窗口，或前进）栈重置为只剩当前一层：来处未知时唯一诚实的状态是没有保留层，手势随之不启动，宁可少一次可用也不露出方向相反的页。
- 兜底不变式：**当前 location 恒为栈尾**。

## 3. 层内底栏与保留层灭声

底栏渲染在层内而非栈外，返回手势中上一页的底栏跟着一起滑回来；代价是保留层的 `NavLink` 高亮读真实当前 location，手势期间短暂不准。两条渲染路径共用 `lib/navigation/navRegistry.ts` 的 `layoutHidesBottomNav` 判据，不各抄一份——分头演化会让 iOS 与非 iOS 静默分叉。

**保留层要主动闭嘴**：`visibility: hidden` + `inert` 只挡得住「看得见 / 摸得着」，挡不住已经注册到全局的东西。每层通过 `app-shell/keptLayerActive.ts` 的 `KeptLayerActiveContext` 向子树声明自己是否活跃，**缺省 `true`**（非 iOS 不渲染本组件，子树只能吃缺省值；写成 `false` 会把桌面/安卓的守卫一起关掉）。首个消费方是 `hooks/useUnsavedChangesGuard.ts`：它的 `useBlocker` 原本靠「卸载即注销」保证只管自己那一页，而保留层不卸载——不读这面旗子的话，脏着的日记页切走后会在别的页凭空弹出「放弃未保存的修改？」，选「继续编辑」还把用户钉在那儿。凡是「注册到全局、注册后不再自查可见性」的钩子都应照办。`beforeunload` 那条腿不看这面旗子：关标签页确实会把保留层没保存的字一起弄丢。

## 4. 边缘返回手势：状态机与起手判据

边缘返回由 `components/EdgeSwipeBack.tsx` 承担，只在 iOS 挂 touch 监听，按 `data-kept-layer="active"` / `"kept"` 与 `data-kept-overlay` 三个选择器取层。跟手位移**直接写 DOM `style.transform`**，不走 React state——每帧 setState 会重渲染整棵页面树。

**手势是一台四态状态机**：`idle` → `tracking`（边缘落点已过全部生效条件，但位移还没到 `EDGE_SLOP_PX`，此时不碰 DOM、不 `preventDefault`）→ `engaged`（判为横向，接管这一笔）→ `settling`（rAF 逐帧插值收尾，期间不接新手势）。**方向只在过 slop 那一刻判一次**：判成纵向即整笔作废，之后拐成横向也不接——否则拇指贴左边缘往下滚列表时，第一条 `dx=2, dy=1` 的 touchmove 就会锁死整笔手势，整页滚不动。

起手判据：触点起点在左边缘 `EDGE_WIDTH_PX` 内、`lib/backNavigation.ts` 的 `hasParentRoute` 为真（tab 主页与首页之间从不用手势切）、栈里有保留层、当前不是目标详情（整页是可自由拖动的关系图，与右滑同向）、没有模态对话框、单指、触点链路上没有 `data-edge-swipe-block`。**让路只认这个显式标记，不看 `overflow-x` 的计算值**——`overflow-y` 非 visible 时 `overflow-x: visible` 的计算值会被改写成 `auto`，而每层的 `<main>` 正是 `overflow-y-auto`，真横滚容器与普通竖滚祖先根本分不开。故 dnd-kit 拖柄与真正的横滚容器都要自己标上；标在元素**本身**，不加到整行——加宽一层就是整行都吃不到手势。起手与松手的算术在 `lib/edgeSwipe.ts`。

## 5. 收尾与返回

**收尾靠 rAF 逐帧插值，不靠 CSS transition + `transitionend`**：后者首末值相同时根本不产生过渡（拉回起点再松手就永不收尾）、事件会冒泡且分不清是页面内哪个元素的过渡、被打断时发的是 `transitioncancel`。rAF 自己把进度数到 1，每条路径都是确定性的。清理一律用**起手时捕获的元素引用**，不回头查 DOM——返回成功后栈已截断成一层、`[data-kept-layer="kept"]` 当场消失，任何重查都会漏掉幸存层上的 `transform` / `will-change`，而这两者都会让该层成为 `position: fixed` 后代的包含块，整屏浮层从此盖不住状态栏。位移基准取**层自身宽度**而非 `window.innerWidth`（iPad 上层是侧栏旁的 flex 子项）。

**返回一律 `navigate(-1)`**——换成 `navigate(父页, { replace: true })` 会生成新 `location.key`，保留层被当新页重挂，整套机制静默失效。发出后按帧比对 `location.key` 是否变化：变了就清理收工；短暂窗口内没变即视为被「未保存就别走」守卫拦下，当场弹回原位——不能让当前页停在屏外干等，那时屏上铺的是带 `inert` 的上一页，点哪都没反应。

## 6. 模块速查

| 入口 | 职责 |
|---|---|
| `components/app-shell/KeptRouteStack.tsx` | 保留式页面栈：层的保留 / 截断 / 重置与 `nextStack` 纯函数 |
| `components/app-shell/keptLayerActive.ts` | `KeptLayerActiveContext`：向子树声明本层是否活跃，缺省 `true` |
| `components/EdgeSwipeBack.tsx` | 边缘返回手势：四态状态机、跟手位移直写 DOM、rAF 收尾 |
| `lib/edgeSwipe.ts` | 起手与松手的算术 |
| `lib/backNavigation.ts` | `hasParentRoute`：手势生效判据之一，与 Android 返回键共用同一张「层级子页 → 返回目标」语义表 |
| `hooks/useUnsavedChangesGuard.ts` | 未保存守卫：`useBlocker` + `beforeunload`，读活跃旗子后保留层内不再拦截站内换页 |

**测试**：`KeptRouteStack.test.tsx`、`EdgeSwipeBack.test.tsx`、`edgeSwipe.test.ts`、`backNavigation.test.ts`、`useUnsavedChangesGuard.test.tsx`。
