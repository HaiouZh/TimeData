---
type: adr
status: accepted
date: 2026-06-03
---

# ADR 0011 — 写入边界从「CLI 唯一」放宽为「服务端受控 API」

## 状态

Accepted。修订 [ADR 0001](./0001-cli-as-only-write-path.md) 的“CLI 唯一写入路径”表述；不改 0001 原文，按新 ADR 追加约定。

## 背景

ADR 0001 规定 AI/脚本写入必须经 `timedata` CLI。新增的云端 agent quick note 投递需求中，CLI 只会是 server API 的 HTTP 薄封装：agent 经 CLI 调用和直连受控 server 写接口，最终校验、ID 分配、时间戳、`source` 标记、seq 记录都仍由服务端完成。强制多绕 CLI 这一跳不能增加数据完整性，却会增加云端 agent 部署负担。

## 决策

写入边界由“CLI 是唯一写入路径”放宽为“服务端受控 API 是写入边界”：

- 授权调用方（持 `AUTH_TOKEN` 的 agent/脚本）可直连受控 server 写接口，例如 `POST /api/quick-notes`。
- 保留 ADR 0001 的核心：服务端是最终裁判，所有写入必须经服务端 schema 与业务校验，由服务端分配或确认 id/seq/时间戳/来源标记，调用方不能绕过校验或直接操作 SQLite、IndexedDB、syncLog、备份或导出文件。
- CLI 仍是受支持的写入客户端之一，不再是唯一客户端。

## 理由

把校验集中在 server API 边界即可达成 ADR 0001 的数据完整性目标。CLI 的价值是给人、脚本和 AI 提供稳定命令界面；当调用方本身就是云端 agent 且能安全持有 `AUTH_TOKEN` 时，直连受控 server API 不扩大“绕过校验”的攻击面。

## 后果

- 新增 server 写接口即开放写能力，不要求同时新增 CLI 命令。
- 写入审计与安全审查围绕 server API 边界进行。
- CLI 文档必须区分“CLI 当前支持哪些写命令”和“受控 server API 允许哪些授权写入口”。
- 单 token 内网部署模型下，直连接口的滥用风险按 AGENTS 的“项目定位边界”评估为低。

## 链接

- 实现：`packages/server/src/routes/quick-notes.ts`
- 相关：[ADR 0001](./0001-cli-as-only-write-path.md)、[`docs/evergreen/sync.md`](../evergreen/sync.md)、[`docs/evergreen/cli.md`](../evergreen/cli.md)
