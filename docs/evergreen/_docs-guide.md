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

## 1.1 三层结构：地图 → 主题文档 → 子文档

evergreen 文档分三层，逐层只索引下一层，避免任何单层膨胀：

```text
architecture.md（地图）         第 1 层：只索引「主题文档」，不下探到具体文件
  └─ <主题>.md（主题文档）       第 2 层：拥有一个域 + 索引自己的子文档，目标 < 15k 字符
       └─ <主题>/<子>.md（子文档） 第 3 层：主题膨胀后外提的独立子簇，由主题文档索引
```

- **地图（architecture）**：只列主题文档与横切文档（文档登记簿），不索引子文档、不展开域字段细节。
- **主题文档**：一个域的稳定入口。承载定位、承上启下、核心 schema/不变量，并在“子文档索引”小节列出自己的子文档。**目标控制在 ~15k 字符以内**；超了就把一个独立子簇外提成子文档，而不是把正文写厚。
- **子文档**：放在子目录 `docs/evergreen/<主题>/<子主题>.md`。它仍是完整 evergreen 文档（带 `type/covers/last-reviewed`），但**由它的主题文档索引，不由 architecture 索引**。子文档顶部回链主题文档（`[health](../health.md)`）。

`covers:` 在三层间**单一归属**：一个代码文件原则上只进一份文档的 covers（共享契约/登记簿类文件可被多份消费域同时 cover，属有意为之）。主题文档外提子文档时，把对应 covers 一并迁到子文档。

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

域内膨胀先放在“深水细节”里缓冲；只有子主题同时满足三条，才外提成独立子文档：

1. 它的 `covers:` 独立成簇，不与母域其余部分交叉。
2. 体量过线：单文档 soft cap 约 15k 字符，hard cap 约 25k 字符；子主题段超过约 6k 字符时进入候选。
3. 它被独立编辑或引用，改它时通常不碰母域其他段落。

这些数字是治理参考值，不是机械铁律。三条一起满足，才说明拆出去会降低维护成本。

**外提动作**：把子簇移到 `docs/evergreen/<主题>/<子主题>.md`（子目录，见 §1.1），迁走对应 `covers:`，在子文档顶部回链主题文档，在主题文档的“子文档索引”小节登记。然后 `--write-size-baseline` 重写基线（新增子文档 + 缩小后的主题文档都要落基线）。architecture 登记簿**不**新增子文档条目——它只认主题文档。

健康域是这套切法的样例：[health](health.md)（主题）索引 [health/garmin-ingest](health/garmin-ingest.md)（抓取/导入管道）与 [health/charts](health/charts.md)（视图块配置/渲染）。

## 4. 体量棘轮

`pnpm check:docs:size` 负责长期文档体量棘轮：

- 现有文档先写入 `scripts/evergreen-size-baseline.json` 作为基线。
- 已在基线里的文档若字符数或 `covers:` 数量超过基线会报错。
- 基线必须覆盖当前全部 evergreen 文档；新增、删除或重命名 evergreen 文档后不更新基线会失败。
- 新文档必须先写入基线；soft / hard cap 只作为是否继续拆分的人工判断线。
- ADR 不参与体量棘轮；ADR 是决策记录，只追加，不在这里做拆分治理。

需要接受一次合理增长时，先确认增长来自真实职责扩展，再重写基线并在 PR 里说明原因。
