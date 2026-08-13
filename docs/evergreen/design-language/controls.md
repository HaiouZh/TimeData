---
type: evergreen
title: 设计语言 · 控件库
covers:
  - packages/client/src/components/ui/**
  - packages/client/src/components/Icon.tsx
  - packages/client/src/lib/calendar.ts
  - packages/client/src/hooks/useActionToast.ts
  - packages/client/src/hooks/useConfirm.tsx
  - packages/client/src/hooks/useLongPress.ts
  - scripts/check-no-native-controls.mjs
  - scripts/check-design-language.mjs
contracts:
  - packages/client/src/components/ui/**
last-reviewed: 2026-08-10
---

# 设计语言 · 控件库

> [design-language](../design-language.md) 的**控件子文档**：自绘控件词汇表 + 图标包装 + 无原生控件 CI 棘轮。
> 讲什么：`components/ui/**` 各原子件、`Icon.tsx`、`useConfirm`、`check:ui` 棘轮，以及交互图标由 `check:design` 辅助防回退。
> 不讲什么：颜色/字体 token（见 [design-language](../design-language.md)）、具体功能里怎么用控件（见各功能主题）。

## 承上启下

- **上游**：[design-language](../design-language.md) 的 token（控件全用 token 取色/圆角/边框）。
- **下游**：所有功能页只用这些自绘控件，不写原生 `<select>`/checkbox/radio/date/time/`window.confirm`/`alert`。
- **契约**：控件是“原生控件的受控封装”；新增可交互控件须加进 `components/ui/` 并由棘轮豁免。
- **邻居**：[design-language](../design-language.md)（主题）。

<a id="design-language-controls-s1"></a>

## 1. 自绘控件词汇表（`components/ui/**`）

每个原子件替代一类原生控件（替代关系即 `check:ui` 棘轮的禁用映射）：

| 控件 | 替代的原生用法 | 角色 |
|---|---|---|
| `Checkbox.tsx` | `type="checkbox"` | 勾选框 |
| `Switch.tsx` | `type="checkbox"`（开关语义） | 开关 |
| `SegmentedControl.tsx` | `type="radio"` / 小集合 `<select>` | 分段单选 |
| `SelectSheet.tsx` | `<select>`（长选项） | 底部弹层选择 |
| `MonthCalendar.tsx` | `type="date"` 弹层中的月历核心 | 日期选择月历 |
| `DateField.tsx` | `type="date"` | 日期字段 + Sheet 月历 |
| `TimeField.tsx` | `type="time"` | 时间字段 + Sheet 滚轮 |
| `ConfirmSheet.tsx` | `window.alert` / 危险确认 | 确认弹层 |
| `Sheet.tsx` | — | 底部抽屉基元（其它弹层复用） |
| `ActionToastBar.tsx` | — | 轻提示条（toast 视觉 + 动作按钮），非原生控件替代件 |

控件本身在棘轮豁免目录内（它们是对原生元素的合法封装），可以内部使用原生元素。

`Sheet` 的 `portal?: boolean` 决定弹层挂在原地还是 `document.body`，默认 `false`（就地渲染）。`DateField` / `TimeField` 同样透传 `portal`。`DateField` 另有两个紧凑场景开关，默认都是 `false`：`hideIcon?: boolean` 去掉日历图标只留文字；`bare?: boolean` 让触发钮**只留行为不带字段外观**（不套 `min-h-11` / `rounded-row` / 边框 / 底色 / 内距 / `td-time` / 文字色），整套观感交给 `className`。

**`bare` 不能用「在 `className` 里覆盖」代替**：Tailwind 工具类之间没有先后之分——同层同特异性时谁生效取决于**生成的 CSS 里谁在后面**，不是 class 字符串里谁写在后面。所以给基础类追加 `min-h-0 rounded-pill` 是赌运气，且实测赌输过（速记日期条被撑成 44px 高的方角块）。速记日期气泡是当前唯一承重点，三个开关一起用。

除表单替代件外，`components/ui/` 还有一组**页面壳与状态原子件**，不替代任何原生控件、也不进棘轮禁用映射：`PageHeader`（sticky 顶栏，**背景色只走 `background` prop 不走 `className`**——两个 `bg-*` 并存时胜负同样由编译产物顺序决定）、`PageBackButton`（统一返回钮，44px 热区 `hotarea-lg`；传 `to` 渲染路由 `Link`、否则渲染 `button`）、`StatusBanner`（`info`/`ok`/`warn`/`danger` 四档 tone × `card`/`bar` 两形态）、`EmptyState`（空态，`card`/`inline` 两形态）、`LoadingState`（加载态一行字）。

`StatusBanner` 四档 tone 分工：`info`（中性提示）、`ok`（成功）、`warn`（警告）、`danger`（错误/冲突/危险）。`card` 是缺省形态（`rounded-card border px-3 py-2`），`bar` 是贴边横条（`border-b px-4 py-2`，如日记页顶部两条）。`actions` 传入时文字与动作按钮排成一行（`flex-wrap`、文字 `flex-1`），如日记冲突条的「刷新重载 / 仍然覆盖」、回顾页错误条的「重试」；不传则纯文字。组件恒定输出 `data-tone={tone}`，且 `data-*` 透传展开在 `data-tone` **之前**——调用方盖不掉它，迁移过来各页测试的断言全挂在 `data-tone` 上（如 `data-connect-sheet-error` 这种测试钩子）。`role`（缺省不设，显式传 `alert`/`status` 才进播报）与 `style` 同样透传；`style` 的承重点是速记页两条浮动横条，靠 `--bottom-offset` + `calc(… + var(--safe-bottom))` 实时定位，不传会静默丢位置。

**`className` 与 `actions` 之间有一处会互相作用**：不传 `actions` 时 `children` 直接落在根 div 下；一传 `actions`，组件会在中间插一层 `flex` 包装、把 `children` 收进一个 `<span className="flex-1">`。于是**作用于直接子元素的 `className`（`space-y-*`、`divide-*` 这类）在加了 `actions` 之后会静默失效**——它管的对象从原本那几个子元素变成了那层包装的唯一子元素。同步问题条（`SettingsPage` 的 `SyncIssueList`）正是靠 `className="space-y-1"` 给多行 `<p>` 拉间距，给它加动作按钮时这条会一起塌掉。传 `className` 的一律走定位 / 外边距 / flex 收缩这类**只作用于自身**的类，别用作用于子元素的类。

`ConfirmDeleteButton` 是「就地二次确认删除」：第一次点变成「确认删除」文字，第二次点才执行 `onConfirm`。`resetKey` 值变化即复位确认态（`useEffect(() => setConfirming(false), [resetKey])`）——用户切走干别的时，那个半按下的确认态不该留着（轨道两处传 `editing`，进编辑态要撤销待确认）。`aria-label` 随确认态在「删除{target}」/「确认删除{target}」间切换。它与 `ConfirmSheet` 的分工按「频次 × 后果」判据（[invariants](invariants.md) 第 16 条）：删掉完整对象走 `ConfirmSheet` 弹层，删对象内部的一条走本件就地确认。

`SelectSheet` 触发钮的 `aria-label` 是「{label}：{当前项 label}」，未选时是「{label}：{placeholder}」——**不写死 `label`**：`aria-label` 会盖掉按钮的 text content，写死则读屏只报得出「目标页，有弹出对话框」，当前选了哪项、是不是占位态一概听不出（`ShortcutInput` 同坑同解）。出错时调用方传 `ariaDescribedby` 指向那条错误红字的 id 并传 `ariaInvalid`——红字挨着控件只是**视觉**关联，读屏要靠这条挂钩才知道这话在说哪个控件。它被三个设置页共用（desktop / insights / admin-insights）；**测试里定位它一律用前缀匹配 `[aria-label^="…"]`**，精确匹配会随选中项变化而失配。

面板的入场动画与 88vh 限高一并由 `index.css` 的 `.sheet-panel` 承载（顶层规则，优先级高于 utilities）：调用方传进来的 `className` 改不动限高，要调只能改那条 CSS。

`Sheet` / `TaskDetailSheet` 的面板底部内衬 `paddingBottom: var(--safe-bottom-sheet)`——底部弹层是安全区让位的唯一例外，底部 chrome 走的 `--safe-bottom` 固定为 `0px`（安全区变量机制见 [design-language](../design-language.md#design-language-s1)）；`Sheet` 没有 px 偏移项，直接消费变量而非 calc 组成式。

`MonthCalendar` 的月历面板使用 `rounded-card`，日期格与导航按钮使用 `rounded-ctl`；圆角只表达控件与面板角色，不改变日期选择行为。

### 控件排版档

控件内文字一律用 `.td-text-*` 语义类，不写裸字号（由 `bare-text-size` 棘轮守，见 [ratchets](ratchets.md)）。档位分工：

| 用途 | 档 |
|---|---|
| 控件标签、选项行、trigger 显示值、按钮文字 | `td-text-label` |
| 表单内联错误提示（贴着控件的那行红字） | `td-text-label` |
| 行内次级信息、徽标/胶囊、行副标题 | `td-text-caption` |
| 成段正文（`ConfirmSheet` 的 `body`）、整段说明、空态文案、浮层提示条 | `td-text-body` |
| 面板标题（`<h3>` 级）| `td-text-body font-semibold` |
| `Sheet` 标题、页面标题（`title` 渲染的 `<h2>`） | `td-text-title` |

错误提示归 `label` 而不是 `body`：它是控件的附属反馈，跟同一行的标签/按钮文字同档才不会比自己所属的行标题还大；独立成段的说明卡片与空状态才用 `body`。面板标题不落 `title`：页面标题已占 `title`(20px)，面板标题再落同档会让原本 24/16px 的两级层级塌成一档。

**`input` / `textarea` / `select` 上不加任何字号类**：`index.css` 顶层的 `input,select,textarea { font-size: 16px }` 是 iOS 聚焦防缩放兜底（字号 <16px 时 Safari 会自动放大视口）。它是元素选择器，而 `.td-text-*` 是类选择器、特异性更高——加上去**会真的盖掉兜底**（三档 caption/label/body 分别是 12/13/15px，全在 16px 以下），聚焦放大随之回归。`check:design` 的 `input-font-size-override` 规则守着这条：命中即报，规则跨行认标签，落在普通元素上的字号类不受影响。

<a id="design-language-controls-s2"></a>

## 2. 图标（`components/Icon.tsx` → Phosphor）

- 全站图标走 `@phosphor-icons/react`，统一经 `components/Icon.tsx` 包装。
- `Icon.tsx` 导出 `IconProps` 与 `resolveIconWeight(size, weight?)`：按尺寸解析图标 weight（小尺寸用更重的字重保证可读）。
- 红线：不用 emoji 或散装图标库；新图标从 Phosphor 取，经 `Icon` 渲染。
- **`check:design` 的 `interactive-text-icon` 认一份穷举字符白名单**，源在脚本的 `INTERACTIVE_TEXT_ICON_CHARS` / `INTERACTIVE_TEXT_ICON_ENTITIES`，按用途分组：关闭勾选 `x × ✕ ✖ ✗ ✘ ✓ ✔`、尖角 `› ‹ ❯ ❮ ⌃ ⌄`、三角 `▲ ▼ ◀ ▶ ▴ ▾ ◂ ▸`、箭头 `← → ↑ ↓ ↔ ↕`、放大还原 `⤢ ⤡ ▢`、省略更多 `⋯ … ⋮ ...`、步进正负 `+ ＋ ➕ - − － ➖`、菜单星标 `☰ ★ ☆`，外加 `&times;` `&minus;` `&check;` `&hellip;` 等 HTML 实体。步进正负那组里 **`−` 是 U+2212 减号、`－` 是 U+FF0D 全角，都不是 ASCII `-`**，三个各自登记。
- **收录判据是「这个字符在 UI 里几乎只可能当图标用」**：真正的文字标点与数学符号刻意不收——`—`（破折号）、`–`（en dash）、`±` `÷` `≈` `•` 都会作为正文出现，收进来就是大面积误报。代价是白名单**穷举**：名单外的新符号一律放行，要么写的时候自觉走 Phosphor，要么事后补名单。所以这道闸是辅助不是保证。
- 匹配形态三种：同行 `>符号<`、同行 `{"符号"}`，以及**跨行的纯文本子节点**——`>` 与下一个 `<` 之间的内容整体就是一个符号（符号独占一行），或是只含伪装字符字面量的表达式（`{expanded ? "▢" : "⤢"}`）。跨行扫描用 `[^<>]*` 把匹配锁在一对尖括号之间，因此属性里的箭头函数 `=>` 与 `{t("x")}` 这类调用不会被当成子节点误报；表达式形态另排除括号 / 嵌套花括号 / 模板串。交互上下文取同行或前后 8 行内的 `<button` / `<a` / `<Link` / `<NavLink` / `role="button"` / `onClick=`，**测试文件不豁免**（测试夹具同样不许教错写法）。

## 3. 交互 hooks（`useConfirm` / `useActionToast` / `useLongPress`）

**`hooks/useConfirm.tsx`**

- `useConfirm` 替代 `window.confirm`：返回 Promise 的应用内确认（配 `ConfirmSheet`），便于本地化与 Android WebView 体验统一。
- 重复性提示一律走 `useConfirm` / `ConfirmSheet`，不直接调 `window.confirm/alert`。
- **`pending` 是单槽，新请求会顶替旧请求**：被顶替的那次**必须**解析为 `false`（视作取消），绝不能让它的 Promise 悬空。调用方常在 `await confirm(...)` 之后才做收尾动作（如 `useUnsavedChangesGuard` 要据结果调 `blocker.proceed()`/`reset()`），Promise 悬空会让那步永远不执行——路由守卫场景下的后果是 blocker 永久停在 blocked、全站无法导航，只能整页刷新恢复。

**`hooks/useActionToast.ts`**（配 `ActionToastBar`）

- 返回 `{ toast, showToast, clearToast }`，`ACTION_TOAST_DISMISS_MS = 6000` 是默认自动消失时长，可由参数覆盖。
- **再次 `showToast` 重置计时**（先 `clearTimeout` 再重新计），不是排队也不是叠加——后一条提示接管，前一条的倒计时作废。
- 卸载时 effect 清 timer；`clearToast` 同时清 timer 与内容，供"用户点了动作按钮，提示该立刻收"的路径调用。

**`hooks/useLongPress.ts`**

- 默认 `durationMs: 500` / `moveTolerancePx: 10`：按下起计时，任一轴位移超过容差即取消（`onPointerMove`），抬起或离开也取消。
- **`onContextMenu` 立即触发并 `preventDefault()`**：桌面右键与移动端系统长按菜单都走这条，先掐掉原生菜单再发同一个 `onTrigger`，所以两种输入方式落到同一个回调。
- `useLongPress` 用 ref 锁住 handlers **只在首次渲染建一次**，`onTrigger` 走 `triggerRef` 现读——所以传进去的回调可以每次渲染换新，不会让 handlers 重建、也不会读到旧闭包；但 `options` 只在首次生效，**运行中改 `durationMs` 不起作用**。纯函数 `createLongPressHandlers` 单独导出供直接测试。

## 4. CI 棘轮（`scripts/check-no-native-controls.mjs` → `pnpm check:ui`）

零依赖脚本，扫描 `packages/client/src/**` 的 `.{ts,tsx,js,jsx}`：

- **禁用模式**：`<select>`、`type="checkbox"`、`type="radio"`、`type="date"`、`type="time"`、`window.confirm(`、`window.alert(`，命中即 `exit 1` 并指明该用哪个自绘控件。
- **豁免**：`components/ui/**`（原子件本身）与 `*.test.*` 测试文件。
- **CI**：`.github/workflows/ci.yml` 有 `pnpm check:ui` 步骤（与 `check:design`、`check:test` 并列）。这道闸锁住表单控件不回退到原生。

> 注意：`check:ui` 只管**原生控件**。裸色、退役模块色、散装交互图标和业务 `font-mono` 由 [ratchets](ratchets.md) 的 `check:design` 棘轮检查；遗留旧债必须登记在 allowlist，并随 P1/P3/P4 迁移逐步删除。

## 5. 关键不变量 / 坑 / 红线

1. **功能代码不写原生表单控件**：一律用 §1 控件，否则 `check:ui` 失败。
2. **新增可交互控件 → 进 `components/ui/`**：既复用 token/无障碍封装，又自动落进棘轮豁免。
3. **图标只从 Phosphor 经 `Icon` 出**。
4. **确认/提示走 `useConfirm`/`ConfirmSheet`**，不碰 `window.confirm/alert`。
5. **触发器在 `transform` / `sticky` / `backdrop-filter` 容器里 → 弹层必须开 `portal`**：这些属性会给后代的 `position: fixed` 造出新的包含块，`Sheet` 的 `fixed inset-0` 会被父容器裁成一个小框而不是铺满视口。已知受影响的入口：速记页浮动日期气泡与顶部工具栏、`DateNav`、日记回顾 header。`portal` 默认关，避免给不受影响的弹层改变现有挂载与事件冒泡行为。

## 6. 模块速查

| 入口 | 职责 |
|---|---|
| `components/ui/{Checkbox,Switch,SegmentedControl,SelectSheet,ConfirmSheet,ConfirmDeleteButton,Sheet}.tsx` | 自绘控件词汇表 |
| `components/ui/{MonthCalendar,DateField,TimeField}.tsx` | 日期/时间自绘控件 |
| `components/ui/{PageHeader,PageBackButton,StatusBanner,EmptyState,LoadingState}.tsx` | 页面壳与状态原子件（非原生控件替代件，不进棘轮映射） |
| `components/Icon.tsx` | Phosphor 图标包装 + `resolveIconWeight` |
| `hooks/useConfirm.tsx` | 应用内确认弹层（替代 window.confirm） |
| `hooks/useActionToast.ts` | 带自动消失的操作反馈 toast 状态机（配 `ActionToastBar`） |
| `hooks/useLongPress.ts` | 长按/右键手势 handlers，纯函数 `createLongPressHandlers` 可直测 |
| `scripts/check-no-native-controls.mjs` | 无原生控件棘轮（`check:ui`，CI 强制） |

**测试**：`components/ui/{Checkbox,Switch,SegmentedControl,SelectSheet,ConfirmSheet,ConfirmDeleteButton,Sheet,MonthCalendar,DateField,TimeField,ActionToastBar,PageHeader,PageBackButton,StatusBanner,EmptyState,LoadingState}.test.tsx`、`components/Icon.test.tsx`、`hooks/{useConfirm.test.tsx,useLongPress.test.ts}`（`useActionToast` 无独立测试，靠消费方页面测试覆盖）。
