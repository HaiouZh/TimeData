# TimeData CLI — AI 使用说明

> 这份文档写给 Claude/AI 编码助手。目标是让 AI 知道如何安全地通过 `timedata` CLI 或受控 server API 使用 TimeData，以及哪些路径绝对不能碰。

## 1. 规则卡片

- **写入 TimeData 数据只能通过服务端受控 API；CLI 是其中一个客户端。**
- **当前 CLI 允许 AI/脚本写入的日常命令是 `timedata log`（时间记录）和 `task-done/task-tag`（任务完成与 tags 回写）。**
- **授权 agent 可直连 `POST /api/quick-notes` 投递速记；CLI `notes` 仍只读。**
- **授权 agent 可直连 `/api/agent/tracks*` 写任务轨道（建轨道 / append 步骤 / 闭合当前步 / 改状态）；CLI 暂未提供轨道命令。端点契约与示例见 §6.7。**
- 写入前先用 `timedata categories` 确认分类路径；必要时用 `timedata list --date YYYY-MM-DD` 查看当天已有记录。
- 读取速记用 `timedata notes`；它是只读命令，不写 quick_notes。
- CLI 只通过 server HTTP API 工作，服务端做最终校验。
- 不要直接编辑 SQLite、IndexedDB、sync log、Backup JSON、JSONL/CSV 导出文件。
- 不支持的写入任务必须停下来说明限制，不要绕过 server API / CLI。
- CLI stdout 永远是 JSON；判断成功看 `ok`，失败看 `error.code` 或 `doctor.checks[*].code`。

## 2. 当前命令清单

| 命令 | 是否写数据 | 用途 |
|---|---:|---|
| `timedata help [command]` | 否 | 输出 JSON 帮助；不需要 server 配置。 |
| `timedata doctor` | 否 | 检查配置、server 连通性和只读认证。 |
| `timedata categories` | 否 | 列出未归档分类和分类路径。 |
| `timedata list [--date YYYY-MM-DD]` | 否 | 列出某天时间记录。 |
| `timedata log --start HH:mm --end HH:mm --category <path> [--date YYYY-MM-DD] [--note TEXT]` | 是 | 创建一条时间记录。 |
| `timedata notes [--date YYYY-MM-DD \| --from YYYY-MM-DD --to YYYY-MM-DD \| --recent --limit N]` | 否 | 读取速记。 |
| `timedata tasks [--kind pool\|recurring] [--done 0\|1]` | 否 | 读取任务。 |
| `timedata task-done --id ID` | 是 | 标记任务完成。 |
| `timedata task-tag --id ID --tags agent,idea` | 是 | 覆盖任务自由 tags。 |

## 3. AI 任务决策树

### 3.1 用户要补一条时间记录

1. 如果用户没有给日期，确认是否使用本机今天日期。
2. 运行 `timedata categories`，找到分类路径。
3. 如果时间段可能与已有记录冲突，运行 `timedata list --date YYYY-MM-DD`。
4. 运行 `timedata log --start HH:mm --end HH:mm --category <path> --date YYYY-MM-DD --note TEXT`。
5. 如果返回 `ok: true`，向用户说明已通过 CLI 写入。
6. 如果返回 `ok: false`，按第 5 节错误处理。

### 3.2 用户要查看记录或分类

- 查看分类：运行 `timedata categories`。
- 查看某天记录：运行 `timedata list --date YYYY-MM-DD`。
- 查看某天速记：运行 `timedata notes --date YYYY-MM-DD`。
- 查看最近速记：运行 `timedata notes --recent --limit 20`。
- 用户没有给日期时，说明 CLI 默认使用本机今天日期，或先向用户确认日期。

### 3.3 用户要修改、删除、批量导入、写入速记或从备份回灌

当前 CLI 不支持这些写入能力。AI 必须先区分任务类型：

- 如果是授权 agent 投递 quick note，可用 `POST /api/quick-notes`，请求必须带 `Authorization: Bearer <AUTH_TOKEN>` header，body 只提交 `text`、可选 `sourceLabel`、可选 `occurredAt`；服务端会强制 `source="agent"`。
- 如果是授权 agent 回写任务完成或 tags，优先使用 `AGENT_TOKEN` 调 `timedata task-done` / `task-tag`；这些命令只命中 `/api/agent/*` 的封闭动作集合。
- 授权 agent 记录长周期工作状态，可用 `AGENT_TOKEN` 调 `/api/agent/tracks*`：建轨道、append agent 步骤、闭合当前步、改轨道状态。请求体可带 `requestId` 防重发重复写入；完整端点、请求体字段与 curl 示例见 §6.7。仍不代表 AI 可直接写 DB。
- 如果不是已明确授权的 agent 集成，CLI 不能写入速记；用户可以用 Web UI，或先新增受控 server API / CLI 命令后再使用。
- 修改、删除、批量导入或从备份回灌仍不是日常 AI 写入能力。

无论哪种情况，AI 都必须遵守：

