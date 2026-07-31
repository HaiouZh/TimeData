---
type: evergreen
title: 设计语言
covers:
  - packages/client/src/index.css
  - packages/client/src/lib/navigation/navRegistry.ts
  - packages/client/src/components/app-shell/DesktopSidebar.tsx
  - packages/client/src/components/app-shell/MobileBottomNav.tsx
  - packages/client/src/pages/settings/SettingsDetailPage.tsx
  - packages/client/src/pages/settings/components/SettingsRows.tsx
  - packages/client/src/lib/zLayers.ts
  - packages/client/src/pages/dev/StyleguidePage.tsx
  - packages/client/src/pages/stats/chartColors.ts
  - packages/client/src/lib/contentTint.ts
  - scripts/check-design-language.mjs
  - scripts/design-language-allowlist.json
contracts:
  - packages/client/src/index.css
  - scripts/design-language-allowlist.json
  - packages/client/src/lib/navigation/navRegistry.ts
last-reviewed: 2026-07-31
---

# 设计语言

> 设计语言**主题文档**（非数据域，按“设计风格”轴成主题）：深冷工具基调的暗色视觉系统——语义颜色 token + 书卷体字体 + Phosphor 图标 + 自绘控件。
> 讲什么：语义颜色治理、圆角/边框/阴影阶梯、字体栈与排版角色、设计语言棘轮、全站视觉红线。
> 不讲什么：自绘控件库与无原生控件棘轮（见子文档 [design-language/controls](design-language/controls.md)）、各功能页如何用这些 token（见各功能主题）。

## 承上启下

- **上游**：无（这是最底层的视觉/交互基座）。token 与全局样式集中在单一文件 `index.css`（Tailwind v4 `@theme static`）。
- **下游**：所有功能主题（[timeline](timeline.md)/[todo](todo.md)/[quick-notes](quick-notes.md)/[stats-insights](stats-insights.md)/[categories-settings](categories-settings.md)）的页面与组件都消费这些 token 和控件；它们只在「邻居」链接到本主题，不重复 token 定义。
- **契约**：颜色/圆角/字体 token 与排版角色见本文 §1–§2（源在 `index.css`）；设计语言棘轮见 §3；自绘控件契约见 [design-language/controls](design-language/controls.md)；图表取色（recharts 镜像 token，`pages/stats/chartColors.ts`）见本文 §4 第 5 条。
- **邻居**：[design-language/controls](design-language/controls.md)（同主题子文档）、全部功能主题（消费方）。

## 1. 语义颜色 token 体系（`index.css` `@theme static`）

设计按语义层治理颜色，不按模块分配品牌色：

| 层 | token / 来源 | 用途与红线 |
|---|---|---|
| **中性底盘** | `--color-page` `--color-surface` `--color-surface-elevated` `--color-surface-hover`；文字 `--color-ink` `--color-ink-2` `--color-ink-3` | 暗色底盘 + 三级文字（均 ≥ WCAG AA）。绝大多数 UI chrome 只用这一层 |
| **单一动作色** | `--color-accent` `--color-accent-strong` `--color-accent-soft` `--color-accent-ink`（蓝） | 全站唯一动作色。按钮/聚焦/主操作/active 只用蓝，不引入第二动作色 |
| **状态色** | `--color-ok` `--color-warn` `--color-danger` | 只表达成功/警告/危险/错误/冲突；柔和状态面由主色 alpha 派生（背景 `/10`、hover `/15`），不维护 soft 别名 |
| **用户内容色** | `--color-tint-1..9`（固定 9 支，项目 / 标签共用）+ 分类色 | 属业务数据，不属于 UI chrome；使用时要能说明来自用户内容 |
| **Track scoped 信号色** | `--color-track-agent` | 只表达 Track 调度台“agent 在跑”，不充当动作色、状态色或模块署名色 |
| **scoped 特殊场景色** | 例如 `--galaxy-*` | 只服务独立画布/世界观场景，必须有独立 prefix，不扩展全站动作色 |

