---
type: evergreen
title: 设计语言 · 控件库
covers:
  - packages/client/src/components/ui/**
  - packages/client/src/components/Icon.tsx
  - packages/client/src/hooks/useConfirm.tsx
  - scripts/check-no-native-controls.mjs
  - scripts/check-design-language.mjs
contracts:
  - packages/client/src/components/ui/**
last-reviewed: 2026-08-02
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

`Sheet` 的 `portal?: boolean` 决定弹层挂在原地还是 `document.body`，默认 `false`（就地渲染）。`DateField` / `TimeField` 同样透传 `portal`。`DateField` 另有 `hideIcon?: boolean`（默认 `false`），供紧凑场景（速记滚动日期气泡）去掉日历图标只留文字。

面板的入场动画与 88vh 限高一并由 `index.css` 的 `.sheet-panel` 承载（顶层规则，优先级高于 utilities）：调用方传进来的 `className` 改不动限高，要调只能改那条 CSS。

`Sheet` / `TaskDetailSheet` 的面板底部内衬 `paddingBottom: var(--safe-bottom)`（安全区变量机制与 Android 壳清零见 [design-language](../design-language.md) §1）；`Sheet` 没有 px 偏移项，直接消费变量而非 calc 组成式。

`MonthCalendar` 的月历面板使用 `rounded-card`，日期格与导航按钮使用 `rounded-ctl`；圆角只表达控件与面板角色，不改变日期选择行为。

### 控件排版档

控件内文字一律用 `.td-text-*` 语义类，不写裸字号（由 `bare-text-size` 棘轮守，见 [design-language](../design-language.md) §3）。档位分工：

| 用途 | 档 |
|---|---|
| 控件标签、选项行、trigger 显示值、按钮文字 | `td-text-label` |
| 表单内联错误提示（贴着控件的那行红字） | `td-text-label` |
| 行内次级信息、徽标/胶囊、行副标题 | `td-text-caption` |
| 成段正文（`ConfirmSheet` 的 `body`）、整段说明、空态文案、浮层提示条 | `td-text-body` |
| 面板标题（`<h3>` 级）| `td-text-body font-semibold` |
| `Sheet` 标题、页面标题（`title` 渲染的 `<h2>`） | `td-text-title` |

错误提示归 `label` 而不是 `body`：它是控件的附属反馈，跟同一行的标签/按钮文字同档才不会比自己所属的行标题还大；独立成段的说明卡片与空状态才用 `body`。面板标题不落 `title`：页面标题已占 `title`(20px)，面板标题再落同档会让原本 24/16px 的两级层级塌成一档。

**`input` / `textarea` / `select` 上不加任何字号类**：`index.css` 顶层的 `input,select,textarea { font-size: 16px }` 是 iOS 聚焦防缩放兜底（字号 <16px 时 Safari 会自动放大视口）。它是元素选择器，而 `.td-text-*` 是类选择器、特异性更高，加上去会盖掉兜底并让聚焦时整页放大回归。这类元素上的字号声明本就不生效，正确做法是不写。

## 2. 图标（`components/Icon.tsx` → Phosphor）

- 全站图标走 `@phosphor-icons/react`，统一经 `components/Icon.tsx` 包装。
- `Icon.tsx` 导出 `IconProps` 与 `resolveIconWeight(size, weight?)`：按尺寸解析图标 weight（小尺寸用更重的字重保证可读）。
- 红线：不用 emoji 或散装图标库；新图标从 Phosphor 取，经 `Icon` 渲染。

## 3. 确认弹层（`hooks/useConfirm.tsx`）

- `useConfirm` 替代 `window.confirm`：返回 Promise 的应用内确认（配 `ConfirmSheet`），便于本地化与 Android WebView 体验统一。
- 重复性提示一律走 `useConfirm` / `ConfirmSheet`，不直接调 `window.confirm/alert`。
- **`pending` 是单槽，新请求会顶替旧请求**：被顶替的那次**必须**解析为 `false`（视作取消），绝不能让它的 Promise 悬空。调用方常在 `await confirm(...)` 之后才做收尾动作（如 `useUnsavedChangesGuard` 要据结果调 `blocker.proceed()`/`reset()`），Promise 悬空会让那步永远不执行——路由守卫场景下的后果是 blocker 永久停在 blocked、全站无法导航，只能整页刷新恢复。

## 4. CI 棘轮（`scripts/check-no-native-controls.mjs` → `pnpm check:ui`）

零依赖脚本，扫描 `packages/client/src/**` 的 `.{ts,tsx,js,jsx}`：

- **禁用模式**：`<select>`、`type="checkbox"`、`type="radio"`、`type="date"`、`type="time"`、`window.confirm(`、`window.alert(`，命中即 `exit 1` 并指明该用哪个自绘控件。
- **豁免**：`components/ui/**`（原子件本身）与 `*.test.*` 测试文件。
- **CI**：`.github/workflows/ci.yml` 有 `pnpm check:ui` 步骤（与 `check:design`、`check:test` 并列）。这道闸锁住表单控件不回退到原生。

> 注意：`check:ui` 只管**原生控件**。裸色、退役模块色、散装交互图标和业务 `font-mono` 由 [design-language](../design-language.md) §3 的 `check:design` 棘轮检查；遗留旧债必须登记在 allowlist，并随 P1/P3/P4 迁移逐步删除。

## 5. 关键不变量 / 坑 / 红线

1. **功能代码不写原生表单控件**：一律用 §1 控件，否则 `check:ui` 失败。
2. **新增可交互控件 → 进 `components/ui/`**：既复用 token/无障碍封装，又自动落进棘轮豁免。
3. **图标只从 Phosphor 经 `Icon` 出**。
4. **确认/提示走 `useConfirm`/`ConfirmSheet`**，不碰 `window.confirm/alert`。
5. **触发器在 `transform` / `sticky` / `backdrop-filter` 容器里 → 弹层必须开 `portal`**：这些属性会给后代的 `position: fixed` 造出新的包含块，`Sheet` 的 `fixed inset-0` 会被父容器裁成一个小框而不是铺满视口。已知受影响的入口：速记页浮动日期气泡与顶部工具栏、`DateNav`、日记回顾 header。`portal` 默认关，避免给不受影响的弹层改变现有挂载与事件冒泡行为。

## 6. 模块速查

| 入口 | 职责 |
|---|---|
| `components/ui/{Checkbox,Switch,SegmentedControl,SelectSheet,ConfirmSheet,Sheet}.tsx` | 自绘控件词汇表 |
| `components/ui/{MonthCalendar,DateField,TimeField}.tsx` | 日期/时间自绘控件 |
| `components/Icon.tsx` | Phosphor 图标包装 + `resolveIconWeight` |
| `hooks/useConfirm.tsx` | 应用内确认弹层（替代 window.confirm） |
| `scripts/check-no-native-controls.mjs` | 无原生控件棘轮（`check:ui`，CI 强制） |

**测试**：`components/ui/{Checkbox,Switch,SegmentedControl,SelectSheet,ConfirmSheet,Sheet,MonthCalendar,DateField,TimeField}.test.tsx`、`components/Icon.test.tsx`。
