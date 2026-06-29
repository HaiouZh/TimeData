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
  - scripts/check-design-language.mjs
  - scripts/design-language-allowlist.json
last-reviewed: 2026-06-29
---

# 设计语言

> 设计语言**主题文档**（非数据域，按“设计风格”轴成主题）：深冷工具基调的暗色视觉系统——语义颜色 token + 书卷体字体 + Phosphor 图标 + 自绘控件。
> 讲什么：语义颜色治理、圆角/边框/阴影阶梯、字体栈与排版角色、设计语言棘轮、全站视觉红线。
> 不讲什么：自绘控件库与无原生控件棘轮（见子文档 [design-language/controls](design-language/controls.md)）、各功能页如何用这些 token（见各功能主题）。

## 承上启下

- **上游**：无（这是最底层的视觉/交互基座）。token 与全局样式集中在单一文件 `index.css`（Tailwind v4 `@theme static`）。
- **下游**：所有功能主题（[timeline](timeline.md)/[todo](todo.md)/[quick-notes](quick-notes.md)/[health](health.md)/[stats-insights](stats-insights.md)/[categories-settings](categories-settings.md)）的页面与组件都消费这些 token 和控件；它们只在「邻居」链接到本主题，不重复 token 定义。
- **契约**：颜色/圆角/字体 token 与排版角色见本文 §1–§2（源在 `index.css`）；设计语言棘轮见 §3；自绘控件契约见 [design-language/controls](design-language/controls.md)；图表取色见 [health/charts](health/charts.md)（recharts 镜像 token）。
- **邻居**：[design-language/controls](design-language/controls.md)（同主题子文档）、全部功能主题（消费方）。

## 1. 语义颜色 token 体系（`index.css` `@theme static`）

设计按语义层治理颜色，不按模块分配品牌色：

| 层 | token / 来源 | 用途与红线 |
|---|---|---|
| **中性底盘** | `--color-page` `--color-surface` `--color-surface-elevated` `--color-surface-hover`；文字 `--color-ink` `--color-ink-2` `--color-ink-3` | 暗色底盘 + 三级文字（均 ≥ WCAG AA）。绝大多数 UI chrome 只用这一层 |
| **单一动作色** | `--color-accent` `--color-accent-strong` `--color-accent-soft` `--color-accent-ink`（蓝） | 全站唯一动作色。按钮/聚焦/主操作/active 只用蓝，不引入第二动作色 |
| **状态色** | `--color-ok` `--color-warn` `--color-danger` + `*-soft` | 只表达成功/警告/危险/错误/冲突，不做装饰色 |
| **数据色板** | `--color-data-blue/teal/green/amber/red/purple`（固定 6 色） | 仅图表、健康指标曲线、数据序列使用，不外溢到 UI chrome |
| **用户内容色** | 分类色、标签色、用户自定义标记 | 属业务数据，不属于 UI chrome；使用时要能说明来自用户内容 |
| **scoped 特殊场景色** | 例如 `--galaxy-*` | 只服务独立画布/世界观场景，必须有独立 prefix，不扩展全站动作色 |

- **模块署名色已退役**：`--color-mod-*`、`text-mod-*`、`bg-mod-*`、`border-mod-*` 不再作为设计语言的一部分。模块身份靠固定位置、图标、页面标题、信息架构和 active 形态，不靠每个模块一套品牌色。
- **Goal 星图局部命名空间**：`--galaxy-edge` / `--galaxy-edge-glow` / `--galaxy-star-core` 只允许 `pages/goals/**` 的星图边、星核和光晕使用；它们不扩展全站动作色，也不替代 `--color-accent`。星图节点的状态光晕（ready/blocked/completed/parked/active/anchor）通过 `--shadow-galaxy-*` scoped shadow token 消费（如 `--shadow-galaxy-ready`、`--shadow-galaxy-blocked` 等），组件用 `shadow-[var(--shadow-galaxy-*)]`，不写裸 rgba。
- **预留 `--health-*` 命名空间（scoped，暂无色值）**：健康指标的「条件着色 / 分级指示色」（好 / 警告 / 差，或睡眠阶段、心率区间等分类）落地时走 scoped `--health-*` 色板，与 `--color-data-*`（序列区分）、`--galaxy-*`（场景专属）同类。规矩：独立前缀、语义命名（`--health-good` 而非 `--health-1`）、集中定义于 `index.css`、只服务健康可视化、不外溢按钮 / 页面壳。它表达「数据好不好 / 是哪类」（合法），不是「模块身份」（禁止，已随 module color 退役）。**当前只写下这条契约，不定义实际色值**——现有健康曲线是「序列区分」，用 `--color-data-*` 已够；色值等跑步表格 / 分级指示功能落地时随功能设计、由用户拍板。
- **圆角阶梯**：`--radius-ctl`(8) / `--radius-row`(12) / `--radius-card`(16) / `--radius-pill`(999)。
- **边框**：`--color-border` / `--color-border-strong` / `--color-border-hairline`(rgba 8%)。
- **阴影**：`--shadow-elev1`（小表面）/ `--shadow-elev2`（浮层），仅大表面用。
- **派生软色**用 `color-mix(in srgb, <token> N%, transparent)` 或已有 soft token，不另写裸色。

