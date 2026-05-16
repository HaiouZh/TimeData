---
type: adr
status: accepted
date: 2026-05-08
---

# ADR 0001 — CLI 是 AI/脚本唯一的数据写入路径

## 状态

Accepted（已落地，CLI 网关在 Phase 4 完成，详见 `docs/upgrade-plan/phase-4-cli-mcp.md`）。

## 背景

TimeData 需要让 AI 助手、自动化脚本、第三方工具往里写数据（创建时间记录、查询分类等）。常见做法有几种：

1. **暴露写入数据库的能力**——给脚本一个能直接读写 SQLite 的方式（直接挂载文件、给个 Python 包装等）。
2. **暴露 IndexedDB**——通过浏览器扩展或脚本注入。
3. **改备份/导入文件**——脚本生成 JSONL 然后调 import。
4. **一个受控 CLI**——所有写入都走 server API 这一条路，由 server 做权威校验。

前三种都被排除了，原因如下。

## 决策

**所有 AI / 脚本 / 自动化的写入必须走 `timedata` CLI。CLI 通过 HTTP 调用 server API。直接修改数据库、IndexedDB、备份文件、导出文件都被禁止。**

具体表现：

- CLI 的命令是**白名单**：当前只有 `help` / `doctor` / `categories` / `list` / `log`，其中只有 `log` 写数据；加新命令必须先在 `docs_local/plans/` 立项，沉淀后的长期事实再同步到公开文档。
- CLI 内部不引入任何数据库依赖（`packages/cli/package.json` 的 `dependencies` 是空的），只有 fetch。
- 服务端 `/api/sync/push`、`/api/entries`、`/api/categories` 是受控 API 边界，所有校验在 server。
- 文档（`CLAUDE.md`、`docs/TimeData-CLI-AI.md`、本 ADR）反复强调，让 AI 看到就停。

## 理由

1. **数据完整性**：服务端的校验（时间段不重叠、分类存在、archived 检查、外键）是数据正确性的最后一道关。任何绕过 server 的路径都意味着这些规则形同虚设。
2. **边界清晰**：AI/脚本写入集中经过 server API，后续审计能力可以围绕这条边界建设；不允许通过底层文件绕过 server 的记录、日志和校验。
3. **AI/脚本天然不可信**：模型会幻觉、脚本会有 bug。受控接口的 surface area 越小，出问题的爆炸半径越小。
4. **避免格式漂移**：直接编辑数据库的脚本会假设 schema、假设 SQL 字段名、假设字典序时间格式。这些假设一变就破。走 API 至少由 server 自己负责"内 ↔ 外"映射。
5. **跨端一致**：以后无论是 Web、Android、新写的 iOS、桌面 Electron，写入路径都一样——服务器 API。

## 替代方案为什么被否

**直接给脚本读写数据库的能力**：等于把所有校验责任交给脚本作者。第一次写错就可能产生时间段重叠或孤儿引用，恢复要从备份来——而服务端备份本身就是"写入前快照"，这种循环依赖很危险。

**通过 IndexedDB**：浏览器存储不可见、不可移植、跨端不同步。让 AI 操作 IndexedDB 等于让它操作一个黑盒。

**改 JSONL/CSV 导入文件**：导入只是用户操作时的一种"恢复"路径，不应该被当作日常写入入口。把它包装成接口意味着所有数据要经过"序列化 → 文件 → 反序列化"，比直接 API 多一倍出错点。服务端曾经存在的 `/api/export/import` JSONL 写库接口已移除；服务器侧 `GET /api/export` 现在只负责导出。

## 后果

**正面**：

- AI 出错的影响只到 server 校验那一关，不会破坏底层数据。
- 写入路径集中在 server API，便于统一校验和后续审计建设。
- 客户端 / Android / 未来 iOS 都用同一组 API。

**负面 / 成本**：

- 加新写入功能必须**同时**改 server API 和 CLI，比单端改动多。
- CLI 用户必须能访问 server（设置 token、配 URL）——纯本地无服务器场景不可用。
- CLI 命令受白名单约束，加新命令需要走 plan 流程。

## 链接

- 实现路径：`packages/cli/`、`packages/server/src/routes/`
- 相关文档：[`docs/evergreen/cli.md`](../evergreen/cli.md)、[`docs/TimeData-CLI-AI.md`](../TimeData-CLI-AI.md)
- 历史阶段：`docs/upgrade-plan/phase-4-cli-mcp.md`
- 历史设计过程文档已迁入本地-only 的 `docs_local/`，公开仓库只保留本 ADR 与长期文档结论。