- 不能直接改数据库、IndexedDB、sync log、Backup JSON 或导出文件。
- 如果必须支持新的写入能力，需要先新增受控 server API；是否同步新增 CLI 命令按 ADR 0011 与产品入口决定。
- 用户也可以通过现有 UI 完成 CLI 不支持的操作。

### 3.4 配置或连接失败

1. 运行 `timedata doctor`。
2. 如果缺 server URL 或 token，让用户配置环境变量或配置文件。
3. 不要猜测 server URL、token 或认证方式。
4. 网络错误只说明诊断结果，不要判断数据是否已写入。

## 4. 配置方式

CLI 配置优先级由高到低：

1. 命令行 `--server` / `--token`
2. 环境变量 `TIMEDATA_SERVER_URL` / `TIMEDATA_TOKEN`
3. 配置文件 `serverUrl` / `token`

配置文件位置：

| 系统 | 路径 |
|---|---|
| Windows | `%APPDATA%\\timedata\\config.json` |
| Linux / macOS | `$XDG_CONFIG_HOME/timedata/config.json` 或 `~/.config/timedata/config.json` |

格式：

```json
{ "serverUrl": "https://timedata.example.com", "token": "your-token" }
```

AI 优先使用环境变量或配置文件，不要在可见命令行中暴露 token。只有用户明确提供临时 token 时，才使用 `--token`。

外部 agent 回写任务或任务轨道时可把 `TIMEDATA_TOKEN` 设置为 `AGENT_TOKEN`；该 token 只能调用 `/api/agent/*`，不能 sync、admin、export 或 force-push。

## 5. 错误处理

### 5.1 可以修正参数后重试

| 错误码 | 处理 |
|---|---|
| `MISSING_ARGUMENT` | 补齐缺失参数，必要时询问用户。 |
| `INVALID_DATE` | 改成 `YYYY-MM-DD`。 |
| `INVALID_TIME_RANGE` | 修正 `HH:mm` 格式或确认 `end > start`。 |
| `INVALID_REQUEST` | 检查互斥参数，如 `notes --recent` 不要和 `--date` 混用。 |

### 5.2 必须问用户或停止

| 错误码 | 处理 |
|---|---|
| `CATEGORY_NOT_FOUND` | 不要猜分类；运行 `categories` 后让用户选择。 |
| `CATEGORY_AMBIGUOUS` | 让用户选择完整分类路径。 |
| `TIME_OVERLAP` | 不要自动改时间；把冲突告诉用户。 |
| `CONFIG_MISSING` | 让用户配置 server URL。 |
| `AUTH_FAILED` | 让用户检查 token；不要猜 token。 |

### 5.3 只能做有限诊断

| 错误码 | 处理 |
|---|---|
| `NETWORK_ERROR` | 运行 `doctor` 或说明 server 不可达。 |
| `HTTP_<status>` | 报告状态码和 message，不绕过 CLI。 |
| `HTTP_INVALID_RESPONSE` | 报告响应异常，不假设写入成功。 |
| `UNKNOWN_COMMAND` | 查看 `timedata help`，不要发明命令。 |

## 6. 示例

### 6.1 查看帮助

```bash
timedata help
```

成功输出形状：

```json
{
  "ok": true,
  "command": "help",
  "commands": [
    { "name": "log", "writesData": true }
  ]
}
```

### 6.2 诊断连接

```bash
timedata doctor
```

成功输出形状：

```json
{
  "ok": true,
  "checks": [
    { "name": "config", "ok": true },
    { "name": "server", "ok": true },
    { "name": "auth", "ok": true }
  ]
}
```

### 6.3 补一条记录

```bash
timedata categories
```

```bash
timedata list --date 2026-05-08
```

```bash
timedata log --date 2026-05-08 --start 09:00 --end 10:30 --category "工作/编程" --note "实现 CLI help"
```

### 6.4 读取速记

```bash
timedata notes --date 2026-06-02
```

```bash
timedata notes --recent --limit 20
```

### 6.5 授权 agent 投递速记

```bash
curl -X POST "$TIMEDATA_SERVER_URL/api/quick-notes" \
  -H "Authorization: Bearer $TIMEDATA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text":"周报已生成","sourceLabel":"Hermes"}'
```

### 6.6 agent 给任务打 tags

```bash
TIMEDATA_TOKEN="$AGENT_TOKEN" timedata task-tag --id <taskId> --tags "agent,idea"
```

### 6.7 授权 agent 写任务轨道

轨道用于让 agent 记录长周期、易分支工作的状态线（设计见 [`docs/evergreen/tracks.md`](evergreen/tracks.md)）。CLI 暂无 track 命令，授权 agent 直连 `/api/agent/tracks*`，鉴权同其它 agent 端点：`Authorization: Bearer $TIMEDATA_TOKEN`（token 用 `AUTH_TOKEN` 或窄域 `AGENT_TOKEN`）。服务端强制 `source="agent"`，调用方不能覆盖。

端点（前缀 `/api/agent`）：