新增颜色流程：

1. 先判断现有层级是否足够：背景/文字用中性，操作用动作蓝，状态用状态色，图表用数据色，用户内容用业务色。
2. 如果不够，写清新颜色表达的语义，不能以“页面更有特色”为理由。
3. 限定作用域：全站 token、数据色板、用户内容色，还是 scoped 特殊场景色。
4. 同步 evergreen 文档、`check:design` 规则 / allowlist、必要测试和人工验收条目。
5. 新增颜色层级或 scoped palette 必须用户拍板。

## 2. 字体与排版角色（书卷体）

- `--font-body: "Times New Roman", "Tinos", "LXGW WenKai Screen", "KaiTi", "STKaiti", serif`——**西文在前、中文在后，逐字回退**：西文走 Times/Tinos，汉字落霞鹭文楷。
- `--font-mono`（JetBrains Mono…）只用于 `code/pre/kbd/samp`、日志、ID、debug、技术标识。
- 字体在 `main.tsx` 引入：**只引霞鹭文楷 GB 屏显子集** `lxgw-wenkai-screen-webfont/lxgwwenkaigbscreen.css`（约 4.7MB，避免 R 变体与重复字族撑大 APK）+ `@fontsource/tinos` 的 400/400-italic/700。`fontLoading.test.ts` 守 import 顺序（lxgw 在 tinos 之前）。
- 全站 `body` 用 `--font-body`；远程加载推迟到做字体设置时再上。
- 新 UI 优先使用语义排版类：`td-text-caption`、`td-text-label`、`td-text-body`、`td-text-title`、`td-text-display`。
- 数字/时间/时长/统计值使用 `td-num`、`td-time`、`td-duration`、`td-stat`、`td-metric`，当前仍指向 `--font-body`，并启用 `font-variant-numeric: tabular-nums`。数字默认不使用等宽字体；未来若切换数字字体，只改这些语义角色。

## 3. 设计语言棘轮

`pnpm check:design` 扫描 `packages/client/src`，由 `scripts/check-design-language.mjs` 执行。它不是审美检查，而是防回退闸：

- 禁止退役模块色：`--color-mod-*`、`text-mod-*`、`bg-mod-*`、`border-mod-*` 等。
- 禁止新增 UI chrome 裸 `slate-*`，主操作裸 `blue-*` / `sky-*`，状态裸 `emerald-*` / `green-*` / `amber-*` / `yellow-*` / `orange-*` / `red-*` / `rose-*` / `gray-*`；覆盖 `bg/text/border/ring/fill/stroke/outline/caret/accent/shadow/decoration` 等常见 Tailwind 色彩工具。
- 禁止 UI chrome 新增裸 hex / rgb / rgba / hsl / oklch / lab；测试 fixture、用户内容色、图表色和 scoped 特殊场景由脚本/allowlist 显式区分。
- **token 定义与图表镜像不算「裸色」**：`index.css` 里 `--color-*` / `--galaxy-*` / `--shadow-*` 的 token 定义本身（值含 hex/rgba）是颜色的唯一事实源，脚本直接跳过；图表色镜像文件 `pages/stats/health/chartColors.ts`（recharts 不解析 `var()`，故把 token 镜像成 JS 常量）也整文件跳过 `bare-raw-color`。镜像文件登记在脚本的 `CHART_COLOR_MIRROR_FILES`，新增镜像文件需登记，不要用长期 allowlist 维持图表裸 hex。
- 禁止交互控件用文字字符或 emoji 伪装图标。
- 禁止业务时间/数字/统计值直接用 `font-mono`；代码、日志、ID、debug 标识应优先放在 `code/pre/kbd/samp` 或专用技术文本组件中，确有遗留例外必须进 allowlist。

`scripts/design-language-allowlist.json` 是旧债登记簿，每项必须写清 `file`、`rule`、`lineText`、`reason`、`ownerBatch`、`removeBy`。脚本按 `file + rule + lineText` 精确豁免，并按条目计数消费；同一旧债行被复制新增时必须新增一条 allowlist，否则会报违规。脚本也会报告 stale allowlist 项。P1–P4 全量收口完成后，所有 `P[1-4]-*` 临时 owner batch 已归零；剩余 allowlist 仅 54 项 `user-content-color` 长期例外（`categoryColors.ts` 42 项分类预设色 + `turnTags.ts` 12 项标签 hash 色板），属业务数据非 UI chrome。后续主干页面新增裸色 / 散装图标 / 业务 `font-mono` 会直接失败。不得把本轮新代码违规加入 allowlist。

## 4. 关键不变量 / 坑 / 红线