- **模块署名色已退役**：`--color-mod-*`、`text-mod-*`、`bg-mod-*`、`border-mod-*` 不再作为设计语言的一部分。模块身份靠固定位置、图标、页面标题、信息架构和 active 形态，不靠每个模块一套品牌色。
- **Goal 星图局部命名空间**：`--galaxy-edge` / `--galaxy-edge-glow` / `--galaxy-star-core` 只允许 `pages/goals/**` 的星图边、星核和光晕使用；它们不扩展全站动作色，也不替代 `--color-accent`。星图节点的状态光晕（ready/blocked/completed/parked/active/anchor）通过 `--shadow-galaxy-*` scoped shadow token 消费（如 `--shadow-galaxy-ready`、`--shadow-galaxy-blocked` 等），组件用 `shadow-[var(--shadow-galaxy-*)]`，不写裸 rgba。
- **圆角阶梯**：`--radius-ctl`(8) / `--radius-row`(12) / `--radius-card`(16) / `--radius-pill`(999)，分别表达控件、列表行、面板卡片与圆形/胶囊；`rounded` / `rounded-sm` 只服务发丝级或小型原子细节。生产组件不使用 Tailwind `md/lg/xl/2xl/3xl/full` 原生圆角词汇（棘轮 `bare-card-radius`，见 §3）。
- **边框**：`--color-border` / `--color-border-strong` / `--color-border-hairline`(rgba 8%)。
- **滚动条**：`--color-scrollbar-thumb` / `--color-scrollbar-thumb-hover`（滑块常态 / 悬停提亮，色值同边框灰蓝档但语义独立）。`html` 上 `scrollbar-width: thin` + `scrollbar-color` 全站继承，轨道透明；hover 提亮走零特异性 `:where(:hover)`，局部隐藏特例（如转盘 `.wheel-scroll`）可直接压过。**只用标准属性，不用 `::-webkit-scrollbar` 伪元素**——后者会让 Chrome/Edge 从 overlay 条退化成常驻占位条（`indexCssTokens.test.ts` 有计数闸守着，全站仅转盘的 display:none 隐藏一处豁免）。
- **阴影**：`--shadow-elev1`（小表面）/ `--shadow-elev2`（浮层），仅大表面用；两者均叠了顶部 `inset 0 1px 0` hairline 高光，暗色下给大表面一道微亮上沿。
- **动效**：普通过渡使用 Tailwind `duration-150/200/300`、`duration-0` 与 `ease-out`；sheet `150/200ms ease-out`、Todo occurrence `300ms cubic-bezier(0.2, 0, 0, 1)` 等 keyframe 在 `index.css` 邻近声明具体值。长循环动画保留自身值；所有动画尊重 `prefers-reduced-motion`。
- **z-index 层级**：`--z-dropdown`(30) / `--z-backdrop`(40) / `--z-modal`(50) / `--z-top`(70)，只治理**全局浮层**；普通 sticky header、画布 HUD 与 notice 属局部 stacking，使用 `z-10`/`z-20`。CSS 是单一事实源，内联 `style.zIndex` 走 JS 镜像 `lib/zLayers.ts` 的 `Z`（类比图表色镜像），`zLayers.test.ts` 守 JS 与 CSS 阶梯一致。
- **用户内容身份色**：`--color-tint-1..9`。约束是 WCAG 对比度（圆点 ≥3:1、caption 档 `#` 与填充态深字 ≥4.5:1），色相尽量避开 accent / ok / warn / danger 四个已占用值；支数定在 9 是因为四禁区吃掉 160° 色相环后，再多就有相邻支在 6px 圆点上分不出（取舍见 [ADR 0026](../adr/0026-content-tint-shared-palette-shape-distinguishes-type.md)）。取色内核 `lib/contentTint.ts` 两条路都不存储：**标签** `contentTint(标签名)` 哈希取模、允许撞色；**项目** `assignProjectTints(按 createdAt 升序的 goalId)` 集合内避撞——首选位由哈希决定（色因此散布在整个色板上，不是从 `tint-1` 依次发号），被占才顺移，≤9 个项目保证互不同色。项目分配由 `listTasks` 基于**全部 active project** 算出、随 `TodoBuckets.projectTints` 下发，组件不自行取色。**类型区分靠形状不靠颜色**：圆点 = 项目，`#` = 标签——同一行 meta 区两者并排时，颜色只表达「是哪一个」，形状表达「是哪一类」，故两者共用一组色板、偶尔撞色不构成歧义。真实形态（6px 圆点 / caption 档 `#` / 筛选面板填充态）在 `/dev/styleguide` 的「身份色的真实形态」一节验收——色值与支数都由这一节定，色块预览不作为验收依据。因由见 [ADR 0026](../adr/0026-content-tint-shared-palette-shape-distinguishes-type.md)。
- **token 分账**：`core 31 / business identity 10 / Goal scoped 12 = 53`；business identity 是 tint 9 支与 Track agent 1 支。按 owner 与生产消费审计，不为 `<50` 合并跨域职责（见 [ADR 0027](../adr/0027-retire-unused-data-palette-and-scope-track-agent-tone.md)）。
- **派生软色**：状态面直接使用主状态色 alpha；其他派生色用 `color-mix(in srgb, <token> N%, transparent)` 或职责明确的既有 soft token，不另写裸色。

