---
type: evergreen
title: 设计语言 · 棘轮
covers:
  - scripts/check-design-language.mjs
  - scripts/design-language-allowlist.json
contracts:
  - scripts/check-design-language.mjs
  - scripts/design-language-allowlist.json
last-reviewed: 2026-08-10
---

# 设计语言 · 棘轮

> [design-language](../design-language.md) 的**棘轮子文档**：`pnpm check:design` 的全部规则、判定形态与豁免登记簿。
> 讲什么：每条防回退规则拦什么、判定形态是什么、哪些情况豁免，以及 allowlist 的字段与用法。
> 不讲什么：token 与排版角色本身（见 [design-language](../design-language.md) §1–§2）、写新 UI 要守的红线（见 [invariants](invariants.md)）、无原生控件棘轮 `check:ui`（见 [controls](controls.md)）。

## 承上启下

- **上游**：[design-language](../design-language.md) 的 token 与语义类——棘轮拦的就是绕开它们的写法。
- **下游**：`packages/client/src` 全部生产代码；违规在 CI 直接失败。
- **契约**：规则清单与 allowlist 是单一事实源，新增规则必须同步本文；新代码不得通过 allowlist 绕过。
- **邻居**：[design-language](../design-language.md)（主题）、[controls](controls.md)（`check:ui` 那一半）、[invariants](invariants.md)（红线，多数由本文规则执行）。

<a id="design-language-ratchets-s1"></a>

## 1. 规则清单

`pnpm check:design` 扫描 `packages/client/src`，由 `scripts/check-design-language.mjs` 执行。它不是审美检查，而是防回退闸：

