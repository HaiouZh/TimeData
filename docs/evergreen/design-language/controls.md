---
type: evergreen
title: 设计语言 · 控件库
covers:
  - packages/client/src/components/ui/**
  - packages/client/src/components/Icon.tsx
  - packages/client/src/hooks/useConfirm.tsx
  - scripts/check-no-native-controls.mjs
  - scripts/check-design-language.mjs
last-reviewed: 2026-06-27
---

<!-- 复核 2026-06-27（设计语言 P3）：check-design-language.mjs 新增「--shadow-* token 定义」与「图表色镜像文件」两处 bare-raw-color 跳过（详见 design-language §3），属 check:design 颜色范畴；交互图标规则（本控件子文档关注点）不变。 -->

# 设计语言 · 控件库

> [design-language](../design-language.md) 的**控件子文档**：自绘控件词汇表 + 图标包装 + 无原生控件 CI 棘轮。
> 讲什么：`components/ui/**` 各原子件、`Icon.tsx`、`useConfirm`、`check:ui` 棘轮，以及交互图标由 `check:design` 辅助防回退。
> 不讲什么：颜色/字体 token（见 [design-language](../design-language.md)）、具体功能里怎么用控件（见各功能主题）。

## 承上启下

- **上游**：[design-language](../design-language.md) 的 token（控件全用 token 取色/圆角/边框）。
- **下游**：所有功能页只用这些自绘控件，不写原生 `<select>`/checkbox/radio/`window.confirm`/`alert`。
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
| `ConfirmSheet.tsx` | `window.alert` / 危险确认 | 确认弹层 |
| `Sheet.tsx` | — | 底部抽屉基元（其它弹层复用） |

控件本身在棘轮豁免目录内（它们是对原生元素的合法封装），可以内部使用原生元素。

## 2. 图标（`components/Icon.tsx` → Phosphor）

- 全站图标走 `@phosphor-icons/react`，统一经 `components/Icon.tsx` 包装。
- `Icon.tsx` 导出 `IconProps` 与 `resolveIconWeight(size, weight?)`：按尺寸解析图标 weight（小尺寸用更重的字重保证可读）。
- 红线：不用 emoji 或散装图标库；新图标从 Phosphor 取，经 `Icon` 渲染。

## 3. 确认弹层（`hooks/useConfirm.tsx`）

- `useConfirm` 替代 `window.confirm`：返回 Promise 的应用内确认（配 `ConfirmSheet`），便于本地化与 Android WebView 体验统一。
- 重复性提示一律走 `useConfirm` / `ConfirmSheet`，不直接调 `window.confirm/alert`。

## 4. CI 棘轮（`scripts/check-no-native-controls.mjs` → `pnpm check:ui`）

零依赖脚本，扫描 `packages/client/src/**` 的 `.{ts,tsx,js,jsx}`：

- **禁用模式**：`<select>`、`type="checkbox"`、`type="radio"`、`window.confirm(`、`window.alert(`，命中即 `exit 1` 并指明该用哪个自绘控件。
- **豁免**：`components/ui/**`（原子件本身）与 `*.test.*` 测试文件。
- **CI**：`.github/workflows/ci.yml` 有 `pnpm check:ui` 步骤（与 `check:design`、`check:test` 并列）。这是“Phase 1 棘轮闸”——锁住表单控件不回退到原生。

> 注意：`check:ui` 只管**原生控件**。裸色、退役模块色、散装交互图标和业务 `font-mono` 由 [design-language](../design-language.md) §3 的 `check:design` 棘轮检查；遗留旧债必须登记在 allowlist，并随 P1/P3/P4 迁移逐步删除。

## 5. 关键不变量 / 坑 / 红线

1. **功能代码不写原生表单控件**：一律用 §1 控件，否则 `check:ui` 失败。
2. **新增可交互控件 → 进 `components/ui/`**：既复用 token/无障碍封装，又自动落进棘轮豁免。
3. **图标只从 Phosphor 经 `Icon` 出**。
4. **确认/提示走 `useConfirm`/`ConfirmSheet`**，不碰 `window.confirm/alert`。

## 6. 模块速查

| 入口 | 职责 |
|---|---|
| `components/ui/{Checkbox,Switch,SegmentedControl,SelectSheet,ConfirmSheet,Sheet}.tsx` | 自绘控件词汇表 |
| `components/Icon.tsx` | Phosphor 图标包装 + `resolveIconWeight` |
| `hooks/useConfirm.tsx` | 应用内确认弹层（替代 window.confirm） |
| `scripts/check-no-native-controls.mjs` | 无原生控件棘轮（`check:ui`，CI 强制） |

**测试**：`components/ui/{Checkbox,Switch,SegmentedControl,SelectSheet,ConfirmSheet,Sheet}.test.tsx`、`components/Icon.test.tsx`。