新增颜色流程：

1. 先判断现有层级是否足够：背景/文字用中性，操作用动作蓝，状态用状态色，图表序列用分类色，用户内容用业务身份色。
2. 如果不够，写清新颜色表达的语义，不能以“页面更有特色”为理由。
3. 限定 owner：全站 core、business identity，还是有明确 prefix 的领域 scoped 层。
4. 同步 evergreen 文档、`check:design` 规则 / allowlist、必要测试和人工验收条目。
5. 新增颜色层级或 scoped palette 必须用户拍板。

## 2. 字体与排版角色（书卷体）

- `--font-body: "Times New Roman", "Tinos", "LXGW WenKai Screen", "KaiTi", "STKaiti", serif`——**西文在前、中文在后，逐字回退**：西文走 Times/Tinos，汉字落霞鹭文楷。
- `--font-mono`（JetBrains Mono…）只用于 `code/pre/kbd/samp`、日志、ID、debug、技术标识。
- 字体在 `main.tsx` 引入：**只引霞鹭文楷 GB 屏显子集** `lxgw-wenkai-screen-webfont/lxgwwenkaigbscreen.css`（约 4.7MB，避免 R 变体与重复字族撑大 APK）+ `@fontsource/tinos` 的 400/400-italic/700。`fontLoading.test.ts` 守 import 顺序（lxgw 在 tinos 之前）。
- 全站 `body` 用 `--font-body`；远程加载推迟到做字体设置时再上。
- 排版**只用**语义排版类：`td-text-caption`、`td-text-label`、`td-text-body`、`td-text-title`、`td-text-display`。`bare-text-size` 是硬闸：新写 `text-xs/sm/base/...` 或 `text-[13px]` 一律直接失败，不得加 allowlist。**图标按钮与 `input`/`textarea`/`select` 上的字号声明不生效**（前者内容是 SVG，后者被顶层 iOS 防缩放兜底压过），这类行的正确处置是删掉字号而非迁语义类（见 [controls](design-language/controls.md) §1）。语义档与字号映射：caption≈12px、label≈13px、body≈15px、title≈20px(600)、display≈28px(600)。
- **`.td-text-*` 定义在 `index.css` 顶层未分层区，会压过 `@layer utilities` 里的所有 Tailwind 排版 utility**：同一行上的 `leading-*`、`tracking-*` 一律不生效，`font-*` 只对 caption/label/body 生效（这三档不定义 `font-weight`），对 title/display 不生效（两档自带 600）。要偏离档位内建值时不要靠 utility 叠加，而是加一条**排版角色语义类**——如卡片眉标 `.td-eyebrow`（12px + 500 + 大写 + `letter-spacing: 0.16em`），放 `@layer components`。
- 数字/时间/时长使用 `td-num`、`td-time`、`td-duration`，三者指向 `--font-body` 并启用 `font-variant-numeric: tabular-nums`；统计卡数值使用 `td-num`。数字默认不使用等宽字体。

