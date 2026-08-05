---
type: evergreen
title: 设计语言
covers:
  - packages/client/src/index.css
  - packages/client/src/lib/navigation/navRegistry.ts
  - packages/client/src/lib/navigation/routeFavicon.ts
  - packages/client/src/components/app-shell/DesktopSidebar.tsx
  - packages/client/src/components/app-shell/MobileBottomNav.tsx
  - packages/client/src/pages/settings/SettingsDetailPage.tsx
  - packages/client/src/pages/settings/components/SettingsRows.tsx
  - packages/client/src/lib/zLayers.ts
  - packages/client/src/pages/dev/StyleguidePage.tsx
  - packages/client/src/pages/stats/chartColors.ts
  - packages/client/src/lib/contentTint.ts
  - packages/client/src/hooks/useKeyboardHeight.ts
  - packages/client/src/lib/bottomInset.ts
  - packages/client/src/App.tsx
  - packages/client/src/contexts/BottomNavContext.tsx
  - packages/client/src/lib/haptics.ts
  - packages/client/src/lib/messages.ts
  - scripts/check-design-language.mjs
  - scripts/design-language-allowlist.json
contracts:
  - packages/client/src/index.css
  - scripts/check-design-language.mjs
  - scripts/design-language-allowlist.json
  - packages/client/src/lib/navigation/navRegistry.ts
last-reviewed: 2026-08-05
---

# 设计语言

> 设计语言**主题文档**（非数据域，按“设计风格”轴成主题）：深冷工具基调的暗色视觉系统——语义颜色 token + 书卷体字体 + Phosphor 图标 + 自绘控件。
> 讲什么：语义颜色治理、圆角/边框/阴影阶梯、字体栈与排版角色、安全区让位、设计语言棘轮、全站视觉红线。
> 不讲什么：自绘控件库与无原生控件棘轮（见子文档 [design-language/controls](design-language/controls.md)）、各功能页如何用这些 token（见各功能主题）。

## 承上启下

- **上游**：无（这是最底层的视觉/交互基座）。token 与全局样式集中在单一文件 `index.css`（Tailwind v4 `@theme static`）。
- **下游**：所有功能主题（[timeline](timeline.md)/[todo](todo.md)/[quick-notes](quick-notes.md)/[stats-insights](stats-insights.md)/[categories-settings](categories-settings.md)）的页面与组件都消费这些 token 和控件；它们只在「邻居」链接到本主题，不重复 token 定义。
- **契约**：颜色/圆角/字体 token 与排版角色见本文 §1–§2（源在 `index.css`）；设计语言棘轮见 §3；自绘控件契约见 [design-language/controls](design-language/controls.md)；图表取色（recharts 镜像 token，`pages/stats/chartColors.ts`）见本文 §4 第 5 条。
- **邻居**：[design-language/controls](design-language/controls.md)（同主题子文档）、全部功能主题（消费方）。

<a id="design-language-s1"></a>

## 1. 语义颜色 token 体系（`index.css` `@theme static`）

设计按语义层治理颜色，不按模块分配品牌色：

| 层 | token / 来源 | 用途与红线 |
|---|---|---|
| **中性底盘** | `--color-page` `--color-surface` `--color-surface-elevated` `--color-surface-hover` `--color-backdrop`；文字 `--color-ink` `--color-ink-2` `--color-ink-3` | 暗色底盘 + 三级文字（均 ≥ WCAG AA）。绝大多数 UI chrome 只用这一层；`--color-backdrop` 是全局弹层遮罩（深黑，用 `bg-backdrop/50` 或 `/60` 派生透明度档） |
| **单一动作色** | `--color-accent` `--color-accent-strong` `--color-accent-soft` `--color-accent-ink` `--color-accent-contrast`（蓝） | 全站唯一动作色。按钮/聚焦/主操作/active 只用蓝，不引入第二动作色；`--color-accent-contrast` 是 accent 实心面上的反白文字 |
| **状态色** | `--color-ok` `--color-warn` `--color-danger` | 只表达成功/警告/危险/错误/冲突；柔和状态面由主色 alpha 派生（背景 `/10`、hover `/15`），不维护 soft 别名 |
| **用户内容色** | `--color-tint-1..9`（固定 9 支，项目 / 标签共用）+ 分类色 | 属业务数据，不属于 UI chrome；使用时要能说明来自用户内容 |
| **Track scoped 信号色** | `--color-track-agent` | 只表达 Track 调度台“agent 在跑”，不充当动作色、状态色或模块署名色 |
| **scoped 特殊场景色** | 例如 `--galaxy-*` | 只服务独立画布/世界观场景，必须有独立 prefix，不扩展全站动作色 |

