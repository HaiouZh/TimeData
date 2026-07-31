# 0027 退役失活 data palette，Track agent tone 归入业务作用域

## 状态

已采纳（2026-07-31）

## 背景

健康 UI 退役后，`--color-data-blue/teal/green/amber/red/purple` 六色 data palette 已没有图表消费方：TimeStats 的数据序列按用户分类色绘制，图表 chrome 只使用中性 token 的 JS 镜像。六支里五支只有定义、Styleguide 与测试，`data-purple` 则越界用于 Track 调度台表达“agent 在跑”。

这让 token 名称与真实职责相反：保留整组 data palette 不能提供生产能力，而 Track 的稳定业务信号借用了一个已失去 owner 的图表词汇。

## 决策

1. 整组退役 `--color-data-*`，Styleguide 不再展示 data palette，设计语言棘轮禁止重新定义或消费 `data-*` token 与 utility。
2. “agent 在跑”保留既有 `#a78bfa` 外观，但改由 `--color-track-agent` 承载。该 token 属 `business identity`，只表达 Track 调度信号，不是动作色、状态色、模块署名色或 Goal scoped 色。
3. 图表 chrome 继续使用 `CHART_CHROME` 中性镜像；数据序列继续使用用户分类色。`--color-tint-1..9` 与 Goal galaxy 的 scoped token、色值和职责均不变。
4. 全局 z-index 只保留 `dropdown/backdrop/modal/top` 四级；普通 sticky header 与画布 HUD 使用局部 `z-20`，不建立无生产消费的 `z-sticky`。

A 阶段完成后的 `@theme` 分账是 `core 38 / business identity 10 / Goal scoped 12 = 60`。后续收敛以每项有稳定语义、生产消费方和 owner 为准，总数只作审计，不设 `<50` KPI。

## 取舍

`--color-track-agent` 与现有 scoped 色可能拥有相同 hex，但同值不等于同义。复用 `--galaxy-*` 会让 Track 依赖 Goal 世界观；复用动作色或状态色会混淆“可操作/告警”和“agent 正在处理”。保留独立 owner 允许这些职责以后分别演进。

整组删除而非只删五支，是因为唯一剩余消费表达的是 Track 语义，不是数据序列；继续保留 `data-purple` 只会固化错误命名。图表未来若需要固定序列色，必须基于当时真实数据职责重新设计，不能把本次退役色板直接复活。

## 修订关系

本 ADR 修订 [ADR 0026](0026-content-tint-shared-palette-shape-distinguishes-type.md) 中“`--color-data-*` 与 `--color-tint-*` 两层同时存在、各自独立演进”的部分结论。ADR 0026 关于 tint 九色、形状分型、项目避撞与标签哈希的其余决策继续有效；其正文保留为历史，不改写。
