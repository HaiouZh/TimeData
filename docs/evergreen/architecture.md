---
type: evergreen
title: 架构总览
covers:
  - package.json
  - pnpm-workspace.yaml
  - packages/shared/src/index.ts
  - packages/client/src/main.tsx
  - packages/client/src/startup.ts
  - packages/client/src/App.tsx
  - packages/client/src/components/app-shell/AppRoutes.tsx
  - packages/client/src/components/app-shell/DesktopSidebar.tsx
  - packages/client/src/components/app-shell/MobileBottomNav.tsx
  - packages/client/src/components/app-shell/KeptRouteStack.tsx
  - packages/client/src/components/app-shell/keptLayerActive.ts
  - packages/client/src/components/AndroidBackButtonHandler.tsx
  - packages/client/src/components/ErrorBoundary.tsx
  - packages/client/src/components/EdgeSwipeBack.tsx
  - packages/client/src/contexts/BottomNavContext.tsx
  - packages/client/src/contexts/SyncContext.tsx
  - packages/client/src/lib/backNavigation.ts
  - packages/client/src/lib/edgeSwipe.ts
  - packages/client/src/lib/navScroll.ts
  - packages/client/src/lib/navigation/documentTitle.ts
  - packages/client/src/lib/useIsWideScreen.ts
  - packages/client/src/hooks/useDocumentTitle.ts
  - packages/client/src/hooks/useFavicon.ts
  - packages/client/src/hooks/useHideBottomNavOnScroll.ts
  - packages/client/src/hooks/useNowMinute.ts
  - packages/client/src/hooks/useUnsavedChangesGuard.ts
  - packages/server/src/index.ts
  - packages/server/src/lib/errors.ts
  - packages/cli/src/index.ts
  - packages/mobile/capacitor.config.ts
  - packages/mobile/android/app/src/main/AndroidManifest.xml
contracts:
  - packages/client/src/components/app-shell/AppRoutes.tsx
last-reviewed: 2026-08-03
---

# 架构总览

> 这份文档是 TimeData 的系统地图：六个包的关系、主要数据流、启动顺序、关键约定和文档登记簿。
> 具体功能域的字段、页面、路由和测试不在这里展开，去对应 evergreen 子文档。

## 1. 一句话定位

TimeData 是个人时间记录 PWA：

- 本地优先：Web 端先写 IndexedDB，再异步同步。
- 自托管：服务端是 Hono + SQLite，负责最终校验、写入、同步账本和受控 API。
- 多入口：Web/PWA、CLI、Android / iOS 的 Capacitor 壳、Windows 的 Tauri 壳；授权 agent 只能经服务端受控 API 写入。
- 数据域：时间记录、分类/设置、速记、待办、任务轨道、目标层、健康数据（仅数据层，无 UI）、统计/洞察、同步、备份。

**不做**：多用户、协作、SaaS、复杂权限、AI 直接写 DB 或备份/导出文件。

## 2. 六个包的职责与依赖

```text
shared  类型、schema、同步域登记簿、常量、跨端纯函数（occurrence 物化引擎 / 重复规则 / 日期助手 / 轨道看板信号 / 目标布局钉点 key helper）
   ▲
   ├── client  React + Dexie，本地优先 UI 与同步客户端
   ├── server  Hono + SQLite，鉴权、权威校验、同步账本、静态文件
   └── cli     Node CLI，server API 的受控封装

mobile   Capacitor Android / iOS 壳，webDir 指向 client/dist
desktop  Tauri Windows 壳，前端产物同样取 client/dist
```

依赖方向单向：`client` / `server` / `cli` 都依赖 `shared`，彼此不 import。它们靠 HTTP API、同步账本和共享类型契约协作。`mobile` 与 `desktop` 都不写业务逻辑，只包装前端构建产物与原生配置。

