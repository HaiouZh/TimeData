---
type: evergreen
title: 文档组织规则
covers:
  - scripts/check-evergreen-docs.mjs
  - scripts/check-evergreen-docs.test.mjs
last-reviewed: 2026-06-18
---

# 文档组织规则

> 这份文档讲 evergreen 文档怎么组织、何时新建、写到多大该外提。
> 它不承载业务域细节；具体代码入口和数据流仍回到各域文档。

## 1. 组织主轴

TimeData 的长期文档按 **域为主 + 少数横切** 组织。

- **域文档**：端到端拥有一个数据/能力域，跨包覆盖该域全部代码，例如 sync、backup、timeline、todo、quick-notes、health、stats-insights、categories-settings。
- **横切文档**：跨所有域的关注点或层，例如 architecture、data-model、development、deployment、security、cli。

新增文档先走两问：

1. 这是某一个数据/能力域的端到端说明吗？如果是，新建或归入域文档。
2. 这是跨所有域的关注点/层吗？如果是，并入对应横切文档，不另建同级文件。

文档组织不按包切。TimeData 的功能通常纵向穿过 client、server、shared、cli；按包切会让读者自己拼数据流，也会把 `covers:` 退化成整包级别。

## 2. 域文档骨架

新建域文档默认使用这个稳定头：

```markdown
---
type: evergreen
title: <域名>
covers:
  - <本域端到端代码路径>
last-reviewed: YYYY-MM-DD
---

# <域名>
> 一句话定位 + 讲什么 / 不讲什么

## 承上启下
- 上游：什么数据/事件流进来
- 下游：流向谁
- 契约：本域表 schema 见本文 §Schema；跨域约定见 [data-model](data-model.md)
- 邻居：相关域文档链接

## 1. 数据流
## 2. Schema / 契约
## 3. 关键不变量 / 坑 / 红线
## 4. 模块速查
## 深水细节
```

“承上启下”是必填块。它负责把独立文档重新缝回系统：上游是谁、下游是谁、字段契约在哪里、相邻文档有哪些。

## 3. 毕业阈值

域内膨胀先放在“深水细节”里缓冲；只有子主题同时满足三条，才外提成独立文件：

1. 它的 `covers:` 独立成簇，不与母域其余部分交叉。
2. 体量过线：单文档 soft cap 约 15k 字符，hard cap 约 25k 字符；子主题段超过约 6k 字符时进入候选。
3. 它被独立编辑或引用，改它时通常不碰母域其他段落。

这些数字是治理参考值，不是机械铁律。三条一起满足，才说明拆出去会降低维护成本。

## 4. 体量棘轮

`pnpm check:docs:size` 负责长期文档体量棘轮：

- 现有文档先写入 `scripts/evergreen-size-baseline.json` 作为基线。
- 已在基线里的文档若字符数或 `covers:` 数量超过基线会报错。
- 基线必须覆盖当前全部 evergreen 文档；新增、删除或重命名 evergreen 文档后不更新基线会失败。
- 新文档必须先写入基线；soft / hard cap 只作为是否继续拆分的人工判断线。
- ADR 不参与体量棘轮；ADR 是决策记录，只追加，不在这里做拆分治理。

需要接受一次合理增长时，先确认增长来自真实职责扩展，再重写基线并在 PR 里说明原因。