## 3. 设计语言棘轮

`pnpm check:design` 扫描 `packages/client/src`，由 `scripts/check-design-language.mjs` 执行。它不是审美检查，而是防回退闸：

- 禁止退役模块色：`--color-mod-*`、`text-mod-*`、`bg-mod-*`、`border-mod-*` 等。
- 禁止退役 data palette：`--color-data-*` 及其 Tailwind utility；图表序列走分类色，Track agent 信号走 `track-agent`。
- 禁止退役 motion token 与独立 soft 状态色别名；motion 使用 Tailwind 标准档或 keyframe 邻近值，状态柔面使用主状态色 alpha。
- 禁止新增 UI chrome 裸 `slate-*`，主操作裸 `blue-*` / `sky-*`，状态裸 `emerald-*` / `green-*` / `amber-*` / `yellow-*` / `orange-*` / `red-*` / `rose-*` / `gray-*`；覆盖 `bg/text/border/ring/fill/stroke/outline/caret/accent/shadow/decoration` 等常见 Tailwind 色彩工具。
- 禁止 UI chrome 新增裸 hex / rgb / rgba / hsl / oklch / lab；测试 fixture、用户内容色、图表色和 scoped 特殊场景由脚本/allowlist 显式区分。
- **token 定义与图表镜像不算「裸色」**：`index.css` 里 `--color-*` / `--galaxy-*` / `--shadow-*` 的 token 定义本身（值含 hex/rgba）是颜色的唯一事实源，脚本直接跳过；图表色镜像文件 `pages/stats/chartColors.ts`（recharts 不解析 `var()`，故把 token 镜像成 JS 常量）也整文件跳过 `bare-raw-color`。镜像文件登记在脚本的 `TOKEN_MIRROR_FILES`，新增镜像文件需登记；长期 allowlist 不是维持图表裸 hex 的手段。
- 禁止交互控件用文字字符或 emoji 伪装图标。
- 禁止业务时间/数字/统计值直接用 `font-mono`；代码、日志、ID、debug 标识应优先放在 `code/pre/kbd/samp` 或专用技术文本组件中，确有遗留例外必须进 allowlist。
- 禁止原生圆角 `rounded-md/lg/xl/2xl/3xl/full` 及其方向变体：规则 `bare-card-radius`，生产代码使用 `rounded-ctl/row/card/pill`，仅发丝级/小型原子细节保留 `rounded/rounded-sm`（测试文件豁免）。
- 禁止裸字号 `text-{xs,sm,base,lg,xl,2xl…}` 与字号任意值 `text-[…px|rem]`：规则 `bare-text-size`，须用 `.td-text-{caption,label,body,title,display}` 语义类（`.css` 与测试文件豁免）。
- 禁止全局浮层裸高 z-index（`z-30/40/50/60/70`、`z-[…]`）：规则 `bare-zindex`，须用 `z-[var(--z-*)]`；局部 stacking `z-10`/`z-20` 放行（测试文件豁免）。
- 禁止裸任意尺寸/间距/定位值（`w-[34px]`、`top-[4.75rem]` 等纯数字+单位）：规则 `bare-arbitrary-value`，收进 token 或标准 Tailwind 阶；`calc()`/`var()` 例外，字号任意值归 `bare-text-size`（测试文件豁免）。数值无法落进 token 阶梯又确属某功能专有（如某区限高）时，正当出口是在 `index.css` 里加一条**功能语义类**（如 `.todo-project-group-body { max-height: 45vh; }`）交组件消费——不是在组件里留裸任意值，也不是进 allowlist。转盘 / 弹层 / 图表框 / 星图画布等专有几何集中在 `index.css` 的「功能几何语义类」块。**该块统一放 `@layer components`**：顶层裸规则会压过 Tailwind utilities，调用方就盖不住默认值了（如 `TagFilterPanel` 用 `max-h-28` 覆盖默认限高、速记日期气泡用 `sm:top-20` 覆盖吸顶位）。

