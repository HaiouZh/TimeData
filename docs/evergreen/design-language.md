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
contracts:
  - packages/client/src/index.css
  - packages/client/src/lib/navigation/navRegistry.ts
last-reviewed: 2026-08-10
---

# 设计语言

> 设计语言**主题文档**（非数据域，按“设计风格”轴成主题）：深冷工具基调的暗色视觉系统——语义颜色 token + 书卷体字体 + Phosphor 图标 + 自绘控件。
> 讲什么：语义颜色治理、圆角/边框/阴影阶梯、字体栈与排版角色、安全区让位。
> 不讲什么：设计语言棘轮与 allowlist（见子文档 [design-language/ratchets](design-language/ratchets.md)）、全站视觉红线与不变量（见子文档 [design-language/invariants](design-language/invariants.md)）、自绘控件库与无原生控件棘轮（见子文档 [design-language/controls](design-language/controls.md)）、各功能页如何用这些 token（见各功能主题）。

## 承上启下

- **上游**：无（这是最底层的视觉/交互基座）。token 与全局样式集中在单一文件 `index.css`（Tailwind v4 `@theme static`）。
- **下游**：所有功能主题（[timeline](timeline.md)/[todo](todo.md)/[quick-notes](quick-notes.md)/[stats-insights](stats-insights.md)/[categories-settings](categories-settings.md)）的页面与组件都消费这些 token 和控件；它们只在「邻居」链接到本主题，不重复 token 定义。
- **契约**：颜色/圆角/字体 token 与排版角色见本文 §1–§2（源在 `index.css`）；设计语言棘轮见 [design-language/ratchets](design-language/ratchets.md)；全站红线与不变量见 [design-language/invariants](design-language/invariants.md)；自绘控件契约见 [design-language/controls](design-language/controls.md)；图表取色（recharts 镜像 token，`pages/stats/chartColors.ts`）见 [invariants](design-language/invariants.md) 第 5 条。
- **邻居**：[design-language/ratchets](design-language/ratchets.md)、[design-language/invariants](design-language/invariants.md)、[design-language/controls](design-language/controls.md)（同主题子文档）、全部功能主题（消费方）。

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
- **圆角阶梯**：`--radius-ctl`(8) / `--radius-row`(12) / `--radius-card`(16) / `--radius-pill`(999)，分别表达控件、列表行、面板卡片与圆形/胶囊；`rounded` / `rounded-sm` 只服务发丝级或小型原子细节。生产组件不使用 Tailwind `md/lg/xl/2xl/3xl/full` 原生圆角词汇（棘轮 `bare-card-radius`，见 [ratchets](design-language/ratchets.md)）。
- **边框**：`--color-border` / `--color-border-strong` / `--color-border-hairline`(rgba 8%)。
- **黑白命名色已 token 化**：Tailwind `white`/`black` 命名色不直接进 UI chrome（棘轮 `bare-black-white`，见 [ratchets](design-language/ratchets.md)）。弹层遮罩用 `bg-backdrop/*`（`--color-backdrop`），accent 实心面上的反白文字用 `text-accent-contrast`；用户内容色需要黑白表达时显式走业务数据路径。
- **滚动条**：`--color-scrollbar-thumb` / `--color-scrollbar-thumb-hover`（滑块常态 / 悬停提亮，色值同边框灰蓝档但语义独立）。`html` 上 `scrollbar-width: thin` + `scrollbar-color` 全站继承，轨道透明；hover 提亮走零特异性 `:where(:hover)`，局部隐藏特例（如转盘 `.wheel-scroll`）可直接压过。**只用标准属性，不用 `::-webkit-scrollbar` 伪元素**——后者会让 Chrome/Edge 从 overlay 条退化成常驻占位条（`indexCssTokens.test.ts` 有计数闸守着，全站仅转盘的 display:none 隐藏一处豁免）。
- **阴影**：`--shadow-elev1`（小表面）/ `--shadow-elev2`（浮层），仅大表面用；两者均叠了顶部 `inset 0 1px 0` hairline 高光，暗色下给大表面一道微亮上沿。
- **动效**：普通过渡使用 Tailwind `duration-150/200/300`、`duration-0` 与 `ease-out`；sheet `150/200ms ease-out`、Todo occurrence `300ms cubic-bezier(0.2, 0, 0, 1)` 等 keyframe 在 `index.css` 邻近声明具体值。长循环动画保留自身值；所有动画尊重 `prefers-reduced-motion`。
- **z-index 层级**：`--z-dropdown`(30) / `--z-backdrop`(40) / `--z-modal`(50) / `--z-top`(70)，只治理**全局浮层**；普通 sticky header、画布 HUD 与 notice 属局部 stacking，使用 `z-10`/`z-20`。CSS 是单一事实源，内联 `style.zIndex` 走 JS 镜像 `lib/zLayers.ts` 的 `Z`（类比图表色镜像），`zLayers.test.ts` 守 JS 与 CSS 阶梯一致。
- **安全区语义类**：安全区值统一由 `:root` 的 `--safe-*` 变量供给（`--safe-top/right/bottom/left`，默认 `env(safe-area-inset-*)`；`html[data-platform="android"]` 时清零——Android 壳由 MainActivity 在原生层做唯一让位，WebView 里 `env()` 照常报非零值、会与原生 inset padding 叠成双倍留白，见 [deployment/android-apk](deployment/android-apk.md#deployment-android-apk-s2)）。`.td-safe-top`（`padding-top: var(--safe-top)`）、`.td-safe-x`（左右）、`.td-safe-bottom`（底部）定义在 `index.css` 的 `@layer components`（同 [ratchets](design-language/ratchets.md) 里「功能几何语义类」的理由：顶层规则会压过 Tailwind utilities，调用方盖不住）。生效前置是 `index.html` 的 viewport meta 带 `viewport-fit=cover`；桌面浏览器 `env()` 恒为 0，挂上即零变化。挂点必须是**非滚动根容器**——padding 区域由容器自身底色绘制，内容不会钻进刘海/圆角底下。当前消费方只有 AppShell 根 div（`td-safe-top td-safe-x`）；`.td-safe-bottom` 尚无消费方，底部让位由各实际占位者自己做（分工见 [invariants](design-language/invariants.md) 第 11 条）。
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
- **`.td-text-*` 定义在 `index.css` 顶层未分层区，会压过 `@layer utilities` 里的所有 Tailwind 排版 utility**：同一行上的 `leading-*`、`tracking-*` 一律不生效，`font-*` 只对 caption/label/body 生效（这三档不定义 `font-weight`），对 title/display 不生效（两档自带 600）。要偏离档位内建值时不要靠 utility 叠加，而是加一条**排版角色语义类**——如卡片眉标 `.td-eyebrow`（12px + 500 + 大写 + `letter-spacing: 0.16em`），放 `@layer components`——注意这类语义类是 `td-text-*` 的**替代品而非叠加物**（它自带 `font-size`/`line-height`，与 `td-text-*` 同用又会被顶层规则压回去）。`leading-*` 这一面由 [ratchets](design-language/ratchets.md) 的 `dead-leading-on-td-text` 棘轮守着。
- 数字/时间/时长使用 `td-num`、`td-time`、`td-duration`，三者指向 `--font-body` 并启用 `font-variant-numeric: tabular-nums`；统计卡数值使用 `td-num`。数字默认不使用等宽字体。

## 3. 模块速查

| 关注点 | 入口 |
|---|---|
| 全部颜色/圆角/边框/阴影/字体 token + 全局样式 | `packages/client/src/index.css`（Tailwind v4 `@theme static`） |
| 设计语言棘轮 + 旧债 allowlist | → [design-language/ratchets](design-language/ratchets.md) |
| 全站视觉红线 / 不变量 / 坑 | → [design-language/invariants](design-language/invariants.md) |
| 主导航图标映射与纯图标壳 | `packages/client/src/lib/navigation/navRegistry.ts`、`components/app-shell/{MobileBottomNav,DesktopSidebar}.tsx`；移动底栏无三点菜单，未选入口在 `/settings/more` 显示，桌面侧栏仍可配置更多收纳 |
| 「这条路由自己不要底栏」判据 | `navRegistry.ts` 的 `layoutHidesBottomNav`（前缀清单）。三个消费点共用它：`App.tsx` 单层壳、`KeptRouteStack` 分层壳（iOS）、`hooks/useHideBottomNavOnScroll.ts` 的路由切换复位。判据只此一份，抄第二份就会静默分叉 |
| 设置详情页外壳与设置首页行组件 | `packages/client/src/pages/settings/SettingsDetailPage.tsx`、`packages/client/src/pages/settings/components/SettingsRows.tsx` |
| 字体引入（GB 屏显子集 + Tinos） | `packages/client/src/main.tsx`（covers 归 [architecture](architecture.md)）；守序测试 `fontLoading.test.ts` |
| 自绘控件 / 无原生控件棘轮 / 图标 | → [design-language/controls](design-language/controls.md) |
| 图表 chrome 取色（token→JS 常量镜像） | `packages/client/src/pages/stats/chartColors.ts`（只有 `CHART_CHROME`；数据序列走用户分类色，见 [invariants](design-language/invariants.md) 第 5 条；守序测试 `chartColors.test.ts`） |
| z-index 层级 JS 镜像 | `packages/client/src/lib/zLayers.ts`（`Z`，与 `--z-*` 同步，`zLayers.test.ts` 守一致） |
| 键盘遮挡量单一来源 / 底部避让量单一合成 | `packages/client/src/hooks/useKeyboardHeight.ts`、`packages/client/src/lib/bottomInset.ts`（见 [invariants](design-language/invariants.md) 第 12 条；守序测试 `useKeyboardHeight.test.tsx`、`bottomInset.test.ts`） |
| 触感语义函数 + 强度映射 | `packages/client/src/lib/haptics.ts`（见 [invariants](design-language/invariants.md) 第 13 条；守序测试 `haptics.test.ts`） |
| 设计语言预览 / 验收台 | `packages/client/src/pages/dev/StyleguidePage.tsx`（路由 `/dev/styleguide`，渲染全部 token + `.td-*` + 自绘控件） |

## 子文档索引

| 子文档 | 拥有什么 |
|---|---|
| [design-language/ratchets](design-language/ratchets.md) | `check:design` 全部规则与判定形态、豁免登记簿 `design-language-allowlist.json` |
| [design-language/invariants](design-language/invariants.md) | 写新 UI 前该知道的 16 条全站红线：token 红线、图表取色分工、导航与设置壳形态、安全区与底部避让分工、触感语义层、状态表达与删除确认判据；外加一条已知界限（存量触控热区低于 44px 的成因与分布） |
| [design-language/controls](design-language/controls.md) | 自绘控件库 `components/ui/**`、Phosphor 图标包装 `Icon.tsx`、确认弹层 `useConfirm`、CI 棘轮 `check-no-native-controls.mjs`（`check:ui`） |

## 深水细节

- **App 启动图标是另一条管线**：`scripts/generate-icons.mjs` 用 sharp 从根 `icon.png` 生成 PWA/Android/favicon/iOS 全套（与 UI 内 Phosphor 图标无关），属构建/资产，不在本主题 covers。
- **单文件 CSS**：全站样式集中在 `index.css`（含 token + 全局规则 + 部分组件类）。它被多功能触及，但主轴身份是“设计系统/全局样式”，故归本主题单一 covers；功能主题改样式时在「邻居」链回本文，不另 cover `index.css`。
