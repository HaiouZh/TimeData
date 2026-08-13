# 0024 退役健康子系统，功能移交独立项目 run-track；数据表与同步域保留

## 状态

已采纳（2026-07-29）

## 背景

健康子系统是 TimeData 里唯一"数据不由本人在本应用里产生"的域：佳明（Garmin）体征（心率 / HRV / 睡眠 / 压力）与跑步记录由服务端 Python 子进程定时抓取云端账号，落进 6 张表，再经 `/stats/health` 的指标引擎（`lib/healthMetrics/**`）、块引擎（`lib/healthBlocks/**`）、图表配置面板与佳明设置页消费。

它与 TimeData 的定位（个人**记录** PWA：本人主动写入的时间 / 待办 / 速记 / 日记）始终是两回事，并带来不成比例的持有成本：

- 服务端为它保留 Python 运行时（镜像里 pip 装 `garminconnect` + `garth`）、抓取脚本、凭据配置与定时器，是整个服务端唯一的子进程 + 外部账号依赖面。
- 客户端为它保留一整套只服务这一个域的引擎与页面（体量约占 client 页面代码的一大块），设计语言棘轮 allowlist 里也长期挂着它的旧债。
- 跑步分析这件事本身要的是配速 / 心率区间 / 训练负荷这类专用视图，与"时间预算"视角的统计页没有共用零件，做深只会继续往 TimeData 里堆一个平行产品。

同期独立项目 **run-track** 已把这条线接过去：它单独采集佳明数据、单独做跑步与体征分析，TimeData 的历史健康数据已完成导入。于是 TimeData 侧这套 UI 与抓取管线成了没有消费者的重复实现。

## 决策

**退役健康子系统的 UI 与采集管线，保留其数据层。**

删除：`/stats/health` 与 `stats/health/**`、健康图表配置面板、佳明设置页与 `SettingsHealthRangePage`、`lib/healthMetrics/**`、`lib/healthBlocks/**`、`healthRangeSetting.ts`、服务端 Garmin 抓取服务 / 健康 ingest 路由 / Garmin admin 路由、镜像里的 Python 运行时与抓取脚本，以及 `health.md` / `health/charts.md` / `health/garmin-ingest.md` 三份 evergreen 文档。

**刻意保留**（这是本决策的承重部分，不是没删干净）：

- 6 张表：`health_heart_rate` / `health_hrv` / `health_sleep` / `health_stress` / `runs` / `health_charts`（SQLite + Dexie 两侧）。
- 字段 schema `packages/shared/src/healthSchemas.ts` / `chartSchemas.ts` 与行映射 `healthRows.ts` / `chartRows.ts`。
- 6 个同步域的登记与 e2e 回环测试，以及 backup 的 bundled 健康域。

保留的理由是**协议兼容**：同步域登记簿是封闭契约，域一旦从登记簿消失，仍带健康数据的老设备 push 上来会被判为未知域而拒收，备份文件里的健康段也会在导入时失去落点——删域是破坏性变更，命中 AGENTS.md「边界 · Schema / 字段变更」红线，而它换来的收益只有几张空转表的存在感。历史数据继续留在库里、随 push/pull 与备份流转，只是没有 UI 读它。

退役前的完整代码状态钉在 tag `retire/health`（指向 `ffcd55cf`，已推远端），需要回捞任何一段实现从那里取。

## 被否决的替代方案

1. **冷藏死代码**（页面下线、代码留在仓里，路由摘掉）。否决：留下的是不再运行、不再被测试真实覆盖、也不会跟着重构一起改的代码，只会持续吃 lint / 类型 / 设计棘轮的预算，并在每次跨页重构时制造假工作量。"以后可能还要用"由 git tag 承接，不需要活体保存。
2. **归档到独立分支**（把健康代码切到 `archive/health` 分支长期悬挂）。否决：与 tag 相比没有额外能力——分支只是可移动的 tag，反而给"这条线还在演进"的错觉，也会在分支列表里长期占位。tag `retire/health` 是更诚实的表达。
3. **连同表和同步域一起删干净**。否决：见上，破坏性协议变更，收益不抵风险。
4. **把 run-track 反过来并进 TimeData**。否决：跑步分析是另一个产品形态（训练负荷、配速曲线、装备），并进来会把 TimeData 从"个人记录"推成"记录 + 运动分析"的双头产品，违反本仓定位里的"不做"清单精神。

## 后果

- TimeData 不再有任何健康 UI 入口；`/stats` 下只剩 `/stats/time`。相关反馈（"健康页没了"）是预期行为，不是缺陷。
- 服务端不再有 Python 子进程与外部账号凭据面，镜像不含 Python 运行时；启动序列里没有 Garmin 配置加载与抓取定时器。
- 6 个健康同步域与 6 张表继续存在且必须继续维护：改它们仍走完整 schema 变更红线（client / server / shared / sync / Dexie / 夹具一起对齐），不因"没人用"而放宽。现状描述见 [data-model](../evergreen/data-model.md) §1.1 与 [sync/domain-registry](../evergreen/sync/domain-registry.md) §2。
- 老设备 `settings` 表里残留的 `health.range.presets` 无消费方，不清理也无副作用。
- 图表色镜像 `chartColors.ts` 从健康域迁到 `pages/stats/`，只导出 `CHART_CHROME`；`--color-data-*` token 失去 JS 镜像消费方（见 [design-language/invariants](../evergreen/design-language/invariants.md) 第 5 条）。