`scripts/design-language-allowlist.json` 是显式例外登记簿，每项写明 `file`、`rule`、`lineText`、`reason`、`ownerBatch`、`removeBy`。脚本按 `file + rule + lineText` 精确匹配并报告 stale 条目；新增代码不得通过 allowlist 绕过棘轮。当前长期例外是 `categoryColors.ts` 的用户内容分类预设色，属于业务数据而非 UI chrome，其余设计语言规则均直接拦截违规。

## 4. 关键不变量 / 坑 / 红线

1. **新 UI 一律用 token，不写裸 hex/rgba**；统计、设置、Todo、Entry、Track、Goal 等页面的 UI chrome 都消费语义颜色、圆角、排版和几何类；用户内容分类预设色是业务数据例外。裸任意尺寸/间距、裸字号、裸圆角均由 §3 棘轮直接拦截。
2. **图表不维护独立 data palette**：图表序列走用户分类色；用户内容色只代表分类、项目、标签、用户自定义标记。Track agent tone 只表达该调度信号。
3. **无原生表单控件**：`<select>`/`type=checkbox`/`type=radio`/`window.confirm`/`window.alert` 一律用自绘控件——**CI 棘轮 `check:ui` 强制**（见 [design-language/controls](design-language/controls.md)）。
4. **图标统一 Phosphor**，经 `components/Icon.tsx` 包装（见子文档）；不用 emoji 或文字字符伪装图标。
5. **recharts 不解析 CSS `var()`**：图表 chrome（axis/grid/tooltip 背景边框文字/legend/cursor）须把中性 token 镜像成 JS 常量，统一出自 `pages/stats/chartColors.ts`（只导出 `CHART_CHROME`），唯一消费方是 TimeStats 的 `InsightCharts`（健康图表随健康子系统退役，见 [ADR 0024](../adr/0024-retire-health-subsystem.md)）；该文件在 `check:design` 整文件豁免 `bare-raw-color`（见 §3），对应的中性颜色事实源是 `index.css` token。数据序列不由本文件取色，走用户分类色（`item.color`，无色回退 `UNCATEGORIZED_COLOR`，见 [stats-insights](stats-insights.md) §1.2）；状态色只留给真状态，不上数据序列。
6. **横向溢出从组件源头收口**：全站 `<main>` 负责纵向滚动，交互组件若会产生临时横向位移（如 Todo 拖拽 / swipe 行），应在组件行容器或本主题全局规则里裁掉横向溢出，避免把页面撑出横向滚动面；纵向拖拽让位可单独放开。**推论：swipe 行内的装饰必须画在内侧**——`ring-*` 与任何向外画的 `box-shadow` 会被祖先 `.swipeable-list-item { overflow:hidden }` 整圈裁掉，真机不可见，而 jsdom / happy-dom 不算裁剪，只断言 className 的单测照样全绿（"已归目标任务绿外圈"就这么 ship 成过隐形功能）。用绝对定位子元素（`pointer-events-none`，避开圆角与拖拽命中区）或 `ring-inset`，并靠真机 / 截图验收——单测在这件事上给不出结论。
7. **主导航：移动纯图标 / 桌面图标+文字**：移动底栏主导航用 Phosphor 纯图标（仅 `aria-label`），只渲染 `nav.visibleTabs.v1` 选中的入口并固定保留设置，不提供三点菜单；未选入口由设置的“更多功能”子页承接。桌面侧栏主导航图标下方配 `td-text-caption` 文字标签（aside `w-20`，"更多"按钮同款），这是设计审查 C1 的可读性收口——**仅桌面，移动底栏维持纯图标不变**。图标来自 `navRegistry`，用户配置只保存 route/placement，不保存 icon 名或颜色；主导航按钮必须有 `aria-label`。active 用 `accent-soft` 背景、`accent` 图标色和 `accent` ring，hover/focus 只消费现有 `page/surface/border/ink/accent` token，不为主导航单独引入裸色。轨道回手计数以 `NavBadge`（`bg-accent`/`text-page` 圆点，`td-text-caption`，>9 显「9+」）叠在 `/tracks` 图标右上角，计数为 0 时不渲染；两端复用同一 `NavBadge`，不引裸色。
8. **设置壳与设置行复用 token 组件**：设置详情页外壳 `SettingsDetailPage` 使用 `page/surface/border/ink` token；设置首页的 `SettingsSection` / `SettingsRow` / `SettingsToggleRow` / `SettingsNumberRow` 使用 `surface/border/ink/accent` 语义 tone，避免各设置入口重新引入旧 `slate-*` / 模块色 / 大圆角样式。`SettingsNumberRow` 的 `−`/`+` 按钮和 `input[type=number]` 消费 `surface-hover`/`border`/`ink`/`accent` token，不引入裸色。
9. **z-index 走层级 token**：跨局部内容的下拉 / 日期气泡、遮罩、弹层与全屏接管用 `z-[var(--z-*)]`，内联 `style.zIndex` 用 `lib/zLayers.ts` 的 `Z`；普通粘顶头、画布 HUD/notice 等局部 stacking 使用 `z-10`/`z-20`，不升全局 token。新全局浮层选层级按语义对号入座，不另造数值。
10. **单一暗色主题 + 单一动作色**：不搭换肤机制、不引 `[data-theme]`、不出亮色主题；动作色只有品牌蓝一支。motion 走标准 utility/局部 keyframe 值，z-index 与任意值按各自语义治理并由棘轮守。视觉一致性靠单测 + `/dev/styleguide` 预览页人工验收，**不做像素快照**。

