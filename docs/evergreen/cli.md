---
type: evergreen
title: CLI（受控写入入口）
covers:
  - packages/cli/**
  - packages/server/src/lib/entry-service.ts
  - packages/server/src/routes/entries.ts
  - docs/TimeData-CLI-AI.md
last-reviewed: 2026-05-21
---

# CLI（受控写入入口）

> CLI 是给**人 / 脚本 / AI**用的受控数据入口。它**只通过 HTTP API 操作**，不直接读写 SQLite/IndexedDB/备份文件。
> 这是项目最核心的红线之一，详见 [`adr/0001-cli-as-only-write-path.md`](../adr/0001-cli-as-only-write-path.md)。

## 1. 白名单命令

当前 CLI 只有以下白名单命令，其中 `log` 是唯一写数据的命令：

| 命令 | 是否写数据 | 作用 | API 调用 |
|---|---:|---|---|
| `timedata help [command]` | 否 | 输出 JSON 帮助、命令写入标记、AI 红线和相关文档路径 | 无，不读取配置 |
| `timedata doctor` | 否 | 检查配置、server 连通性和只读认证 | `GET /api/health`、`GET /api/categories` |
| `timedata categories` | 否 | 列分类（带路径，如 `投资/读书`） | `GET /api/categories` |
| `timedata list [--date YYYY-MM-DD]` | 否 | 列某天的时间记录（带分类路径、时长） | `GET /api/entries?date=...&format=cli` |
| `timedata log --start HH:mm --end HH:mm --category <path> [--date YYYY-MM-DD] [--note ...]` | 是 | 写一条时间记录 | `POST /api/entries` |
| `timedata version` / `--version` | 否 | 打印构建期烧入的版本号和 git sha（`TIMEDATA_CLI_VERSION` / `TIMEDATA_CLI_SHA` 环境变量） | 无，不读取配置 |

**任何不在这里的功能 = 不存在**。新增命令必须先在本地-only 的 `docs_local/plans/` 下放计划再实现；新增写入命令还必须先补受控 server API，并在落地后更新公开长期文档。扩 `update` / `delete` / `category-add` / `import` 的决定见 [`adr/0005-cli-surface-expansion-deferred.md`](../adr/0005-cli-surface-expansion-deferred.md)。

输出格式：`--format=json|human` 显式选择，未指定时根据 stdout 是否 TTY 自动判断（管道默认 JSON、终端默认 human）。所有命令的失败响应仍是 `{ ok: false, error: { code, message } }` JSON。

`timedata categories` 输出未归档分类及路径，并在 CLI 端稳定排序：先按所属顶层分类的 `sortOrder`、顶层分类 `id` 分组，再按当前项的 `sortOrder`、`name`、`id` 排序。即使服务器返回顺序变化，脚本看到的分类列表顺序也保持稳定。

## 2. 输入格式约定

- `timedata help` 和 `timedata help <command>`：不需要 server 配置；未知 topic 返回 `UNKNOWN_COMMAND`。
- `--help`：任意已知命令都可用，例如 `timedata log --help`，不需要 server 配置。
- `timedata doctor`：只读诊断；允许用 `--server`、`--token` 覆盖配置。**优先使用 `TIMEDATA_SERVER_URL` 和 `TIMEDATA_TOKEN` 做短期使用**，尤其是在共享机器上；配置文件适合稳定本机配置，但不建议把长寿命 token 长期留在共享设备上。
- `--date`：`YYYY-MM-DD`，缺省取本机日期（`todayLocal()`）。
- `--start` / `--end`：`HH:mm`（24 小时）。`end > start` 必须，否则 `INVALID_TIME_RANGE`；解析后的结束时间不能晚于服务端当前本地时间，结束时间等于当前时间允许。
- `--category`：传分类**路径**，例如 `投资/读书`。也支持单层（`投资`）但服务端会拒绝二级名称冲突的情况。
- `--note`：可选。
- `--server`、`--token`：可选，覆盖配置。
- `--format=json|human`：可选，显式指定输出格式；未指定时根据 stdout 是否 TTY 自动判断（管道/脚本默认 JSON，终端默认 human）。
- 所有 flag 支持 `--key value` 和 `--key=value` 两种长选项格式；不支持短横线 `-k`。

## 3. 配置优先级

`packages/cli/src/lib/config.ts` 的 `resolveConfig` 顺序（由强到弱）：

`TIMEDATA_SERVER_URL` / `TIMEDATA_TOKEN` 的优先级低于命令行 `--server` / `--token`，高于配置文件 `serverUrl` / `token`。环境变量是脚本和 CI 覆盖配置的主要入口；如果三者都存在，最终以命令行参数为准。

配置文件位置：

| 系统 | 路径 |
|---|---|
| Windows | `%APPDATA%\timedata\config.json` |
| Linux / mac | `$XDG_CONFIG_HOME/timedata/config.json` 或 `~/.config/timedata/config.json` |

格式：

```json
{ "serverUrl": "https://timedata.example.com", "token": "your-token" }
```

`serverUrl` 缺失即报 `CONFIG_MISSING`；格式必须能解析为 `http:` 或 `https:` URL，否则报 `CONFIG_INVALID`。token 缺失不会报错（私有服务器可能允许无 token）。配置文件读取后会用 runtime schema 校验：文件必须是对象，`serverUrl` / `token` 如果存在必须是字符串；未知字段保留但不参与配置解析。

在 unix（Linux / mac）下 `readFileConfig` 会先做权限检查：若配置文件的 mode 含任何 group / other 位（即 `mode & 0o077 !== 0`），直接返回 `CONFIG_INVALID` 并提示 `Config file permissions are too open`，**早于**任何 JSON 解析。建议把文件 chmod 到 `0o600`。Windows 下没有 POSIX 权限概念，跳过此检查。这条也解释了为什么 cli 单测里专门验证 JSON 解析失败的用例需要显式传 `"win32"` 平台参数。

## 4. 输出格式

CLI 默认输出 JSON 到 stdout，`process.exit(0/1)` 表示成功/失败。在 TTY 终端下（或显式传 `--format=human`）会输出人类可读的文本；在管道、重定向或显式传 `--format=json` 时输出纯 JSON。格式选择逻辑在 `packages/cli/src/lib/format.ts` 的 `resolveOutputFormat()` 中。

JSON 格式示例：

成功：

```json
{ "ok": true, "categories": [...] }
```

失败：

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_TIME_RANGE",
    "message": "End time must be later than start time"
  }
}
```

`doctor` 失败时返回分步骤检查结果：

```json
{
  "ok": false,
  "checks": [
    { "name": "config", "ok": true, "message": "Configuration resolved" },
    { "name": "server", "ok": false, "code": "NETWORK_ERROR", "message": "Network error: fetch failed" }
  ]
}
```

**这是稳定契约**：脚本依赖 `ok` 字段、`error.code` 枚举和 `doctor.checks[*].code`。新增错误码或改字段名要慎重。

### 4.1 已知错误码

CLI 自身校验产生：

- `MISSING_ARGUMENT`、`INVALID_DATE`、`INVALID_TIME_RANGE`
- `CONFIG_MISSING`、`CONFIG_INVALID`
- `UNKNOWN_COMMAND`

api-client 包装：

- `TIMEOUT`：请求超过默认 30 秒超时（测试可通过 `timeoutMs` 注入更短时间；底层 `requestJson()` 也支持注入 `setTimeoutImpl` / `clearTimeoutImpl`，便于稳定测试超时路径）
- `NETWORK_ERROR`：fetch 抛出的非超时网络错误
- `AUTH_FAILED`（HTTP 401）
- `HTTP_<status>`：非 401 HTTP 错误且响应不是 CLI/服务端标准 `{ ok, error }` 形状
- `INVALID_RESPONSE`：响应体不是合法 JSON；HTTP 204 / 空响应会明确报 `Server returned no JSON body`
- `SCHEMA_MISMATCH`：server 响应未通过 CLI 端 schema 校验，常见于客户端/服务端版本不匹配。`list` 命令对 `ok: true` 响应要求 `date`、`entries`、`summary` 都存在，并校验条目字段形状；`ok: false` 响应必须有 `{ error: { code, message } }`。先升级 CLI 到与 server 一致的版本；仍异常时运行 `timedata version` 与 `GET /api/version` 比对版本。

服务端 `entries` 路由产生（透传给 CLI）：

- `INVALID_DATE`、`INVALID_TIME_RANGE`、`CATEGORY_NOT_FOUND`、`CATEGORY_AMBIGUOUS`、`TIME_OVERLAP`、`INVALID_JSON`

## 5. 不允许做的事

CLI 严格**不能**：

- 直接读写 SQLite 数据库文件
- 直接读写 IndexedDB（CLI 是 Node 进程，本来也碰不到，但脚本里的浏览器代码也算）
- 读写 sync log
- 读写 Backup JSON 文件（导出文件）
- 通过 JSONL/CSV 导出文件回灌数据
- 绕过服务端校验做任何操作

如果某个新功能在 CLI 这边只用 server API 实现不了，**第一反应是补 server API 而不是给 CLI 开后门**。

## 6. 服务端配套

CLI 的 `doctor` 命令先调 `GET /api/health` 检查服务连通性，再调 `GET /api/categories` 验证只读认证是否可用。`doctor` 不写数据，也不直接访问底层存储。

CLI 的 `log` 命令最终落到 `packages/server/src/lib/entry-service.ts` 的 `createEntryFromCliInput`：

- 校验日期、时间格式
- 解析分类路径（`投资/读书` 或单层 `投资` 自动找叶子）
- 检查分类不存在（`CATEGORY_NOT_FOUND`）/ 路径多于一条匹配（`CATEGORY_AMBIGUOUS`）
- 检查同日时间段重叠（`TIME_OVERLAP`）
- 检查结束时间不能晚于当前 UTC 时间（`INVALID_TIME_RANGE`）
- 通过受控 `timedata log` 写入唯一数据入口；`help`、`doctor`、`categories`、`list`、`version` 都是只读
- 将本地日期+时间转为 UTC ISO（`localDateTimeToUtc()`），写入 `time_entries` 的 `start_time` / `end_time` 为 UTC 格式
- 写入成功后追加 `sync_seq(table_name='time_entries', action='create')`，刷新服务端 `sync_state` commit hash，让其他设备可通过 seq cursor 拉到 CLI 新增记录，且 `/api/sync/status` 可直接读到新的摘要
- 返回结果中的 `startTime` / `endTime` 转回本地时间（`utcToLocalDateTime()`）供 CLI 展示
- 分配 UUID

CLI 的 `list` 命令调 `listEntriesForCliDate`，返回带分类路径和时长的视图。这是和 `GET /api/entries`（不带 `format=cli`）不同的输出形状；普通 `GET /api/entries` 仍返回 `TimeEntry` 字段形态，服务端内部通过 row mapper 从 SQLite 的 snake_case 字段转换。CLI 端会对 `format=cli` 响应做 discriminated union 校验：成功响应必须带 `date`、`entries`、`summary`，其中条目的 `startTime` / `endTime` 是服务端转回的本地日期时间字符串（`YYYY-MM-DDTHH:mm:ss`），不是 UTC 存储格式。

## 7. 包与运行环境

`@timedata/cli` 是 Node ESM 包，`bin.timedata` 指向 `dist/index.js`。CLI 包声明 Node.js 22+，开发依赖包含 `@types/node`，并提供：

```bash
pnpm --filter @timedata/cli build
pnpm --filter @timedata/cli test
pnpm --filter @timedata/cli typecheck
```

`typecheck` 会先构建 `@timedata/shared`，再运行 `tsc --noEmit`；这是为了让全新 CI clone 中 CLI 通过 package `types` 字段读取到 `packages/shared/dist/index.d.ts`。发布或本地试用前仍需跑 `build` 生成 CLI 自身产物。

CLI 的 Vitest 配置把 `@timedata/shared` alias 到 `packages/shared/src/index.ts`，保证 CLI 运行时 schema 测试直接覆盖 shared 源码契约，而不依赖先构建出的 `packages/shared/dist`。

## 8. 加新命令的流程

1. 在本地-only 的 `docs_local/plans/` 下放计划，明确：命令名、输入、输出、对应 server API。
2. 如果需要新 API，先在 `packages/server/src/routes/` 实现 + 测试。
3. 在 `packages/cli/src/commands/` 加命令文件，遵守"输入校验在 CLI 这边浅做、最终判定走 server"。
4. 在 `packages/cli/src/commands/help.ts` 加入命令目录、`writesData` 标记和用法。
5. 在 `packages/cli/src/index.ts` 路由表里加 `if (command === ...)` 分支。
6. 加测试（参考 `commands/log.test.ts`、`commands/doctor.test.ts`、`index.test.ts`）。
7. 更新本文档第 1 节"白名单命令"表。
8. 更新 `docs/TimeData-CLI-AI.md`（给 AI 看的命令清单）。

## 9. 改这块代码前的清单

- [ ] 跑 `pnpm --filter @timedata/cli test`：覆盖 args、config、validation、help、doctor、categories、list、log 和 dispatcher。
- [ ] 跑 `pnpm check:docs`：确认长期文档命中项已同步处理。
- [ ] 改输出 JSON 形状：脚本可能在用，**改字段名是 breaking change**。
- [ ] 改错误码：要加不要删、不要重命名。删/改要明确说明 deprecate 路径。
- [ ] 改配置文件路径：要兼容旧路径迁移。