根 `package.json` 只做 workspace 脚本编排：构建先产出 `shared`，再并行跑 client/server/cli；测试允许 package 间有限并行并在最后串起根目录脚本测试；文档、UI、设计语言和测试卫生棘轮以 `check:*` 脚本集中暴露。包管理器由 `packageManager` 固定到 pnpm 11，`pnpm-workspace.yaml` 管 workspace、catalog 和原生依赖构建审批。本地命令细节见 [development](development.md)，CI 顺序见 [deployment](deployment.md)。

## 3. 总体数据流

### 3.1 本地优先写入

Web 端用户写入时，业务表 mutation 与 `syncLog(synced=0)` 必须在同一个 Dexie transaction 内完成。随后 `regularSync()` 把待同步变更 push 到 server，server 校验并分配 `sync_seq` / `updated_at`，其他设备按 seq pull。

时间记录与时间轴见 [timeline](timeline.md)；速记见 [quick-notes](quick-notes.md)；待办见 [todo](todo.md)；任务轨道见 [tracks](tracks.md)；目标层见 [goals](goals.md)；分类与设置见 [categories-settings](categories-settings.md)；健康数据表与同步域见 [data-model](data-model.md) §1.1。

### 3.2 服务端受控写入

CLI、agent 等脚本入口都必须经 server API 或 server 内部受控服务写入。server 是最终裁判：时间合法性、分类存在性、重叠、认证、同步序列和时间戳都由 server 判定或分配。

CLI 写时间记录见 [cli](cli.md) 与 [timeline](timeline.md)；agent 投递速记见 [quick-notes](quick-notes.md)；agent 回写任务见 [todo](todo.md)；agent 写任务轨道见 [tracks](tracks.md)。

### 3.3 同步与备份

同步使用服务端 `sync_seq` 账本模型，每台设备只保存一个 `sinceSeq` 读数。普通同步先查本地未同步日志：有待上传直接 push+pull；无待上传才向云端预检 latestSeq 判定 no-op 或补拉。设备端自动快照已退役（[ADR 0015](../adr/0015-remove-client-auto-snapshots.md)）。同步不是备份，恢复备份不会自动覆盖服务器。

同步机制见 [sync](sync.md)，备份格式和恢复规则见 [backup](backup.md)。

### 3.4 统计与终端视图

统计页只读 `timeEntries/categories/settings`，写入仅限 UI 设置。时间统计与洞察见 [stats-insights](stats-insights.md)。**没有健康仪表盘**：健康 Dexie 表只有数据层、无 UI 消费（见 [data-model](data-model.md) §1.1），体征/跑步由独立项目 run-track 承担（决策见 [ADR 0024](../adr/0024-retire-health-subsystem.md)）。

## 4. 启动顺序

### 4.1 服务端

`packages/server/src/index.ts`：

1. 创建 Hono app。
2. 装安全响应头、CORS、body limit。
3. 暴露 `/api/health` 与 `/api/version`。
4. 先挂 `/api/health` 与 `/api/version` 公开标记，再挂 `/api/*` request audit 与 scoped auth / Bearer auth；未配置 `AUTH_TOKEN` 默认 fail-closed。
5. 装 sync/admin rate limit。
6. 注册业务路由：agent 任务回写、agent 轨道 ingest、categories、entries、quick-notes、tasks、sync、export、update、data、diary、admin（含 sync logs / request logs）。
7. 服务静态前端产物与 SPA fallback。
8. `initializeDatabase()` 建表、补列、播种默认分类、处理一次性迁移。
9. 清理旧 server backup，按需跑每日备份并注册每日备份定时器。
10. 监听 `PORT`。

### 4.2 Web 客户端

`packages/client/src/main.tsx`：

