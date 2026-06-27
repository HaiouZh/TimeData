---
type: evergreen
title: 健康 · Garmin 抓取与 ingest
covers:
  - packages/server/src/garmin/**
  - packages/server/src/routes/ingest.ts
  - packages/client/src/pages/settings/SettingsGarminPage.tsx
last-reviewed: 2026-06-27
---

# 健康 · Garmin 抓取与 ingest

> [health](../health.md) 的写入管道**子文档**：健康原始数据怎么进库。
> 讲什么：Garmin 定时/手动抓取、缺口补抓、HTTP ingest、Admin API、凭证加密、两条写路径的冲突调和差异。
> 不讲什么：5 指标表 schema 与同步登记（见 [health](../health.md)）、图表配置（见 [health/charts](charts.md)）。

## 承上启下

- **上游**：Garmin Connect（Python 子进程抓取）/ Admin API 手动触发 / `POST /api/health/ingest` 批量导入。
- **下游**：统一收口到 `safeParse → applyChange() → SQLite + sync_seq → notifySyncChange()`，之后交给 [sync](../sync.md) 下发。表 schema 见 [health](../health.md) §2。
- **邻居**：[health](../health.md)（主题）、[health/charts](charts.md)（同域另一子文档）、[security](../security.md)（凭证/token）、[deployment](../deployment.md)（运行时需 Python3 + garminconnect + garth）。

## 1. Garmin 自动抓取（定时任务）

```text
启动 loadGarminConfig() → enabled && schedule → updateSchedule()
  → scheduleNextFetch(): setTimeout 到 config.schedule(HH:MM)
  → 到点 resolveGarminFetchRange({}, config, getGarminDailyLatestDates(db), now)
      · noOp → 记审计，不抓
      · 否则 fetchGarminData(config, start, end, {trigger:"scheduled"})
  → execFile("python3", [garminFetch.py, --email/--password, --is-cn/--no-cn,
            --start, --end, --token-dir], {maxBuffer:50MB, timeout:600s})
  → garminFetch.py: garminconnect 登录(失败回退凭证登录+garth.dump)
            → 逐日调 5 个 API → 构建 camelCase 记录 → JSON 到 stdout
  → garminService 解析 JSON → 逐域 ingestGarminDomain: safeParse + applyChange()
  → notifySyncChange(latestSeq)（仅 seq 变化时）→ 客户端 SSE pull
  → 成功且非 noOp → setGarminLastFetchDate(endDate) → 递归 scheduleNextFetch 次日
```

**5 个 Garmin API → 域映射**（`garminFetch.py`，与 `garmin/README.md` 一致）：

| Python API | 数据域 | 构建函数 |
|---|---|---|
| `get_heart_rates(date)` | `health_heart_rate` | `build_heart_rate` |
| `get_hrv_data(date)` | `health_hrv` | `build_hrv`（`lastNightAvg` 失败回退 7 天平均关键词搜索） |
| `get_sleep_data(date)` | `health_sleep` | `build_sleep`（`adjustmentHours` 硬编码 0） |
| `get_user_summary(date)` | `health_stress` | `build_stress` |
| `get_activities_by_date(…, "running")` | `runs` | `build_run`（`is_running_activity` 按 typeKey 含 "run" 判断） |

**id 生成**：daily 表用 `deterministic_id(domain, date)` = `uuid5(NAMESPACE_URL, "timedata:{domain}:{date}")`（幂等）；`runs` 用 `"{date}T{startTime}"`（**非 UUID**，同日同时段重复抓取会冲突）。

**审计**：`recordGarminFetchAudit`（`garminService.ts`）写 `sync_logs (device='garmin', action='garmin_fetch', detail JSON, record_count)`，best-effort。status：`errors.length===0 → "success"`；`appliedTotal>0 → "partial_success"`；否则 `"failed"`。

## 2. 缺口补抓逻辑

`DAILY_HEALTH_DOMAINS`（`garminService.ts`）= `health_heart_rate / health_hrv / health_sleep / health_stress` 四个，**不含 `runs`**。`getGarminDailyLatestDates` 逐域 `SELECT MAX(date) WHERE COALESCE(sync_tombstone,0)=0`。`resolveGarminFetchRange` 三模式：

1. **自动**（无 start/end/days）：`end=昨天`；`start=各域最新日期+1 的最早者`；无数据时 `start=end-(initialBackfillDays-1)`；`start>end → noOp`。
2. **days**：1..90 整数，`start=end-(days-1)`，`end=昨天`。
3. **explicit dates**：`start<=end`、`end<=昨天`、含天数 `<=90`。

days 与 dates 不能组合；startDate/endDate 必须成对。`initialBackfillDays` 默认 7（`garminConfig.ts`），范围 1..30（超出回退 7）。自动任务不靠 `lastFetchDate` 推算窗口，`lastFetchDate` 只作状态展示。

## 3. 手动 ingest（HTTP 端点）

```text
POST /api/health/ingest { domain, records[1..1000] }
  → authMiddleware（Bearer Token）
  → IngestRequestSchema: domain ∈ {health_heart_rate, health_hrv, health_sleep, health_stress, runs}
  → 事务内逐条 safeParse + applyChange() → notifySyncChange(getLatestSeq())
  → 返回 { imported, updated, skipped:0, errors }
```

Garmin 服务内部**直接调 `applyChange()`，不经此端点**（`ingest.ts` 保留给脚本迁移历史数据）。`/api/health/ingest` **无 rateLimit**（rateLimit 只挂 `/api/sync/*` 和 `/api/admin/*`）。

## 4. Garmin Admin API

`/api/admin/garmin`（受 auth + rateLimit `ADMIN_RATE_MAX`/60s）：`GET /config`（password 掩码 `********`）、`PUT /config`（保存后按 `enabled && schedule` 调 `updateSchedule/stopSchedule`）、`POST /fetch`（验凭证 → 解析 range → noOp+审计 / 否则抓取）、`GET /status`、`POST /test`（今天日期触发 `trigger:"test"`）。客户端入口 `SettingsGarminPage.tsx`。

## 5. 凭证加密（`garminConfig.ts`）

- 凭证存 `server_config` 表，**不同步到客户端**。
- 加密 **AES-256-GCM**，密钥 = `sha256(process.env.AUTH_TOKEN || "default-dev-key")` 取 32 字节。
- **红线**：换 `AUTH_TOKEN` 后旧密文不可解密（`decrypt` catch 返回空串）；缺 `AUTH_TOKEN` 时用 `"default-dev-key"`，开发环境加密的凭证在生产无效。

## 6. 关键不变量 / 坑 / 红线

1. **Python 只抓取+格式化，不碰 SQLite**：`garminFetch.py` 只输出 JSON 到 stdout，所有 DB 写入在 TS 侧。
2. **两条写路径的冲突调和不一致**（footgun）：
   - `garminService.ingestGarminDomain`（`garminService.ts`）对 daily 表**按 date 复用已有 id**——若该 date 已有不同 id 的非 tombstone 行，复用现有 id 原地更新，避开 `UNIQUE(date)` 冲突。
   - `routes/ingest.ts` **直接用传入的 `data.id`，无此调和**——若 id 与已有 date 行的 id 不同，会撞 `UNIQUE(date)` 抛错并回滚整个事务。
   - 改任一写路径都要照顾这条差异。
3. **`runs` 不参与缺口判断**（`DAILY_HEALTH_DOMAINS` 不含 runs）。
4. **`SERVER_REPLICAS>1` 时 Garmin 定时器是单实例内存存储**（`garminService.ts` 模块级单例 `lastResult/isRunning/scheduledTimer/scheduledTime`）。当前启动警告文案只提 force-push token 与 sync stream listeners，**未明确提及 Garmin**。
5. **手动抓取上限 90 天，不能抓未来**。

## 7. 模块速查

| 入口 | 职责 |
|---|---|
| `garmin/garminService.ts` | 子进程管理 + 定时任务 + 写入（`fetchGarminData`/`ingestGarminDomain`/`resolveGarminFetchRange`/`getGarminDailyLatestDates`/`updateSchedule`/`recordGarminFetchAudit`/`getGarminStatus`） |
| `garmin/garminConfig.ts` | 配置读写 + 凭证 AES-256-GCM（`loadGarminConfig`/`saveGarminConfig`/`setGarminLastFetchDate`/`getServerConfig`/`setServerConfig`） |
| `garmin/garminRoutes.ts` | Admin API：`GET/PUT /config`、`POST /fetch`、`GET /status`、`POST /test` |
| `garmin/garminFetch.py` | 抓取脚本（5 个 `build_*`、`deterministic_id`） |
| `garmin/README.md` / `requirements.txt` | 模块文档 / Python 依赖 |
| `routes/ingest.ts` | `POST /api/health/ingest`（5 域 allowlist，1..1000 records） |
| `pages/settings/SettingsGarminPage.tsx` | 客户端配置/抓取设置页 |

**测试**：`garmin/garminService.test.ts`（`resolveGarminFetchRange` 7 case、`getGarminDailyLatestDates` 忽略 runs、`ingestGarminDomain` 冲突调和 2 case）、`garmin/garminRoutes.test.ts`（config 校验、fetch 验证、no-op+审计）。

> **测试缺口**：`garminFetch.py` 无自动化测试（靠 `/test` 端点人工验证）；`POST /api/health/ingest` HTTP 端点无测试（auth/allowlist/事务行为未覆盖，仅内部 `ingestGarminDomain` 有测试）。
