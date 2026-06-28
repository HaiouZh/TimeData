---
type: evergreen
title: 健康数据
covers:
  - packages/shared/src/healthSchemas.ts
  - packages/shared/src/syncDomains.ts
  - packages/shared/src/types.ts:SyncChange
  - packages/server/src/db/schema.ts
  - packages/server/src/lib/healthRows.ts
  - packages/server/src/sync/domains.ts
  - packages/client/src/db/index.ts
  - packages/client/src/sync/clientDomains.ts
  - packages/client/src/pages/HealthStatsPage.tsx
last-reviewed: 2026-06-28
---

<!-- 复核 2026-06-20（M2 退役 turn）：本次改动触及共享 schema 文件（covers 命中），本域无 turn 字段，复核确认无需改动。 -->
<!-- 复核 2026-06-22（目标层 Phase 1）：新增 goals 域与 Dexie v10 触及共享登记簿 / db index covers；健康 6 域 schema、同步语义、备份角色均不变。 -->
<!-- 复核 2026-06-23（目标层 Phase 1.1）：Goal.members 修正触及共享类型、db index 与 server schema covers；健康 6 域 schema、同步语义、备份角色仍不变。 -->
<!-- 复核 2026-06-25（请求审计一期）：shared types 新增 AdminRequestLog* 只读导出，server schema 新增非同步运维表；健康 6 域 schema、同步语义、备份角色仍不变。 -->
<!-- 复核 2026-06-27（设计语言 P3）：HealthStatsPage 视觉收口（删旧死 CSS、范围按钮/页面壳 token 化、图表色走 chartColors 镜像）；健康 6 域 schema、同步语义、备份角色仍不变。 -->
<!-- 复核 2026-06-28（待办想法重力）：Task.weight / todo.gravity.v1 触及 shared schema、Dexie 和 server schema covers；健康 6 域 schema、同步语义、备份角色仍不变。 -->

# 健康数据

> 健康域的**主题文档**：5 张指标表 + 1 张视图块配置表（`health_charts`），由 Garmin 抓取或 HTTP ingest 写入，经同步下发到 `/stats/health` 渲染。健康数据**不参与时长统计**。
> 本文只讲：域定位 / 5 指标表 schema / 同步登记 / 跨子域红线 / 子文档索引。
> 抓取与导入管道见子文档 [health/garmin-ingest](health/garmin-ingest.md)；图表配置与渲染引擎见子文档 [health/charts](health/charts.md)。

## 承上启下

- **上游**：Garmin 定时/手动抓取，或受保护 `POST /api/health/ingest` 批量导入（详见 [health/garmin-ingest](health/garmin-ingest.md)）。
- **下游**：服务端 `safeParse → applyChange() → sync_seq → notifySyncChange()` 写入 → [sync](sync.md) 下发 → 客户端 Dexie 健康表 → `HealthStatsPage` 渲染（块配置/渲染详见 [health/charts](health/charts.md)）。
- **契约**：5 指标表 schema 在 `healthSchemas.ts`（见本文 §2）；视图块配置 `HealthChartConfigSchema` 在 `chartSchemas.ts`（**不在** `healthSchemas.ts`，详见 [health/charts](health/charts.md)）；跨域字段约定见 [data-model](data-model.md)。
- **邻居**：[stats-insights](stats-insights.md)（`/stats/time` 是平级页面，与 `/stats/health` 无文件交叠）、[tracks](tracks.md)（轨道可用 refs 指向 runs/健康记录但不拥有指标字段）、[sync](sync.md)（6 个健康域均 LWW）、[security](security.md)（凭证与 token）。

## 1. 数据流总览

```text
Garmin 定时/手动抓取 ─┐
HTTP /api/health/ingest ─┤→ safeParse → applyChange() → SQLite + sync_seq
                         │                              → notifySyncChange()
                         └──────────────────────────────────────┐
客户端 SSE pull → Dexie(healthHeartRate/Hrv/Sleep/Stress/runs/healthCharts)
              → HealthStatsPage → HealthBlockList 分发渲染
```

- 写入管道（抓取 / 缺口补抓 / ingest / Admin API / 凭证加密 / 冲突调和）→ [health/garmin-ingest](health/garmin-ingest.md)。
- `health_charts` 视图块配置、指标引擎与块渲染 → [health/charts](health/charts.md)。
- `health_charts` 是配置同步域，不是健康原始数据。
- `HealthStatsPage` 顶部范围 selector 消费 `health.range.presets` 的完整预设列表；默认 6 档（7/30/90/180/365/全部）在移动端允许换行，保证选项可见，不用隐藏滚动条承载不可发现的横向溢出。
- `HealthStatsPage` 的交互图标（如添加图表）经 Phosphor `Icon` 包装，按钮语义仍由 `aria-label` 承载，不使用字符图标。
- **`HealthStatsPage` 与健康图表已按 P3 收口**：旧 `.stats-tab` / `.health-card` / `.run-item` / `.sleep-*` 死 CSS 已删；页面壳与范围 selector 走 [design-language](design-language.md) 的中性 / `accent` / 状态 token（范围选中态用动作蓝 `accent`，**不用健康绿**，也不用退役 `mod-health`）；健康指标曲线（心率 / 睡眠 / 压力 / HRV / 配速）用**数据色板** `--color-data-*`、图表 chrome（axis/grid/tooltip/legend/cursor）用 `CHART_CHROME` 中性镜像，二者统一出自 `chartColors.ts`（见 [health/charts](health/charts.md)）。状态色只留给同步成功 / 缺数据 / 错误等真状态，不上指标曲线。

## 2. Schema / 契约（5 指标表）

