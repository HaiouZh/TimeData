# TimeData CLI — AI 使用说明

> 这份文档写给 Claude/AI 编码助手。目标是让 AI 知道如何安全地通过 `timedata` CLI 或受控 server API 使用 TimeData，以及哪些路径绝对不能碰。

## 1. 规则卡片

- **写入 TimeData 数据只能通过服务端受控 API；CLI 是其中一个客户端。**
- **当前 CLI 唯一允许 AI/脚本写数据的命令是 `timedata log`。**
- **授权 agent 可直连 `POST /api/quick-notes` 投递速记；CLI `notes` 仍只读。**
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