1. **新 UI 一律用 token，不写裸 hex/rgba**；统计 / 健康面（TimeStats、HealthStats、stats 模块、图表 chrome、旧健康 CSS）已在 P3 收口，设置子页、共享边角组件、Todo/Entry 边角、Goal galaxy shadow 已在 P4 收口；`P[1-4]-*` allowlist 全部归零，剩余仅 `user-content-color` 长期例外（分类预设色 + 标签 hash 色板），勿当范式。
2. **数据色不外溢 UI chrome**（只在图表/健康可视化里）；用户内容色只代表分类、标签、用户自定义标记。
3. **无原生表单控件**：`<select>`/`type=checkbox`/`type=radio`/`window.confirm`/`window.alert` 一律用自绘控件——**CI 棘轮 `check:ui` 强制**（见 [design-language/controls](design-language/controls.md)）。
4. **图标统一 Phosphor**，经 `components/Icon.tsx` 包装（见子文档）；不用 emoji 或文字字符伪装图标。
5. **recharts 不解析 CSS `var()`**：图表配色（数据色 + chrome 的 axis/grid/tooltip 背景边框文字/cursor）须把 token 镜像成 JS 常量，统一出自 `pages/stats/health/chartColors.ts`（`DATA_PALETTE` + `CHART_CHROME`），TimeStats 的 `InsightCharts` 与 Health 图表都消费它；该文件在 `check:design` 整文件豁免 `bare-raw-color`（见 §3），唯一事实源仍是 `index.css` token。详见 [health/charts](health/charts.md)。
6. **横向溢出从组件源头收口**：全站 `<main>` 负责纵向滚动，交互组件若会产生临时横向位移（如 Todo 拖拽 / swipe 行），应在组件行容器或本主题全局规则里裁掉横向溢出，避免把页面撑出横向滚动面；纵向拖拽让位可单独放开。
7. **主导航纯图标**：移动底栏与桌面侧栏的主导航使用 Phosphor 纯图标；图标来自 `navRegistry`，用户配置只保存 route/placement，不保存 icon 名或颜色。主导航按钮必须有 `aria-label`，设置页配置界面和更多菜单可显示图标 + 文字。active 用 `accent-soft` 背景、`accent` 图标色和 `accent` ring，hover/focus 只消费现有 `page/surface/border/ink/accent` token，不为主导航单独引入裸色。
8. **设置壳与设置行复用 token 组件**：设置详情页外壳 `SettingsDetailPage` 使用 `page/surface/border/ink` token；设置首页的 `SettingsSection` / `SettingsRow` / `SettingsToggleRow` / `SettingsNumberRow` 使用 `surface/border/ink/accent` 语义 tone，避免各设置入口重新引入旧 `slate-*` / 模块色 / 大圆角样式。`SettingsNumberRow` 的 `−`/`+` 按钮和 `input[type=number]` 消费 `surface-hover`/`border`/`ink`/`accent` token，不引入裸色。

## 5. 模块速查

| 关注点 | 入口 |
|---|---|
| 全部颜色/圆角/边框/阴影/字体 token + 全局样式 | `packages/client/src/index.css`（Tailwind v4 `@theme static`） |
| 设计语言棘轮 + 旧债 allowlist | `scripts/check-design-language.mjs`、`scripts/design-language-allowlist.json` |
| 主导航图标映射与纯图标壳 | `packages/client/src/lib/navigation/navRegistry.ts`、`components/app-shell/{MobileBottomNav,DesktopSidebar}.tsx`；移动底栏的更多菜单是底栏附属层，底栏隐藏时同步收起，不作为独立悬浮菜单保留 |
| 设置详情页外壳与设置首页行组件 | `packages/client/src/pages/settings/SettingsDetailPage.tsx`、`packages/client/src/pages/settings/components/SettingsRows.tsx` |
| 字体引入（GB 屏显子集 + Tinos） | `packages/client/src/main.tsx`（covers 归 [architecture](architecture.md)）；守序测试 `fontLoading.test.ts` |
| 自绘控件 / 无原生控件棘轮 / 图标 | → [design-language/controls](design-language/controls.md) |
| 图表取色（token→JS 常量镜像） | [health/charts](health/charts.md) 的 `chartColors.ts` |

## 子文档索引

| 子文档 | 拥有什么 |
|---|---|
| [design-language/controls](design-language/controls.md) | 自绘控件库 `components/ui/**`、Phosphor 图标包装 `Icon.tsx`、确认弹层 `useConfirm`、CI 棘轮 `check-no-native-controls.mjs`（`check:ui`） |

## 深水细节

- **App 启动图标是另一条管线**：`scripts/generate-icons.mjs` 用 sharp 从根 `icon.png` 生成 PWA/Android/favicon 全套（与 UI 内 Phosphor 图标无关），属构建/资产，不在本主题 covers。
- **单文件 CSS**：全站样式集中在 `index.css`（含 token + 全局规则 + 部分组件类）。它被多功能触及，但主轴身份是“设计系统/全局样式”，故归本主题单一 covers；功能主题改样式时在「邻居」链回本文，不另 cover `index.css`。