健康原始数据 schema 在 `healthSchemas.ts`，SQLite 行映射在 `healthRows.ts`（手工 camelCase↔snake_case，无 ORM）。`health_charts` 的字段 schema 见 [health/charts](health/charts.md) §Schema。

| 域（SQLite 表） | Schema（`healthSchemas.ts`） | 关键字段（camelCase） | 唯一性 |
|---|---|---|---|
| `health_heart_rate` | `HealthHeartRateSchema` | restingHeartRate、min/max/avgHeartRate、last7DaysAvgRestingHeartRate | UNIQUE(date) WHERE tombstone=0 |
| `health_hrv` | `HealthHrvSchema` | hrvMs（int，NOT NULL） | UNIQUE(date) WHERE tombstone=0 |
| `health_sleep` | `HealthSleepSchema` | sleepStart/wakeTime（HH:MM）、adjustmentHours | UNIQUE(date) WHERE tombstone=0 |
| `health_stress` | `HealthStressSchema` | stress（int，NOT NULL） | UNIQUE(date) WHERE tombstone=0 |
| `runs` | `HealthRunSchema` | startTime、distanceKm、durationSeconds、averageHeartRate/Cadence/StrideM/… | **普通** INDEX(date)（同日可多跑） |

- 每表都有 `sync_seq` / `sync_tombstone` 列。Dexie 表名 `healthHeartRate`/`healthHrv`/`healthSleep`/`healthStress`/`runs`，索引 `"id, date"`。
- 建表在 `db/schema.ts`（含 `server_config` 与 6 张健康表）。

### 2.1 同步域登记（`syncDomains.ts`）

6 个健康域（`health_heart_rate`/`health_hrv`/`health_sleep`/`health_stress`/`runs`/`health_charts`）均 `conflictPolicy:"lww"`、`countsInStatus:false`（不进 `/api/sync/status` 公开业务计数）。服务端走 `simpleLwwDomain`（`sync/domains.ts`），**无 `validate`/`crossValidate`/`apply`**——对比 `time_entries` 有 `crossValidate: incomingEntryOverlap`，健康数据不参与重叠校验。客户端登记在 `clientDomains.ts`。

客户端启动时的 schema 归一 pass 同样遍历这些 `CLIENT_SYNC_DOMAINS`：只按 shared schema 补默认/剥孤儿并保留坏行，不写 `syncLog`，不改变健康域的 LWW 同步语义。

## 3. 关键不变量 / 坑 / 红线

1. **健康数据走服务端受控写入**（`applyChange` + `sync_seq`），不是新底层通道；任何脚本不得直接编辑 SQLite/Dexie/syncLog/备份/导出。
2. **健康数据不参与时间段重叠、分类统计、时长统计或 `/api/sync/status` 业务计数**（`simpleLwwDomain` 无 `crossValidate`）。
3. **`runs` 不参与自动抓取缺口判断**（`DAILY_HEALTH_DOMAINS` 不含 runs，详见 [health/garmin-ingest](health/garmin-ingest.md)）；“没有跑步”不等于数据缺失。
4. **凭证 AES-256-GCM 加密、密钥派生自 `AUTH_TOKEN`**：换 `AUTH_TOKEN` 后旧凭证不可解密。机制与影响详见 [health/garmin-ingest](health/garmin-ingest.md) §凭证。
5. **`health_charts` 已在运行时登记簿、静态 `SyncChange` 联合和 client/server 同步路径注册**；新增健康配置域仍要同步 shared/server/client 三端登记。
6. **force-push 只覆盖核心同步表**（分类、时间记录、设置、速记、待办），**不会清空或导入健康原始数据、`health_charts`、任务轨道或目标层**（见 [backup](backup.md)）。
7. **轨道 refs 不改变健康 schema**：跑步、HRV 等结构化指标继续留在健康域；轨道步骤只保存指针和叙事，不新增健康专用字段。
8. **`routes/admin/health.ts` 是后台系统健康检查，不属于本健康数据域**；不要因文件名相同把它归进 Garmin/健康契约。`GET /api/health`（公开探活）与 `POST /api/health/ingest`（受 auth）也只是命名巧合，语义无关。
9. **健康页视觉已按 P3 收口**：旧死 CSS 已删、健康图表 / 范围 selector / 页面壳全部 token 化，`P3-stat-health` allowlist 归零。健康 UI chrome 用中性 / `accent` / 状态色，指标曲线用数据色板，二者边界清晰；不使用 `mod-health`。新增健康 UI 一律用 token。

## 4. 模块速查（主题层）

| 关注点 | 入口 |
|---|---|
| 5 指标表契约 | `healthSchemas.ts`、`healthRows.ts`、`db/schema.ts` |
| 同步域登记 | `syncDomains.ts`、`sync/domains.ts`、`clientDomains.ts` |
| 客户端 Dexie + 页面壳 | `client/src/db/index.ts`、`HealthStatsPage.tsx` |
| 抓取/导入管道 | → [health/garmin-ingest](health/garmin-ingest.md) |
| 图表配置/渲染引擎 | → [health/charts](health/charts.md) |
| 代表测试 | `syncDomains.test.ts`、`db/schema.test.ts`、`HealthStatsPage.test.tsx`（整页烟测）；管道/图表测试见各子文档 |

## 子文档索引

| 子文档 | 拥有什么 |
|---|---|
| [health/garmin-ingest](health/garmin-ingest.md) | Garmin 抓取流程、缺口补抓、HTTP ingest、Admin API、凭证加密、两条写路径的冲突调和差异 |
| [health/charts](health/charts.md) | `health_charts` 视图块配置 schema、默认块、有效块组合、指标引擎（healthMetrics）、块数据层（healthBlocks）、范围设置 |

> 文档为何这样切（主题文档 + 子文档）、何时再外提，见 [_docs-guide](_docs-guide.md)。