## 5. 模块速查

| 关注点 | 入口 |
|---|---|
| 全部颜色/圆角/边框/阴影/字体 token + 全局样式 | `packages/client/src/index.css`（Tailwind v4 `@theme static`） |
| 设计语言棘轮 + 旧债 allowlist | `scripts/check-design-language.mjs`、`scripts/design-language-allowlist.json` |
| 主导航图标映射与纯图标壳 | `packages/client/src/lib/navigation/navRegistry.ts`、`components/app-shell/{MobileBottomNav,DesktopSidebar}.tsx`；移动底栏无三点菜单，未选入口在 `/settings/more` 显示，桌面侧栏仍可配置更多收纳 |
| 设置详情页外壳与设置首页行组件 | `packages/client/src/pages/settings/SettingsDetailPage.tsx`、`packages/client/src/pages/settings/components/SettingsRows.tsx` |
| 字体引入（GB 屏显子集 + Tinos） | `packages/client/src/main.tsx`（covers 归 [architecture](architecture.md)）；守序测试 `fontLoading.test.ts` |
| 自绘控件 / 无原生控件棘轮 / 图标 | → [design-language/controls](design-language/controls.md) |
| 图表 chrome 取色（token→JS 常量镜像） | `packages/client/src/pages/stats/chartColors.ts`（只有 `CHART_CHROME`；数据序列走用户分类色，见 §4 第 5 条；守序测试 `chartColors.test.ts`） |
| z-index 层级 JS 镜像 | `packages/client/src/lib/zLayers.ts`（`Z`，与 `--z-*` 同步，`zLayers.test.ts` 守一致） |
| 设计语言预览 / 验收台 | `packages/client/src/pages/dev/StyleguidePage.tsx`（路由 `/dev/styleguide`，渲染全部 token + `.td-*` + 自绘控件） |

## 子文档索引

| 子文档 | 拥有什么 |
|---|---|
| [design-language/controls](design-language/controls.md) | 自绘控件库 `components/ui/**`、Phosphor 图标包装 `Icon.tsx`、确认弹层 `useConfirm`、CI 棘轮 `check-no-native-controls.mjs`（`check:ui`） |

## 深水细节

- **App 启动图标是另一条管线**：`scripts/generate-icons.mjs` 用 sharp 从根 `icon.png` 生成 PWA/Android/favicon 全套（与 UI 内 Phosphor 图标无关），属构建/资产，不在本主题 covers。
- **单文件 CSS**：全站样式集中在 `index.css`（含 token + 全局规则 + 部分组件类）。它被多功能触及，但主轴身份是“设计系统/全局样式”，故归本主题单一 covers；功能主题改样式时在「邻居」链回本文，不另 cover `index.css`。
