# Garmin 数据集成

TimeData 通过本模块从 Garmin Connect 抓取健康数据并直接写入数据库。

## 文件结构

| 文件 | 说明 |
|---|---|
| `garminFetch.py` | Python 抓取脚本，接收 CLI 参数，输出 JSON 到 stdout |
| `garminService.ts` | TypeScript 服务，管理 Python 子进程 + 定时任务 + 数据写入 |
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