1. 检查 `#root` 挂载点并先渲染 React 根。
2. `<AppUpdateProvider>`、`ErrorBoundary`、`RouterProvider`、`SyncProvider`、`BottomNavProvider`、`TrackAttentionProvider`、`AppShell` 依次包裹（`TrackAttentionProvider` 用 `useTrackAttentionCount` 把轨道「待我处理」回手计数下发给导航 badge，见 [tracks](tracks.md) §5；默认 0，只渲染导航壳的单测不触 db）。
3. `runStartupTasks()` 在后台串行执行 `seedDefaultCategories()`、`migrateLocalSettingsToDexie()`、`runSchemaNormalizationIfNeeded()` 与 occurrence materialization；失败只记录到控制台，不卸载已经渲染的应用。
4. 应用根用 `createBrowserRouter` + `RouterProvider`（data router，`useBlocker` 的硬前提），单条 `path: "*"` 的 splat route 承载 `SyncProvider → BottomNavProvider → TrackAttentionProvider → AppShell` 这层包裹，路由声明仍全部活在 `AppRoutes` 的 `<Routes>` 子树里；有未保存修改的页面用 `hooks/useUnsavedChangesGuard`（`useBlocker` 拦站内换页 + `beforeunload` 拦关页/刷新）统一拦截离开。该 splat route 还挂了 `errorElement: <RouteErrorFallback />`——RR 对根路由（`index === 0`）总会包一层内部 boundary，不给 `errorElement` 会落回 RR 自带的未翻译兜底页且这层在 `App()` 里 `<ErrorBoundary>` 之下、页面渲染错误冒不上去；`RouteErrorFallback`（`components/ErrorBoundary.tsx`）与类组件 `ErrorBoundary` 共用同一套兜底 UI，保证行为不因迁到 data router 而倒退。Router 注册时间轴、速记、待办、轨道、目标、时间统计、设置、记录编辑及搜索（`/search`，时间记录搜索，见 [timeline](timeline.md) §11）路由；AppShell 按 `1024px` viewport 断点分流：窄屏 / APK 渲染底部纯图标导航并继续使用 `nav.visibleTabs.v1`，数组内入口显示在底栏，数组外入口由 `/settings/more` 动态承接，不保留移动端三点菜单；宽屏渲染左侧固定纯图标侧栏并使用 `nav.desktopSidebar.v1` 的排序 / 更多收纳配置。导航配置只保存 route / placement，不保存颜色。两套主导航按钮都必须有 `aria-label`，active 形态只用 `accent` / `surface` / `border` token。`/goals` 先进入目标页宽窄分流壳：宽屏默认全局星图只读总览，窄屏默认列表，并允许手动切换；`/tracks` 与 `/tracks/:id` 包在 `TracksShell` 布局路由里（宽屏调度台常驻左列的 master-detail，右栏随路由出空态/详情；窄屏纯透传，见 [tracks](tracks.md) §8）。目标详情 `/goals/:id` 与轨道详情 `/tracks/:id` 在窄屏隐藏底部导航，宽屏仍保留桌面侧栏。设置子路由包含更多功能、导航、轨道行动标签、统计布局、服务端/数据/管理等入口，具体归属见各主题文档。
5. `SyncProvider` 在云同步开启且配置完整时维护 SSE 连接，并向模块级 `syncScheduler` 注册 executor；写入、SSE bump、回前台、隐藏前 flush、重连成功、失败退避与 60 秒兜底等触发统一经调度器驱动普通同步。成功热路径仍保持 300ms 防抖、2s max-wait 和无插队时单 push 请求；失败（含 pull-only）按上限指数退避，生命周期预检与 executor/SSE run 都按 generation 隔离。详见 [sync/realtime-and-scheduler](sync/realtime-and-scheduler.md)。

### 4.3 CLI

`packages/cli/src/index.ts`：

1. 解析 argv 与配置。
2. 对命令参数做体验侧校验。
3. 调 server API。
4. 格式化输出给人或脚本。

CLI 不直接读写 SQLite。命令面见 [cli](cli.md)。

### 4.4 Android 壳

`packages/mobile/capacitor.config.ts` 指向 `../client/dist`。Android 原生工程只承载壳、权限、图标和 Capacitor 插件配置；业务逻辑仍在 client。

### 4.5 iOS 壳：页面栈与边缘返回