| 方法 | 路径 | body（✱必填 / 其余可选） | 行为 |
|---|---|---|---|
| POST | `/tracks` | `title`✱、`summary`、`refs`、`status`、`requestId` | 建轨道。`requestId` 作轨道 id 幂等，重发返回已有记录并标 `idempotent:true`。默认 `status:"active"`。 |
| POST | `/tracks/:id/steps` | `content`✱、`sourceLabel`、`startedAt`、`endedAt`、`refs`、`tags`、`requestId` | append `source="agent"` 步；**自动闭合上一开口步**（把它的 `endedAt` 设为新步 `startedAt`）。 |
| POST | `/tracks/:id/current-step/close` | `endedAt` | 只闭合当前开口步，不前进、不改轨道状态。 |
| PATCH | `/tracks/:id` | `title`/`summary`/`status`/`refs`（至少一项）、`closedAt` | 改状态或元信息；`status:"concluded"` 顺手闭合开口步。 |

字段说明：

- `startedAt` / `endedAt` 是 UTC ISO（`...Z`，毫秒精度）。省略 `startedAt` 用 server 当前时刻；`endedAt` 省略或 `null` 表示开口当前步。
- `refs` 是 `{ kind, id, label? }` 数组（如 `{"kind":"commit","id":"abc123"}` / `{"kind":"url","id":"https://..."}`），指向各领域的数据，轨道只存指针不存内容。
- `tags` 用于分类与 phase 分组，也是「轮到我」聚合的判据（见末尾说明）。
- `requestId` 同时是幂等键：建轨道时作轨道 id，append 步骤时作步骤 id。

判断成功看 `ok`。成功体形状例：`{ "ok": true, "track": {...}, "idempotent": false }`（建轨道）、`{ "ok": true, "step": {...}, "closedStep": {...}|null, "idempotent": false }`（append）。

错误码（顶层 `error.code`）：

| 错误码 | HTTP | 含义 / 处理 |
|---|---:|---|
| `INVALID_REQUEST` | 400 | body 不合法，或 `endedAt` 早于 `startedAt` / 开口步起点。修正参数后重试。 |
| `NOT_FOUND` | 404 | 轨道 id 不存在。先建轨道或核对 id。 |
| `CONFLICT` | 409 | `requestId` 已属于别的轨道；或 close 时该轨道无开口步。 |
| `AUTH_FAILED` | 401 | 按 `/api/agent/*` 通用规则处理，不要猜 token。 |

端到端示例：

```bash
TOKEN="$AGENT_TOKEN"; BASE="$TIMEDATA_SERVER_URL/api/agent"

# 建轨道（requestId 幂等）
curl -X POST "$BASE/tracks" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"requestId":"track-refactor-auth","title":"重构鉴权中间件"}'

# append 一步（开口当前步，带产物 ref）
curl -X POST "$BASE/tracks/track-refactor-auth/steps" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"sourceLabel":"codex","content":"梳理 token 校验路径","refs":[{"kind":"commit","id":"abc123"}]}'

# 再 append 一步 → 自动闭合上一步；打 待决策 让它进用户「轮到我」收件箱
curl -X POST "$BASE/tracks/track-refactor-auth/steps" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"sourceLabel":"codex","content":"AGENT_TOKEN 作用域要不要拆，等你拍","tags":["待决策"]}'

# 收束轨道（status=concluded 顺手闭合开口步）
curl -X PATCH "$BASE/tracks/track-refactor-auth" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"status":"concluded"}'
```

> 「轮到我」机制：active 轨道的**当前步** `tags` 命中用户配置的行动标签（默认 `等我` / `待决策` / `卡住`）时，会浮进 Web 端「轮到我」收件箱。agent 用 tag 把决策权交回给人，人在监控面拍板后，agent 再 append 后续步或 `PATCH` 改状态。

## 7. 反例清单

不要做这些事：

- 用 SQLite 客户端直接插入或修改 `time_entries`。
- 用 SQLite 客户端直接查询或修改 `quick_notes` 来绕过 CLI。
- 用浏览器脚本修改 IndexedDB。
- 修改 sync log 制造待同步记录。
- 修改 Backup JSON 后再导入来补数据。
- 修改 JSONL/CSV 导出文件作为写回通道。
- 为了绕过 `TIME_OVERLAP` 自动改变用户没有确认过的时间段。
- 为了绕过 `CATEGORY_NOT_FOUND` 自动创建、重命名或猜测分类。
- 在没有受控 server API 的情况下伪造“agent 写入”。

## 8. 相关文档

- 长期 CLI 契约：[`docs/evergreen/cli.md`](evergreen/cli.md)
- CLI 原始写入路径决策：[`docs/adr/0001-cli-as-only-write-path.md`](adr/0001-cli-as-only-write-path.md)
- 写入边界修订：[`docs/adr/0011-server-api-as-write-boundary.md`](adr/0011-server-api-as-write-boundary.md)
- 项目入口规则：[`../CLAUDE.md`](../CLAUDE.md)