- **模块署名色已退役**：`--color-mod-*`、`text-mod-*`、`bg-mod-*`、`border-mod-*` 不再作为设计语言的一部分。模块身份靠固定位置、图标、页面标题、信息架构和 active 形态，不靠每个模块一套品牌色。
- **Goal 星图局部命名空间**：`--galaxy-edge` / `--galaxy-edge-glow` / `--galaxy-star-core` 只允许 `pages/goals/**` 的星图边、星核和光晕使用；它们不扩展全站动作色，也不替代 `--color-accent`。星图节点的状态光晕（ready/blocked/completed/parked/active/anchor）通过 `--shadow-galaxy-*` scoped shadow token 消费（如 `--shadow-galaxy-ready`、`--shadow-galaxy-blocked` 等），组件用 `shadow-[var(--shadow-galaxy-*)]`，不写裸 rgba。
- **圆角阶梯**：`--radius-ctl`(8) / `--radius-row`(12) / `--radius-card`(16) / `--radius-pill`(999)，分别表达控件、列表行、面板卡片与圆形/胶囊；`rounded` / `rounded-sm` 只服务发丝级或小型原子细节。生产组件不使用 Tailwind `md/lg/xl/2xl/3xl/full` 原生圆角词汇（棘轮 `bare-card-radius`，见 §3）。
- **边框**：`--color-border` / `--color-border-strong` / `--color-border-hairline`(rgba 8%)。
- **黑白命名色已 token 化**：Tailwind `white`/`black` 命名色不直接进 UI chrome（棘轮 `bare-black-white`，见 §3）。弹层遮罩用 `bg-backdrop/*`（`--color-backdrop`），accent 实心面上的反白文字用 `text-accent-contrast`；用户内容色需要黑白表达时显式走业务数据路径。
- **滚动条**：`--color-scrollbar-thumb` / `--color-scrollbar-thumb-hover`（滑块常态 / 悬停提亮，色值同边框灰蓝档但语义独立）。`html` 上 `scrollbar-width: thin` + `scrollbar-color` 全站继承，轨道透明；hover 提亮走零特异性 `:where(:hover)`，局部隐藏特例（如转盘 `.wheel-scroll`）可直接压过。**只用标准属性，不用 `::-webkit-scrollbar` 伪元素**——后者会让 Chrome/Edge 从 overlay 条退化成常驻占位条（`indexCssTokens.test.ts` 有计数闸守着，全站仅转盘的 display:none 隐藏一处豁免）。
- **阴影**：`--shadow-elev1`（小表面）/ `--shadow-elev2`（浮层），仅大表面用；两者均叠了顶部 `inset 0 1px 0` hairline 高光，暗色下给大表面一道微亮上沿。
- **动效**：普通过渡使用 Tailwind `duration-150/200/300`、`duration-0` 与 `ease-out`；sheet `150/200ms ease-out`、Todo occurrence `300ms cubic-bezier(0.2, 0, 0, 1)` 等 keyframe 在 `index.css` 邻近声明具体值。长循环动画保留自身值；所有动画尊重 `prefers-reduced-motion`。
- **z-index 层级**：`--z-dropdown`(30) / `--z-backdrop`(40) / `--z-modal`(50) / `--z-top`(70)，只治理**全局浮层**；普通 sticky header、画布 HUD 与 notice 属局部 stacking，使用 `z-10`/`z-20`。CSS 是单一事实源，内联 `style.zIndex` 走 JS 镜像 `lib/zLayers.ts` 的 `Z`（类比图表色镜像），`zLayers.test.ts` 守 JS 与 CSS 阶梯一致。
- **安全区语义类**：安全区值统一由 `:root` 的 `--safe-*` 变量供给（`--safe-top/right/bottom/left`，默认 `env(safe-area-inset-*)`；`html[data-platform="android"]` 时清零——Android 壳由 MainActivity 在原生层做唯一让位，WebView 里 `env()` 照常报非零值、会与原生 inset padding 叠成双倍留白，见 [deployment/android-apk](deployment/android-apk.md#deployment-android-apk-s2)）。`.td-safe-top`（`padding-top: var(--safe-top)`）、`.td-safe-x`（左右）、`.td-safe-bottom`（底部）定义在 `index.css` 的 `@layer components`（同 §3「功能几何语义类」的理由：顶层规则会压过 Tailwind utilities，调用方盖不住）。生效前置是 `index.html` 的 viewport meta 带 `viewport-fit=cover`；桌面浏览器 `env()` 恒为 0，挂上即零变化。挂点必须是**非滚动根容器**——padding 区域由容器自身底色绘制，内容不会钻进刘海/圆角底下。当前消费方只有 AppShell 根 div（`td-safe-top td-safe-x`）；`.td-safe-bottom` 尚无消费方，底部让位由各实际占位者自己做（分工见 §4 第 11 条）。
- **用户内容身份色**：`--color-tint-1..9`。约束是 WCAG 对比度（圆点 ≥3:1、caption 档 `#` 与填充态深字 ≥4.5:1），色相尽量避开 accent / ok / warn / danger 四个已占用值；支数定在 9 是因为四禁区吃掉 160° 色相环后，再多就有相邻支在 6px 圆点上分不出（取舍见 [ADR 0026](../adr/0026-content-tint-shared-palette-shape-distinguishes-type.md)）。取色内核 `lib/contentTint.ts` 两条路都不存储：**标签** `contentTint(标签名)` 哈希取模、允许撞色；**项目** `assignProjectTints(按 createdAt 升序的 goalId)` 集合内避撞——首选位由哈希决定（色因此散布在整个色板上，不是从 `tint-1` 依次发号），被占才顺移，≤9 个项目保证互不同色。项目分配由 `listTasks` 基于**全部 active project** 算出、随 `TodoBuckets.projectTints` 下发，组件不自行取色。**类型区分靠形状不靠颜色**：圆点 = 项目，`#` = 标签——同一行 meta 区两者并排时，颜色只表达「是哪一个」，形状表达「是哪一类」，故两者共用一组色板、偶尔撞色不构成歧义。真实形态（6px 圆点 / caption 档 `#` / 筛选面板填充态）在 `/dev/styleguide` 的「身份色的真实形态」一节验收——色值与支数都由这一节定，色块预览不作为验收依据。因由见 [ADR 0026](../adr/0026-content-tint-shared-palette-shape-distinguishes-type.md)。
- **token 分账**：`core 33 / business identity 10 / Goal scoped 12 = 55`（另加字体 2 支 `--font-*` 归 §2 单独治理）；business identity 是 tint 9 支与 Track agent 1 支。按 owner 与生产消费审计，不为 `<50` 合并跨域职责（见 [ADR 0027](../adr/0027-retire-unused-data-palette-and-scope-track-agent-tone.md)）。
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
- 排版**只用**语义排版类：`td-text-caption`、`td-text-label`、`td-text-body`、`td-text-title`、`td-text-display`。`bare-text-size` 是硬闸：新写 `text-xs/sm/base/...` 或 `text-[13px]` 一律直接失败，不得加 allowlist。**图标按钮上的字号声明不生效**（内容是 SVG）；**`input`/`textarea`/`select` 上的字号声明则相反——它会盖掉顶层那条 iOS 防缩放兜底**（`.td-text-*` 是类选择器，特异性高过元素选择器 `input,select,textarea{font-size:16px}`），聚焦放大随之回归。两种情况的正确处置都是删掉字号而非迁语义类（见 [controls](design-language/controls.md#design-language-controls-s1)）；输入控件那条由 `input-font-size-override` 硬闸守着。语义档与字号映射：caption≈12px、label≈13px、body≈15px、title≈20px(600)、display≈28px(600)。
- **`.td-text-*` 定义在 `index.css` 顶层未分层区，会压过 `@layer utilities` 里的所有 Tailwind 排版 utility**：同一行上的 `leading-*`、`tracking-*` 一律不生效，`font-*` 只对 caption/label/body 生效（这三档不定义 `font-weight`），对 title/display 不生效（两档自带 600）。要偏离档位内建值时不要靠 utility 叠加，而是加一条**排版角色语义类**——如卡片眉标 `.td-eyebrow`（12px + 500 + 大写 + `letter-spacing: 0.16em`），放 `@layer components`——注意这类语义类是 `td-text-*` 的**替代品而非叠加物**（它自带 `font-size`/`line-height`，与 `td-text-*` 同用又会被顶层规则压回去）。`leading-*` 这一面由 §3 的 `dead-leading-on-td-text` 棘轮守着。
- 数字/时间/时长使用 `td-num`、`td-time`、`td-duration`，三者指向 `--font-body` 并启用 `font-variant-numeric: tabular-nums`；统计卡数值使用 `td-num`。数字默认不使用等宽字体。

<a id="design-language-s3"></a>

## 3. 设计语言棘轮

`pnpm check:design` 扫描 `packages/client/src`，由 `scripts/check-design-language.mjs` 执行。它不是审美检查，而是防回退闸：

- 禁止退役模块色：`--color-mod-*`、`text-mod-*`、`bg-mod-*`、`border-mod-*` 等。
- 禁止退役 data palette：`--color-data-*` 及其 Tailwind utility；图表序列走分类色，Track agent 信号走 `track-agent`。
- 禁止退役 motion token 与独立 soft 状态色别名；motion 使用 Tailwind 标准档或 keyframe 邻近值，状态柔面使用主状态色 alpha。
- 禁止新增 UI chrome 裸 `slate-*`，主操作裸 `blue-*` / `sky-*`，状态裸 `emerald-*` / `green-*` / `amber-*` / `yellow-*` / `orange-*` / `red-*` / `rose-*` / `gray-*`；覆盖 `bg/text/border/ring/fill/stroke/outline/caret/accent/shadow/decoration` 等常见 Tailwind 色彩工具。
- 禁止 UI chrome 新增裸 hex / rgb / rgba / hsl / oklch / lab；测试 fixture、用户内容色、图表色和 scoped 特殊场景由脚本/allowlist 显式区分。
- 禁止 UI chrome 用裸 `white`/`black` 命名色（`bg-black/50`、`text-white`、`bg-[white]`、`border-t-white` 等）：规则 `bare-black-white`，遮罩用 `bg-backdrop/*`，accent 反白字用 `text-accent-contrast`（测试文件豁免）。
- **token 定义与图表镜像不算「裸色」**：`index.css` 里 `--color-*` / `--galaxy-*` / `--shadow-*` 的 token 定义本身（值含 hex/rgba）是颜色的唯一事实源，脚本直接跳过；token 镜像文件（`pages/stats/chartColors.ts` 图表 chrome、`lib/navigation/routeFavicon.ts` favicon SVG data-URI——recharts / SVG data-URI 不解析 `var()`，故把 token 镜像成 JS 常量）整文件跳过 `bare-raw-color`。镜像文件登记在脚本的 `TOKEN_MIRROR_FILES`，新增镜像文件需登记；长期 allowlist 不是维持图表裸 hex 的手段。
- 禁止交互控件用文字字符或 emoji 伪装图标。**`interactive-text-icon` 规则只是辅助，有两个已知洞**：①字符集是一份固定白名单（`x × ✕ ✓ ✔ › ‹ ← → ↑ ↓ ⋯ …` 与对应实体），白名单外的符号一律放行——`▢` / `⤢`（`TaskDetailSheet` 放大还原钮）与 `−`（U+2212 减号，`SettingsNumberRow` 步进钮，注意它不是 ASCII `-`）都在洞里；②正则只匹配**单行**的 `>符号<` 或 `{"符号"}`，符号独占一行时 `>` 与 `<` 不同行，匹配不到。所以**闸绿不等于合规**，这条红线主要靠写的时候自觉，不靠脚本兜。
- 禁止业务时间/数字/统计值直接用 `font-mono`；代码、日志、ID、debug 标识应优先放在 `code/pre/kbd/samp` 或专用技术文本组件中，确有遗留例外必须进 allowlist。
- 禁止原生圆角 `rounded-md/lg/xl/2xl/3xl/full` 及其方向变体、以及 `rounded-[…px|rem]` 任意值：规则 `bare-card-radius`，生产代码使用 `rounded-ctl/row/card/pill`，仅发丝级/小型原子细节保留 `rounded/rounded-sm`（测试文件豁免）。
- 禁止裸字号 `text-{xs,sm,base,lg,xl,2xl…}` 与字号任意值 `text-[…px|rem]`：规则 `bare-text-size`，须用 `.td-text-{caption,label,body,title,display}` 语义类（`.css` 与测试文件豁免）。
- 禁止 `leading-*` 与 `td-text-*` 出现在同一 className 串：规则 `dead-leading-on-td-text`。§2 那条优先级事实的执行闸——这类 `leading-*` 是完全不生效的死类，不是"写了但被覆盖"，删掉它渲染结果一字不变。要调元素高度改 `padding` 或 flex 居中，确需另一档行高则加排版角色语义类。带 `!` 的 important 写法会翻转层级优先级、确实生效，不在拦截范围（测试文件豁免）。
- 禁止全局浮层裸高 z-index（`z-30/40/50/60/70`、`z-[…]`）：规则 `bare-zindex`，须用 `z-[var(--z-*)]`；局部 stacking `z-10`/`z-20` 放行（测试文件豁免）。注：`60` 不在当前 `--z-*` 阶梯（30/40/50/70）里，列在禁单是防新造全局层级；规则实际禁除 `0/10/20` 外的一切数字档。
- 禁止裸任意尺寸/间距/定位值（`w-[34px]`、`top-[4.75rem]` 等纯数字+单位）：规则 `bare-arbitrary-value`，收进 token 或标准 Tailwind 阶；`calc()`/`var()` 例外，字号任意值归 `bare-text-size`（测试文件豁免）。数值无法落进 token 阶梯又确属某功能专有（如某区限高）时，正当出口是在 `index.css` 里加一条**功能语义类**（如 `.todo-project-group-body { max-height: 45vh; }`）交组件消费——不是在组件里留裸任意值，也不是进 allowlist。转盘 / 弹层 / 图表框 / 星图画布等专有几何集中在 `index.css` 的「功能几何语义类」块。**该块统一放 `@layer components`**：顶层裸规则会压过 Tailwind utilities，调用方就盖不住默认值了（如 `TagFilterPanel` 用 `max-h-28` 覆盖默认限高、速记日期气泡用 `sm:top-20` 覆盖吸顶位）。
- 禁止手写单选筛选分段（同一元素 `aria-pressed={` + `rounded-pill`）：规则 `handwritten-segmented-control`，须用 `SegmentedControl`（`role=radiogroup`）；`role=tablist/tab` 的视图切换语义页与 `SegmentedControl` 自身豁免（测试文件豁免）。
- 禁止裸文本空态（`py-10` + `text-center` 组合）：规则 `bare-text-empty-state`，须用 `EmptyState`（card/inline 档）；`EmptyState` 组件自身豁免（测试文件豁免）。
- 禁止 `<h1>` 不带 `td-text-title`/`td-text-display` 排版类：规则 `h1-without-title-size`，页面标题层级分裂（`td-text-body font-medium` 当 h1）是历史遗留形态（测试文件豁免）。

`scripts/design-language-allowlist.json` 是显式例外登记簿，每项写明 `file`、`rule`、`lineText`、`reason`、`ownerBatch`、`removeBy`。脚本按 `file + rule + lineText` 精确匹配并报告 stale 条目；新增代码不得通过 allowlist 绕过棘轮。当前长期例外是 `categoryColors.ts` 的用户内容分类预设色，属于业务数据而非 UI chrome，其余设计语言规则均直接拦截违规。

<a id="design-language-s4"></a>

## 4. 关键不变量 / 坑 / 红线

1. **新 UI 一律用 token，不写裸 hex/rgba**；统计、设置、Todo、Entry、Track、Goal 等页面的 UI chrome 都消费语义颜色、圆角、排版和几何类；用户内容分类预设色是业务数据例外。裸任意尺寸/间距、裸字号、裸圆角均由 §3 棘轮直接拦截。
2. **图表不维护独立 data palette**：图表序列走用户分类色；用户内容色只代表分类、项目、标签、用户自定义标记。Track agent tone 只表达该调度信号。
3. **无原生表单控件**：`<select>`/`type=checkbox`/`type=radio`/`window.confirm`/`window.alert` 一律用自绘控件——**CI 棘轮 `check:ui` 强制**（见 [design-language/controls](design-language/controls.md)）。
4. **图标统一 Phosphor**，经 `components/Icon.tsx` 包装（见子文档）；不用 emoji 或文字字符伪装图标。
5. **recharts 不解析 CSS `var()`**：图表 chrome（axis/grid/tooltip 背景边框文字/legend/cursor）须把中性 token 镜像成 JS 常量，统一出自 `pages/stats/chartColors.ts`（只导出 `CHART_CHROME`），唯一消费方是 TimeStats 的 `InsightCharts`（健康图表随健康子系统退役，见 [ADR 0024](../adr/0024-retire-health-subsystem.md)）；该文件在 `check:design` 整文件豁免 `bare-raw-color`（见 §3），对应的中性颜色事实源是 `index.css` token。数据序列不由本文件取色，走用户分类色（`item.color`，无色回退 `UNCATEGORIZED_COLOR`，见 [stats-insights](stats-insights.md#stats-insights-s1-2)）；状态色只留给真状态，不上数据序列。
6. **横向溢出从组件源头收口**：全站 `<main>` 负责纵向滚动，交互组件若会产生临时横向位移（如 Todo 拖拽 / swipe 行），应在组件行容器或本主题全局规则里裁掉横向溢出，避免把页面撑出横向滚动面；纵向拖拽让位可单独放开。**推论：swipe 行内的装饰必须画在内侧**——`ring-*` 与任何向外画的 `box-shadow` 会被祖先 `.swipeable-list-item { overflow:hidden }` 整圈裁掉，真机不可见，而 jsdom / happy-dom 不算裁剪，只断言 className 的单测照样全绿（"已归目标任务绿外圈"就这么 ship 成过隐形功能）。用绝对定位子元素（`pointer-events-none`，避开圆角与拖拽命中区）或 `ring-inset`，并靠真机 / 截图验收——单测在这件事上给不出结论。
7. **主导航：移动纯图标 / 桌面图标+文字**：移动底栏主导航用 Phosphor 纯图标（仅 `aria-label`），只渲染 `nav.visibleTabs.v1` 选中的入口并固定保留设置，不提供三点菜单；未选入口由设置的“更多功能”子页承接。桌面侧栏主导航图标下方配 `td-text-caption` 文字标签（aside `w-20`，"更多"按钮同款），这是设计审查 C1 的可读性收口——**仅桌面，移动底栏维持纯图标不变**。图标来自 `navRegistry`，用户配置只保存 route/placement，不保存 icon 名或颜色；主导航按钮必须有 `aria-label`。active 用 `accent-soft` 背景、`accent` 图标色和 `accent` ring，hover/focus 只消费现有 `page/surface/border/ink/accent` token，不为主导航单独引入裸色。轨道回手计数以 `NavBadge`（`bg-accent`/`text-page` 圆点，`td-text-caption`，>9 显「9+」）叠在 `/tracks` 图标右上角，计数为 0 时不渲染；两端复用同一 `NavBadge`，不引裸色。
8. **设置壳与设置行复用 token 组件**：设置详情页外壳 `SettingsDetailPage` 使用 `page/surface/border/ink` token；设置首页的 `SettingsSection` / `SettingsRow` / `SettingsToggleRow` / `SettingsNumberRow` 使用 `surface/border/ink/accent` 语义 tone，避免各设置入口重新引入旧 `slate-*` / 模块色 / 大圆角样式。`SettingsNumberRow` 的 `−`/`+` 按钮和 `input[type=number]` 消费 `surface-hover`/`border`/`ink`/`accent` token，不引入裸色。
9. **z-index 走层级 token**：跨局部内容的下拉 / 日期气泡、遮罩、弹层与全屏接管用 `z-[var(--z-*)]`，内联 `style.zIndex` 用 `lib/zLayers.ts` 的 `Z`；普通粘顶头、画布 HUD/notice 等局部 stacking 使用 `z-10`/`z-20`，不升全局 token。新全局浮层选层级按语义对号入座，不另造数值。
10. **单一暗色主题 + 单一动作色**：不搭换肤机制、不引 `[data-theme]`、不出亮色主题；动作色只有品牌蓝一支。motion 走标准 utility/局部 keyframe 值，z-index 与任意值按各自语义治理并由棘轮守。视觉一致性靠单测 + `/dev/styleguide` 预览页人工验收，**不做像素快照**。
11. **安全区让位分工**：顶部与左右在 AppShell 根容器一处解决（根 div 挂 `td-safe-top td-safe-x`，类语义见 §1）；底部由**实际占位者自己让**，统一走 `calc(<px> + var(--safe-bottom))` 组成式——px 项是常规偏移，安全区值经 `:root` 的 `--safe-*` 变量流入（机制见 §1）。**`--safe-bottom` 固定为 `0px`**：底栏与内容刻意延伸到 home 横条 / 手势条之下、横条浮在其上，这是产品取向不是疏漏；组成式接口照旧保留，要整体恢复让位只改 `:root` 一处、消费点一律不动。按 `<html data-platform="android">` 清零的是顶部与左右（WebView 里原生 padding 与 `env()` 会叠成双倍留白）。消费点：底栏可见态总高与内边距（隐藏态两者一起归零，只归零高度会留下 inset 高空带）、贴底浮层（TodoComposer / TodoSelectionBar / 速记页 / 更新提示 / GoalGraphUndoToast）的 `bottom`、滚动内容与 sticky 收起位的 `paddingBottom` / `scrollPaddingBottom` / `bottom`。**组件里新写底部让位一律走 calc 组成式，不散写裸 `env()`**；底部弹层是让位的唯一例外——`components/ui/Sheet.tsx` 与 `pages/todo/TaskDetailSheet.tsx` 的操作按钮就在面板最下沿，压到横条下会点不到，故走独立的 `--safe-bottom-sheet`（`env(safe-area-inset-bottom)`，两平台同源），本就贴屏幕底边、没有 px 偏移项，直接消费变量。
12. **底部避让量单一来源**：速记页（QuickNotesPage）与待办页（TodoPage）喂进上一条 `calc()` 组成式的 px 项，由 `lib/bottomInset.ts` 的 `composeBottomInset({ barHeightPx, navOffsetPx, keyboardHeightPx })` = `Math.ceil(三者之和)` 单一合成，是两页共用的唯一入口。各页私有的“此刻底部站着谁”（QuickNotes 的 selectionMode/searchOpen 分支、Todo 的多选/滚动收起分支）仍留在各页自己算，只把结果当 `barHeightPx` 喂给合成函数——合成函数本身不判断“底部站着谁”。键盘高度经 `hooks/useKeyboardHeight.ts` 的 `useKeyboardHeight()` 并入 `keyboardHeightPx`：Capacitor native 壳走 `@capacitor/keyboard` 的 `keyboardWillShow`/`keyboardWillHide` 事件（前者取事件里的真实高度，后者归 0），web/PWA 没有该插件桥接，降级用 `visualViewport` 与 `innerHeight` 的差值估算，差值 > 80px 才判定键盘弹起（避免地址栏收合等抖动误报）。这条 JS 路径是键盘避让的唯一实现——capacitor 侧 `Keyboard.resize` 设为 `none`，webview 不因键盘弹起自动 reflow，见 [deployment/ios-ipa](deployment/ios-ipa.md#deployment-ios-ipa-s3-3)。回归护栏：`keyboardHeightPx = 0`（桌面浏览器 / 键盘收起）时合成结果与合成前逐值相等，见 `bottomInset.test.ts`。安全区值不参与本次合成，仍按上一条经 CSS 变量单独叠加。

    两页的 `navOffsetPx` 归零时机不同，如实记差异，不假装一致：Todo 页的 `navOffsetPx` 在计算式里带 `keyboardHeightPx === 0` 同步守卫（`!wide && !navHidden && keyboardHeightPx === 0 ? BOTTOM_NAV_HEIGHT_PX : 0`），键盘一弹起就在同一次渲染里归零，不依赖任何 effect。QuickNotes 页的 `navOffsetPx` 只看 `navHidden`（`!isWideScreen && !navHidden ? BOTTOM_NAV_HEIGHT_PX : 0`），而 `navHidden` 由 `inputInteractionActive`（`composerFocused || searchOpen || keyboardHeight > 0`）驱动的 `useEffect` 异步 `setNavHidden` 得来——键盘收起（`keyboardHeight` 归 0）与 `navHidden` 变回 `false` 隔了一次 effect，即隔一帧。这意味着键盘收起的瞬间可能有一帧 `keyboardHeightPx=0` 且 `navOffsetPx` 还未回填（nav 让位比键盘高晚一帧），composer 输入条会先冲到更低位置再弹回原位（"收起抖"/下冲）。这一帧级别的抖动 jsdom 测不出，是**真机验收项**（见 Task5）。

13. **触感只经语义层**：页面调的是 `lib/haptics.ts` 的四个语义函数——`hapticToggle`（勾选 / 取消勾选）、`hapticDestructive`（删除 / 清空）、`hapticGrab`（拖拽拿起）、`hapticDrop`（拖拽吸附落位，取消或原地放下不调）。**「什么动作配什么强度」的映射只写在这一个文件**（`@capacitor/haptics` 的 `ImpactStyle`：destructive 一档重，其余三个最轻档），调用点不出现强度常量，整体调轻重或加全局开关只改这一处。调用接在页面的事件处理处，不下沉进 `lib/` 数据函数——否则跑数据层单测也会震。批量动作**整批只震一次**，不逐条震。iOS 与 Android 原生壳都接；Web / PWA / 桌面经 `Capacitor.isNativePlatform()` 判否后**整层空转**，且不回退 `navigator.vibrate`（浏览器那种整机震与原生轻触感不是同一种反馈）。插件缺失 / 系统关闭 / 硬件不支持一律吞掉，业务动作照常完成：除了接 promise 的 reject，还得防住 `impact` 同步抛与返回非 thenable（插件未注册 / 旧桥 shim）——那两种是**同步** TypeError，`hapticGrab` 在 dnd-kit 的同步 `onDragStart` 里抛出去整个拖拽都起不来。投递坠的「抓到手头」同样是吸附落位，写入成功后要震（投递失败与 invalid 拒绝不震）。

## 5. 模块速查

| 关注点 | 入口 |
|---|---|
| 全部颜色/圆角/边框/阴影/字体 token + 全局样式 | `packages/client/src/index.css`（Tailwind v4 `@theme static`） |
| 设计语言棘轮 + 旧债 allowlist | `scripts/check-design-language.mjs`、`scripts/design-language-allowlist.json` |
| 主导航图标映射与纯图标壳 | `packages/client/src/lib/navigation/navRegistry.ts`、`components/app-shell/{MobileBottomNav,DesktopSidebar}.tsx`；移动底栏无三点菜单，未选入口在 `/settings/more` 显示，桌面侧栏仍可配置更多收纳 |
| 「这条路由自己不要底栏」判据 | `navRegistry.ts` 的 `layoutHidesBottomNav`（前缀清单）。三个消费点共用它：`App.tsx` 单层壳、`KeptRouteStack` 分层壳（iOS）、`hooks/useHideBottomNavOnScroll.ts` 的路由切换复位。判据只此一份，抄第二份就会静默分叉 |
| 设置详情页外壳与设置首页行组件 | `packages/client/src/pages/settings/SettingsDetailPage.tsx`、`packages/client/src/pages/settings/components/SettingsRows.tsx` |
| 字体引入（GB 屏显子集 + Tinos） | `packages/client/src/main.tsx`（covers 归 [architecture](architecture.md)）；守序测试 `fontLoading.test.ts` |
| 自绘控件 / 无原生控件棘轮 / 图标 | → [design-language/controls](design-language/controls.md) |
| 图表 chrome 取色（token→JS 常量镜像） | `packages/client/src/pages/stats/chartColors.ts`（只有 `CHART_CHROME`；数据序列走用户分类色，见 §4 第 5 条；守序测试 `chartColors.test.ts`） |
| z-index 层级 JS 镜像 | `packages/client/src/lib/zLayers.ts`（`Z`，与 `--z-*` 同步，`zLayers.test.ts` 守一致） |
| 键盘高度单一来源 / 底部避让量单一合成 | `packages/client/src/hooks/useKeyboardHeight.ts`、`packages/client/src/lib/bottomInset.ts`（见 §4 第 12 条；守序测试 `useKeyboardHeight.test.tsx`、`bottomInset.test.ts`） |
| 触感语义函数 + 强度映射 | `packages/client/src/lib/haptics.ts`（见 §4 第 13 条；守序测试 `haptics.test.ts`） |
| 设计语言预览 / 验收台 | `packages/client/src/pages/dev/StyleguidePage.tsx`（路由 `/dev/styleguide`，渲染全部 token + `.td-*` + 自绘控件） |

## 子文档索引

| 子文档 | 拥有什么 |
|---|---|
| [design-language/controls](design-language/controls.md) | 自绘控件库 `components/ui/**`、Phosphor 图标包装 `Icon.tsx`、确认弹层 `useConfirm`、CI 棘轮 `check-no-native-controls.mjs`（`check:ui`） |

## 深水细节

- **App 启动图标是另一条管线**：`scripts/generate-icons.mjs` 用 sharp 从根 `icon.png` 生成 PWA/Android/favicon/iOS 全套（与 UI 内 Phosphor 图标无关），属构建/资产，不在本主题 covers。
- **单文件 CSS**：全站样式集中在 `index.css`（含 token + 全局规则 + 部分组件类）。它被多功能触及，但主轴身份是“设计系统/全局样式”，故归本主题单一 covers；功能主题改样式时在「邻居」链回本文，不另 cover `index.css`。
