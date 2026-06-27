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
last-reviewed: 2026-06-27
---

# 设计语言

> 设计语言**主题文档**（非数据域，按“设计风格”轴成主题）：深冷工具基调的暗色视觉系统——五层颜色 token + 书卷体字体 + Phosphor 图标 + 自绘控件。
> 讲什么：五层颜色 token 体系、圆角/边框/阴影阶梯、字体栈、全站视觉红线。
> 不讲什么：自绘控件库与无原生控件棘轮（见子文档 [design-language/controls](design-language/controls.md)）、各功能页如何用这些 token（见各功能主题）。

## 承上启下

- **上游**：无（这是最底层的视觉/交互基座）。token 与全局样式集中在单一文件 `index.css`（Tailwind v4 `@theme static`）。
- **下游**：所有功能主题（[timeline](timeline.md)/[todo](todo.md)/[quick-notes](quick-notes.md)/[health](health.md)/[stats-insights](stats-insights.md)/[categories-settings](categories-settings.md)）的页面与组件都消费这些 token 和控件；它们只在「邻居」链接到本主题，不重复 token 定义。
- **契约**：颜色/圆角/字体 token 见本文 §1–§2（源在 `index.css`）；自绘控件契约见 [design-language/controls](design-language/controls.md)；图表取色见 [health/charts](health/charts.md)（recharts 镜像 token）。
- **邻居**：[design-language/controls](design-language/controls.md)（同主题子文档）、全部功能主题（消费方）。

## 1. 五层颜色 token 体系（`index.css` `@theme static`）

设计采用**五层**颜色，层层收窄使用面，避免“彩虹 UI”：

| 层 | token | 用途与红线 |
|---|---|---|
| **L1 中性底盘** | `--color-page` `--color-surface` `--color-surface-elevated` `--color-surface-hover`；文字 `--color-ink` `--color-ink-2` `--color-ink-3` | 暗色底盘 + 三级文字（均 ≥ WCAG AA）。绝大多数 chrome 只用这一层 |
| **L2 单一动作色** | `--color-accent` `--color-accent-strong` `--color-accent-soft` `--color-accent-ink`（蓝） | 全站唯一动作色。按钮/聚焦/主操作只用蓝，不引入第二动作色 |
| **L3 模块署名色** | `--color-mod-note`(青) `--color-mod-timeline`(紫) `--color-mod-todo`(蓝) `--color-mod-health`(绿) `--color-mod-settings`(灰) `--color-mod-track`(靛) `--color-mod-goal`(琥珀) `--color-mod-time`(天蓝) | **低饱和、小面积**：仅图标/署名点/选中态，**绝不上按钮或大色块** |
| **L4 状态色** | `--color-ok` `--color-warn` `--color-danger` + `*-soft` | 成功/警告/危险语义，soft 变体作软底 |
| **L5 数据色板** | `--color-data-blue/teal/green/amber/red/purple`（固定 6 色） | **仅图表/健康可视化**，不外溢到 UI chrome |

- **Goal 星图局部命名空间**：`--galaxy-edge` / `--galaxy-edge-glow` / `--galaxy-star-core` 只允许 `pages/goals/**` 的星图边、星核和光晕使用；它们不扩展全站动作色，也不替代 L2 `--color-accent`。
- **圆角阶梯**：`--radius-ctl`(8) / `--radius-row`(12) / `--radius-card`(16) / `--radius-pill`(999)。
- **边框**：`--color-border` / `--color-border-strong` / `--color-border-hairline`(rgba 8%)。
- **阴影**：`--shadow-elev1`（小表面）/ `--shadow-elev2`（浮层），仅大表面用。
- **派生软色**用 `color-mix(in srgb, <token> N%, transparent)`（如署名色 16% 软底），不另写裸色。

## 2. 字体（书卷体）

- `--font-body: "Times New Roman", "Tinos", "LXGW WenKai Screen", "KaiTi", "STKaiti", serif`——**西文在前、中文在后，逐字回退**：西文走 Times/Tinos，汉字落霞鹭文楷。
- `--font-mono`（JetBrains Mono…）只用于 `code/pre/kbd/samp`。
- 字体在 `main.tsx` 引入：**只引霞鹭文楷 GB 屏显子集** `lxgw-wenkai-screen-webfont/lxgwwenkaigbscreen.css`（约 4.7MB，避免 R 变体与重复字族撑大 APK）+ `@fontsource/tinos` 的 400/400-italic/700。`fontLoading.test.ts` 守 import 顺序（lxgw 在 tinos 之前）。
- 全站 `body` 用 `--font-body`；远程加载推迟到做字体设置时再上。

## 3. 关键不变量 / 坑 / 红线

1. **去裸色红线（约定，当前未机检）**：新 UI 一律用 token，不写裸 hex/rgba。**但尚无颜色棘轮脚本**，且 `index.css` 早期遗留段（`.stats-tab` / `.health-card` / `.run-item` / `.sleep-*` 等旧健康仪表盘样式）仍有大量裸 `rgba(255,255,255,…)`/裸 hex，属渐进迁移中——新代码勿照抄旧段。
2. **L3 署名色绝不上按钮/大面积**；**L5 数据色不外溢 UI chrome**（只在图表/健康可视化里）。
3. **无原生表单控件**：`<select>`/`type=checkbox`/`type=radio`/`window.confirm`/`window.alert` 一律用自绘控件——**CI 棘轮 `check:ui` 强制**（见 [design-language/controls](design-language/controls.md)）。
4. **图标统一 Phosphor**，经 `components/Icon.tsx` 包装（见子文档）；不用 emoji 或杂图标。
5. **recharts 不解析 CSS `var()`**：图表配色须把 token 镜像成 JS 常量（见 [health/charts](health/charts.md) 的 `chartColors`）。
6. **个别遗留实色**：如 `.cb-save` 文字色 `#022c22` 配 `--color-data-teal`，属待 Phase 收口的实色，勿当范式。
7. **横向溢出从组件源头收口**：全站 `<main>` 负责纵向滚动，交互组件若会产生临时横向位移（如 Todo 拖拽 / swipe 行），应在组件行容器或本主题全局规则里裁掉横向溢出，避免把页面撑出横向滚动面；纵向拖拽让位可单独放开。
8. **主导航纯图标**：移动底栏与桌面侧栏的主导航使用 Phosphor 纯图标；图标来自 `navRegistry`，用户配置只保存 route/placement，不保存 icon 名。主导航按钮必须有 `aria-label`，设置页配置界面可显示图标 + 文字。active/hover/focus 只消费现有 `page/surface/border/ink/accent` token，不为主导航单独引入裸色。
9. **设置壳与设置行复用 token 组件**：设置详情页外壳 `SettingsDetailPage` 使用 `page/surface/border/ink` token；设置首页的 `SettingsSection` / `SettingsRow` / `SettingsToggleRow` 只使用 `surface/border/ink/accent/mod-*` token，避免各设置入口重新引入旧 `slate-*` / 大圆角样式。

## 4. 模块速查

| 关注点 | 入口 |
|---|---|
| 全部颜色/圆角/边框/阴影/字体 token + 全局样式 | `packages/client/src/index.css`（Tailwind v4 `@theme static`） |
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
