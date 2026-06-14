# Garmin 数据集成

TimeData 通过本模块从 Garmin Connect 抓取健康数据，并经服务端受控写入路径（`applyChange()` + `sync_seq`）进入健康数据域。

## 文件结构

| 文件 | 说明 |
|---|---|
| `garminFetch.py` | Python 抓取脚本，接收 CLI 参数，输出 JSON 到 stdout |
| `garminService.ts` | TypeScript 服务，管理 Python 子进程 + 定时任务 + 数据写入 |
| `garminConfig.ts` | Garmin 配置读写与凭证加密 |
| `garminRoutes.ts` | Admin API 路由（配置/触发/状态/测试） |
| `requirements.txt` | Python 依赖 |
| `README.md` | 本文件 |

## 依赖

- **Python 3**（Docker 镜像中已包含）
- **garminconnect**：非官方 Garmin Connect API 封装
- **garth**：OAuth 认证库（garminconnect 内部依赖）

## 认证流程

```
1. 首次登录：email + password → Garmin OAuth
2. 获取 OAuth token → 持久化到 /app/data/garmin_tokens/
3. 后续登录：优先使用缓存 token → 过期则自动用凭证重新登录
4. 凭证在 server_config 表中 AES-256-GCM 加密存储
```

## Garmin API 调用

每天调用 5 个 API，对应 5 个健康数据域：

| API 方法 | 数据域 | 说明 |
|---|---|---|
| `client.get_heart_rates(date)` | `health_heart_rate` | 静息心率、最低/最高/平均心率、7日均值 |
| `client.get_hrv_data(date)` | `health_hrv` | HRV 毫秒值（lastNightAvg 或 7日均值回退） |
| `client.get_sleep_data(date)` | `health_sleep` | 入睡/醒来时间 |
| `client.get_user_summary(date)` | `health_stress` | 平均压力值 |
| `client.get_activities_by_date(date, date, "running")` | `runs` | 跑步活动详情 |

## 抓取范围

自动任务不再依赖 `lastFetchDate` 推算窗口；`lastFetchDate` 只作为状态展示。服务端会读取 SQLite 中 4 个日汇总健康表的 `MAX(date)`：

- `health_heart_rate`
- `health_hrv`
- `health_sleep`
- `health_stress`

然后从最早落后的健康域下一天补到昨天。`runs` 不参与缺口判断，因为“没有跑步”不能代表数据缺失。

手动 `/api/admin/garmin/fetch` 支持三种请求：

| 请求体 | 行为 |
|---|---|
| `{ "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD" }` | 显式日期范围，最多 90 天 |
| `{ "days": N }` | 强制重抓最近 N 天到昨天，`1..90` |
| `{}` | 智能补齐到昨天；完全无健康数据时回填 `initialBackfillDays` 天 |

配置项 `initialBackfillDays` 存在 `server_config` 的 `garmin.initialBackfillDays`，默认 `7`，可配置范围 `1..30`。自动任务默认不抓今天，只补到昨天。

## 抓取结果与审计

每次抓取会生成 `runId`，返回结构化结果：

- `status`: `success` / `partial_success` / `no_op` / `failed`
- `counts`: 每个健康域实际写入条数
- `errors`: `{ code, message, domain?, date? }[]`
- `duration`: 毫秒耗时

服务端会输出 `[garmin]` 前缀的结构化日志，并 best-effort 写入一条 `sync_logs`：

- `device="garmin"`
- `action="garmin_fetch"`
- `detail` 包含范围、trigger、counts、errors、`latestSeqBefore/latestSeqAfter`

写审计失败只记录 warn，不影响主抓取流程。日志和审计不记录密码、token 或 Python stdout 原始数据。

## 数据格式

输出 JSON 使用 **camelCase** 字段名，与 TimeData shared schemas 一致。每条记录包含：
- `id`：确定性 UUID（基于 domain+date 的 UUID v5），保证幂等导入
- `createdAt` / `updatedAt`：UTC ISO 时间戳
- 各域特有字段（参见 `packages/shared/src/healthSchemas.ts`）

## 故障排查

### Token 过期
- **症状**：`GarminConnectAuthenticationError` 或 `Token login failed`
- **处理**：脚本会自动回退到凭证登录，无需手动干预
- **持续失败**：检查 Garmin 账号密码是否正确，或 Garmin 是否启用了二步验证

### 登录失败
- **中国区**：确保 `isCn` 设置为 true（默认）
- **国际区**：设置 `isCn` 为 false
- **Cloudflare 拦截**：garminconnect 库通过 garth 处理 TLS 指纹，如果被拦截需升级库版本

### API 变更
- Garmin 可能随时修改 API 响应结构
- HRV 的 7 日均值字段名不稳定，使用关键词搜索策略（见 `find_hrv_7day_average`）
- 跑步活动类型判断通过 typeKey 包含 "run" 来识别

### 脚本路径不存在
- **错误码**：`script_not_found`
- **处理**：Docker 环境优先检查 `/app/garminFetch.py`；开发环境检查 `packages/server/src/garmin/garminFetch.py` 是否存在
- **常见原因**：镜像未包含脚本、运行目录不符合预期，或构建产物旁缺少脚本文件

## 替换指南

如果 `garminconnect` 库不再可用：

1. **替换 Python 库**：修改 `garminFetch.py` 中的 `init_client()` 和 API 调用部分
2. **保持输出格式**：新库必须输出相同的 JSON 结构到 stdout
3. **保持 CLI 接口**：`--email`, `--password`, `--is-cn`, `--start`, `--end`, `--token-dir`
4. **替换候选**：
   - 直接调用 Garmin REST API（需自行处理认证）
   - Playwright/Puppeteer 模拟浏览器登录
   - 其他语言的 Garmin 库（但需修改 `garminService.ts` 的子进程调用）
5. **更新 `requirements.txt`**

只要 stdout 输出格式不变，`garminService.ts` 无需任何修改。

---

*Last reviewed: 2026-06-14*