iOS 原生工程不入库，构建链路与原生补丁见 [deployment/ios-ipa](deployment/ios-ipa.md)。**主内容区**的渲染路径上 iOS 与其余平台只有一处分叉：`AppShell` 按 `Capacitor.getPlatform() === "ios"` 二选一，iOS 渲染 `components/app-shell/KeptRouteStack.tsx`，其余平台仍是单份 `<main>` + `<Routes>`，分叉之外零差异。

`AppShell` 里另有一处与主内容区无关的平台条件：`lib/desktop/shell.ts` 的 `isDesktopShell()` 决定挂不挂 `components/desktop/DesktopBridge.tsx`（桌面壳的全局热键桥与打点反馈层，Tauri API 只在其内部动态 import，三端 bundle 不加载）。该 gate 与设置页「桌面设置」入口是桌面专属代码在 client 里的全部落点，见 [deployment/windows-desktop](deployment/windows-desktop.md)。

`KeptRouteStack` 让钻进子页时**上一页不卸载**：栈最多 2 层，每层一份 `<AppRoutes location={...}>`，非栈尾那层留在 DOM 里供边缘返回手势露出，返回后滚动位置与组件 state 因此原样还在。五条不变式违反后都不报错、不红测，只在真机上表现为「返回后位置偶尔丢」或「起手瞬间整屏闪暗」：

1. **隐藏只用 `visibility: hidden`**，不用 `display:none` / `hidden` 属性 / 摘除节点——无 layout box 会让滚动容器 `scrollTop` 清零。
2. **幸存层永不被 React 移动**——只从头部丢（超限）或从尾部截断（回退命中栈内条目），剩下的层相对顺序不变，React 只做 removeChild。让它移动已挂载层会搬 DOM 节点，同样清 `scrollTop`。
3. **两层恒 `absolute inset-0`**，含栈尾那层；布局方式不对保留层单独特殊化。
4. **每层各自一个 `<Suspense fallback={null}>`**——共用边界会让子页懒加载时整个栈一起挂起，保留层跟着消失。
5. **暗化遮罩 `[data-kept-overlay]` 渲染在保留层子树内**，不提到栈容器下：提出去就按 DOM 顺序盖在栈尾那层之上，把正在跟手滑出的当前页也一起压暗。刻意不用 z-index 修——给栈尾层加 z-index 会让它成为层叠上下文，把页面内 `position: fixed` 的整屏浮层封在里面；调 DOM 顺序则会触发不变式 2。

栈的推进是纯函数 `nextStack(prev, location, navigationType)`。导航类型必须与 location 一起读（`useNavigationType()` 与 `useLocation()` 同出一个 context，同帧一致），三种导航对栈的影响完全不同：

- **REPLACE** 只换栈尾渲染用的 location，**沿用该层原有的 React key**。replace 换 `location.key` 却不新增历史条目，跟着换 key 等于告诉 React「这是新页面」而整页重挂；切日期、改筛选这类 `setSearchParams(..., { replace: true })` 是高频路径。
- **查栈按 `location.key`（历史条目身份），不按 React key**。被 replace 过的那层两者已不同，按 React key 查会找不到、把回退当新页 append。
- **POP 到栈外**（回退超出 2 层窗口，或前进）栈重置为只剩当前一层：来处未知时唯一诚实的状态是没有保留层，手势随之不启动，宁可少一次可用也不露出方向相反的页。
- 兜底不变式：**当前 location 恒为栈尾**。

底栏渲染在层内而非栈外，返回手势中上一页的底栏跟着一起滑回来；代价是保留层的 `NavLink` 高亮读真实当前 location，手势期间短暂不准。两条渲染路径共用 `lib/navigation/navRegistry.ts` 的 `layoutHidesBottomNav` 判据，不各抄一份——分头演化会让 iOS 与非 iOS 静默分叉。