- 禁止退役模块色：`--color-mod-*`、`text-mod-*`、`bg-mod-*`、`border-mod-*` 等。
- 禁止退役 data palette：`--color-data-*` 及其 Tailwind utility；图表序列走分类色，Track agent 信号走 `track-agent`。
- 禁止退役 motion token 与独立 soft 状态色别名；motion 使用 Tailwind 标准档或 keyframe 邻近值，状态柔面使用主状态色 alpha。
- 禁止新增 UI chrome 裸 `slate-*`，主操作裸 `blue-*` / `sky-*`，状态裸 `emerald-*` / `green-*` / `amber-*` / `yellow-*` / `orange-*` / `red-*` / `rose-*` / `gray-*`；覆盖 `bg/text/border/ring/fill/stroke/outline/caret/accent/shadow/decoration` 等常见 Tailwind 色彩工具。
- 禁止 UI chrome 新增裸 hex / rgb / rgba / hsl / oklch / lab；测试 fixture、用户内容色、图表色和 scoped 特殊场景由脚本/allowlist 显式区分。
- 禁止 UI chrome 用裸 `white`/`black` 命名色（`bg-black/50`、`text-white`、`bg-[white]`、`border-t-white` 等）：规则 `bare-black-white`，遮罩用 `bg-backdrop/*`，accent 反白字用 `text-accent-contrast`（测试文件豁免）。
- **token 定义与图表镜像不算「裸色」**：`index.css` 里 `--color-*` / `--galaxy-*` / `--shadow-*` 的 token 定义本身（值含 hex/rgba）是颜色的唯一事实源，脚本直接跳过；token 镜像文件（`pages/stats/chartColors.ts` 图表 chrome、`lib/navigation/routeFavicon.ts` favicon SVG data-URI——recharts / SVG data-URI 不解析 `var()`，故把 token 镜像成 JS 常量）整文件跳过 `bare-raw-color`。镜像文件登记在脚本的 `TOKEN_MIRROR_FILES`，新增镜像文件需登记；长期 allowlist 不是维持图表裸 hex 的手段。
- 禁止 `index.css` 未定义的语义色 utility：规则 `unknown-semantic-color`，合法名集合运行时从 `@theme` 的 `--color-*` 解析（不硬编码第二份清单），覆盖 `text/bg/border/ring/outline/fill/stroke/divide/decoration/placeholder/caret/accent` 前缀并穿透变体前缀。这类拼错在 Tailwind 下**静默失效**——类名不生成、元素继承父级颜色、页面看不出异常，肉眼与 typecheck 都发现不了，这道闸是唯一途径。Tailwind 内置的非颜色用法（`text-center`、`border-2`、`bg-cover` 等）走白名单放行；裸调色板名归 `bare-*` 系列管，不重复报。
- 禁止交互控件用文字字符或 emoji 伪装图标：规则 `interactive-text-icon`，判定 =「字符命中白名单」×「同行或前后 8 行内是交互上下文」（`<button` / `<a` / `<Link` / `<NavLink` / `role="button"` / `onClick=`），测试文件不豁免。形态认三种：同行 `>符号<`、同行 `{"符号"}`，以及**跨行的纯文本子节点**——`>` 与下一个 `<` 之间的内容整体就是一个符号（符号独占一行）或是只含伪装字符字面量的表达式（如 `{expanded ? "▢" : "⤢"}`）。字符白名单是**穷举式**的：明细分组与「哪些标点刻意不收」的判据见 [controls §2](controls.md#design-language-controls-s2)，白名单外的新符号仍会放行，所以这道闸是辅助不是保证。
- 禁止业务时间/数字/统计值直接用 `font-mono`；代码、日志、ID、debug 标识应优先放在 `code/pre/kbd/samp` 或专用技术文本组件中，确有遗留例外必须进 allowlist。
- 禁止原生圆角 `rounded-md/lg/xl/2xl/3xl/full` 及其方向变体、以及 `rounded-[…px|rem]` 任意值：规则 `bare-card-radius`，生产代码使用 `rounded-ctl/row/card/pill`，仅发丝级/小型原子细节保留 `rounded/rounded-sm`（测试文件豁免）。
- 禁止裸字号 `text-{xs,sm,base,lg,xl,2xl…}` 与字号任意值 `text-[…px|rem]`：规则 `bare-text-size`，须用 `.td-text-{caption,label,body,title,display}` 语义类（`.css` 与测试文件豁免）。
- 禁止 `leading-*` 与 `td-text-*` 出现在同一 className 串：规则 `dead-leading-on-td-text`。[design-language](../design-language.md) §2 那条优先级事实的执行闸——这类 `leading-*` 是完全不生效的死类，不是"写了但被覆盖"，删掉它渲染结果一字不变。要调元素高度改 `padding` 或 flex 居中，确需另一档行高则加排版角色语义类。带 `!` 的 important 写法会翻转层级优先级、确实生效，不在拦截范围（测试文件豁免）。
- 禁止全局浮层裸高 z-index（`z-30/40/50/60/70`、`z-[…]`）：规则 `bare-zindex`，须用 `z-[var(--z-*)]`；局部 stacking `z-10`/`z-20` 放行（测试文件豁免）。注：`60` 不在当前 `--z-*` 阶梯（30/40/50/70）里，列在禁单是防新造全局层级；规则实际禁除 `0/10/20` 外的一切数字档。
- 禁止裸任意尺寸/间距/定位值（`w-[34px]`、`top-[4.75rem]` 等纯数字+单位）：规则 `bare-arbitrary-value`，收进 token 或标准 Tailwind 阶；`calc()`/`var()` 例外，字号任意值归 `bare-text-size`（测试文件豁免）。数值无法落进 token 阶梯又确属某功能专有（如某区限高）时，正当出口是在 `index.css` 里加一条**功能语义类**（如 `.todo-project-group-body { max-height: 45vh; }`）交组件消费——不是在组件里留裸任意值，也不是进 allowlist。转盘 / 弹层 / 图表框 / 星图画布等专有几何集中在 `index.css` 的「功能几何语义类」块。**该块统一放 `@layer components`**：顶层裸规则会压过 Tailwind utilities，调用方就盖不住默认值了（如 `TagFilterPanel` 用 `max-h-28` 覆盖默认限高、速记日期气泡用 `sm:top-20` 覆盖吸顶位）。
- 禁止手写单选筛选分段（同一元素 `aria-pressed={` + `rounded-pill`）：规则 `handwritten-segmented-control`，须用 `SegmentedControl`（`role=radiogroup`）；`role=tablist/tab` 的视图切换语义页与 `SegmentedControl` 自身豁免（测试文件豁免）。
- 禁止裸文本空态（`py-10` + `text-center` 组合）：规则 `bare-text-empty-state`，须用 `EmptyState`（card/inline 档）；`EmptyState` 组件自身豁免（测试文件豁免）。
- 禁止 `<h1>` 不带 `td-text-title`/`td-text-display` 排版类：规则 `h1-without-title-size`，页面标题层级分裂（`td-text-body font-medium` 当 h1）是历史遗留形态（测试文件豁免）。
- 禁止手写状态三件套（同一 `className` 串里、同一个 tone 的 `border-*/N` + `bg-*/N` + `text-*`，tone 取 `warn`/`danger`/`ok`）：规则 `handwritten-status-banner`，须用 `StatusBanner`（`info`/`ok`/`warn`/`danger` 四档、`card`/`bar` 两形态）。判定靠反向引用锁死「三个类同一个 tone」，透明度档位不限——**识别特征是三件套同 tone，不是某个特定透明度**（写死 `/10` 会让 `bg-danger/20` 这类整档漏检）。**拦截面之外**：手写 `info` 档（`info` 用的是中性 `border`/`surface`，没有 `bg-info/N` 这种同名三件套）、className 跨行拆写、同一行里混用不同 tone。这是逐行正则闸的固有界限，**换序或跨行的写法绕得过去，所以它是辅助不是保证**（同 `interactive-text-icon` 的白名单穷举性质）。豁免：测试文件、`StatusBanner.tsx` 自身、交互态 `hover:`/`disabled:`（危险按钮以交互态 utility 为识别特征，状态条没有交互态）、`rounded-pill`（徽章）与 tone 映射常量表（`good: "…"` 键值对，不是 JSX className）。
- 禁止手写居中遮罩（同一 `className` 串的 `fixed inset-0` + `items-center` + `justify-center` + `bg-backdrop` 三件套）：规则 `handwritten-centered-modal`，弹层统一走 `Sheet` / `ConfirmSheet` 底部抽屉（Esc / 焦点管理 / `aria-modal` 由抽屉自带）；`Sheet` 自身是 `items-end`，天然不命中（测试文件豁免）。

<a id="design-language-ratchets-s2"></a>

## 2. allowlist 登记簿

`scripts/design-language-allowlist.json` 是显式例外登记簿，每项写明 `file`、`rule`、`lineText`、`reason`、`ownerBatch`、`removeBy`。脚本按 `file + rule + lineText` 精确匹配并报告 stale 条目；新增代码不得通过 allowlist 绕过棘轮。当前长期例外是 `categoryColors.ts` 的用户内容分类预设色，属于业务数据而非 UI chrome，其余设计语言规则均直接拦截违规。