**保留层要主动闭嘴**：`visibility: hidden` + `inert` 只挡得住「看得见 / 摸得着」，挡不住已经注册到全局的东西。每层通过 `app-shell/keptLayerActive.ts` 的 `KeptLayerActiveContext` 向子树声明自己是否活跃，**缺省 `true`**（非 iOS 不渲染本组件，子树只能吃缺省值；写成 `false` 会把桌面/安卓的守卫一起关掉）。首个消费方是 `hooks/useUnsavedChangesGuard.ts`：它的 `useBlocker` 原本靠「卸载即注销」保证只管自己那一页，而保留层不卸载——不读这面旗子的话，脏着的日记页切走后会在别的页凭空弹出「放弃未保存的修改？」，选「继续编辑」还把用户钉在那儿。凡是「注册到全局、注册后不再自查可见性」的钩子都应照办。`beforeunload` 那条腿不看这面旗子：关标签页确实会把保留层没保存的字一起弄丢。

边缘返回由 `components/EdgeSwipeBack.tsx` 承担，只在 iOS 挂 touch 监听，按 `data-kept-layer="active"` / `"kept"` 与 `data-kept-overlay` 三个选择器取层。跟手位移**直接写 DOM `style.transform`**，不走 React state——每帧 setState 会重渲染整棵页面树。

**手势是一台四态状态机**：`idle` → `tracking`（边缘落点已过全部生效条件，但位移还没到 `EDGE_SLOP_PX`，此时不碰 DOM、不 `preventDefault`）→ `engaged`（判为横向，接管这一笔）→ `settling`（rAF 逐帧插值收尾，期间不接新手势）。**方向只在过 slop 那一刻判一次**：判成纵向即整笔作废，之后拐成横向也不接——否则拇指贴左边缘往下滚列表时，第一条 `dx=2, dy=1` 的 touchmove 就会锁死整笔手势，整页滚不动。

起手判据：触点起点在左边缘 `EDGE_WIDTH_PX` 内、`lib/backNavigation.ts` 的 `hasParentRoute` 为真（tab 主页与首页之间从不用手势切）、栈里有保留层、当前不是目标详情（整页是可自由拖动的关系图，与右滑同向）、没有模态对话框、单指、触点链路上没有 `data-edge-swipe-block`。**让路只认这个显式标记，不看 `overflow-x` 的计算值**——`overflow-y` 非 visible 时 `overflow-x: visible` 的计算值会被改写成 `auto`，而每层的 `<main>` 正是 `overflow-y-auto`，真横滚容器与普通竖滚祖先根本分不开。故 dnd-kit 拖柄与真正的横滚容器都要自己标上；标在元素**本身**，不加到整行——加宽一层就是整行都吃不到手势。起手与松手的算术在 `lib/edgeSwipe.ts`。

**收尾靠 rAF 逐帧插值，不靠 CSS transition + `transitionend`**：后者首末值相同时根本不产生过渡（拉回起点再松手就永不收尾）、事件会冒泡且分不清是页面内哪个元素的过渡、被打断时发的是 `transitioncancel`。rAF 自己把进度数到 1，每条路径都是确定性的。清理一律用**起手时捕获的元素引用**，不回头查 DOM——返回成功后栈已截断成一层、`[data-kept-layer="kept"]` 当场消失，任何重查都会漏掉幸存层上的 `transform` / `will-change`，而这两者都会让该层成为 `position: fixed` 后代的包含块，整屏浮层从此盖不住状态栏。位移基准取**层自身宽度**而非 `window.innerWidth`（iPad 上层是侧栏旁的 flex 子项）。

**返回一律 `navigate(-1)`**——换成 `navigate(父页, { replace: true })` 会生成新 `location.key`，保留层被当新页重挂，整套机制静默失效。发出后按帧比对 `location.key` 是否变化：变了就清理收工；短暂窗口内没变即视为被「未保存就别走」守卫拦下，当场弹回原位——不能让当前页停在屏外干等，那时屏上铺的是带 `inert` 的上一页，点哪都没反应。

## 5. 关键约定

1. **写入边界**：Web 本地写 Dexie；脚本/AI/agent 经 server API；server 内部受控服务可写 SQLite 并追加 `sync_seq`。禁止直接编辑 SQLite / IndexedDB / syncLog / Backup / JSONL / CSV。
2. **服务端最终裁判**：client / CLI 校验只为体验，不能让 server 跳过权威校验。
3. **时间一律 UTC ISO**：存储和传输都带 `Z`，展示再转本地。
4. **SQL snake_case，JS camelCase**：手工映射，没有 ORM。
5. **同步域登记簿封闭**：新增域必须改 `packages/shared/src/syncDomains.ts` 和 `packages/server/src/sync/domains.ts`，见 [ADR 0012](../adr/0012-sync-ledger-and-domain-registry.md)。
6. **SyncPushReasonCode 封闭**：扩展必须同步 server validation、client engine 和文档。
7. **Sync ≠ Backup**：同步是多设备一致性，备份是防误删。

## 6. 文档登记簿

文档准入、详略、主题轴（域/模块/设计语言/横切）判定树、`covers` 多对多归属和骨架模板见 [_docs-guide](_docs-guide.md)；拆分与体量阈值见 [_docs-guide/splitting](_docs-guide/splitting.md)。本登记簿只列**主题文档**；主题膨胀后外提的子文档由各自主题文档在“子文档索引”里登记，不在此重复。

| 文档 | 类型 | 职责 |
|---|---|---|
| [_docs-guide](_docs-guide.md) | 横切 | evergreen 写作准入、详略、组织和骨架模板；拆分与检查分别见子文档 |
| [architecture](architecture.md) | 横切 | 系统地图、六包关系、启动顺序、文档登记簿 |
| [data-model](data-model.md) | 横切 | 跨域数据契约、全表索引脉、同步信封、时间/ID/映射约定 |
| [development](development.md) | 横切 | 开发流程、测试分层、工程约定 |
| [deployment](deployment.md) | 横切 | 部署、环境变量、Docker、自更新 |
| [security](security.md) | 横切 | 鉴权、token、CORS、安全边界 |
| [cli](cli.md) | 横切 | CLI 命令面、参数校验、输出契约 |
| [sync](sync.md) | 域 | 同步账本、域登记簿、push/pull、冲突、force-push |
| [backup](backup.md) | 域 | Backup 格式、导出/导入、服务端备份、恢复边界 |
| [timeline](timeline.md) | 域 | 时间记录、时间轴、跨夜、时间选择、相邻合并 |
| [quick-notes](quick-notes.md) | 域 | 速记表、聊天式速记页、CLI 只读、agent 投递 |
| [diary](diary.md) | 域 | 日记 vault 文件、路径模板展开与安全校验、mtime 并发守卫、有序列表续号 |
| [todo](todo.md) | 域 | 待办任务、重复规则、子任务、agent 状态回写 |
| [project-zone](project-zone.md) | 域 | 项目区与归属轴：两份 goal→task 索引、分组投影、收件箱排他、归属变更 touch 不变量、呈现契约 |
| [tracks](tracks.md) | 域 | 任务轨道、轨道步骤、状态线数据地基、agent ingest |
| [goals](goals.md) | 域 | 目标层、Task/Track 成员引用、项目完成度、主题 7 天活跃度、前置关系 |
| [stats-insights](stats-insights.md) | 域 | 时间统计、洞察模块、统计布局和趋势设置 |
| [admin](admin.md) | 运维 | `/settings/admin-insights` 只读管理洞察 API、健康检查、异常筛选和基础分析 |
| [categories-settings](categories-settings.md) | 域 | 分类 schema、分类管理、排序/颜色/删除、sleep/punch 分类设置 |
| [design-language](design-language.md) | 设计 | 语义颜色 token、字体与排版角色、圆角/边框/阴影、自绘控件库、Phosphor 图标、设计语言棘轮 |

## 7. 不在这份文档里的事

- 具体字段 schema、页面细节、路由细节和测试清单。
- 本地过程文档、spec、plan、review；这些在 `docs_local/**`。
- ADR 正文；ADR 仅追加，不在 architecture 复述。
