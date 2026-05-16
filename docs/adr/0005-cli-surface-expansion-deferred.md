---
type: adr
title: ADR 0005 — CLI 命令面扩展暂缓
status: Accepted
date: 2026-05-13
supersedes: []
relates-to:
  - docs/adr/0001-cli-as-only-write-path.md
  - docs/mics/2026-05-13-修复plan-低优先级.md L10
---

# ADR 0005：CLI 命令面扩展暂缓

## 背景

低优先级 plan L10 提议在 CLI 中加入：

- `timedata update --id <id> --start ... --end ... [...]`
- `timedata delete --id <id>`
- `timedata category-add --name ... --parent ...`
- `timedata import --file <jsonl>`

理由是把 ADR 0001（CLI 是 AI/脚本唯一写入路径）的范围扩到现有写入能力之外。当前只支持 `log`（创建 entry），AI/脚本想撤销错误记录或新增分类，必须绕到 Web UI 完成。

## 不立即实施的决定

四条命令都依赖**服务端先暴露受控端点**：

| CLI 命令 | 需要的 server 端点 | 状态 |
|---|---|---|
| `update` | `PATCH /api/entries/:id`（或受控 `POST /api/entries/:id`）+ overlap/未来时间校验 | 未实现 |
| `delete` | `DELETE /api/entries/:id` + tombstone + sync_seq 写入 | 未实现 |
| `category-add` | `POST /api/categories` + 两级限制 + 重名校验 + sync_seq 写入 | 未实现 |
| `import` | 受控 JSONL 入口（与 H8 方案 B 相同）+ confirm token + 全量校验 | H8 选了方案 A（删除 import 端点）|

把这四条端点同时设计、测试、灰度发布的工作量超过单次"低优清理周"的范围，且服务端要为 CLI 单独搭一遍 H7 那种 prepare/token 流程的写入校验链路。在没有强烈需求（目前只有一种推测用法："AI 撤销自己上一条错误 log"）之前，**保留范围、不扩**。

## 我们要在何时复审

任一条件触发就重新评估：

1. 用户在实际工作流里报告 `log` 之外的高频写入需求（最常见的是 `update` 或 `delete`）。
2. AI 调用 CLI 时反复因为缺命令绕到 Web UI（应能从 sync_logs 看到非 CLI device 写入暴增）。
3. 决定推进 [H8 方案 B](../mics/2026-05-13-修复plan-高优-C-安全与边界.md#方案-b升格为受控恢复) 复用 `import` 入口。

## 替代方案（已采纳）

在 CLI 层做到的小事，本次低优 plan 已经完成：

- `timedata version` / `--version`（L9）— 让脚本知道接的是哪个版本。
- `--format=human|json`（L9）— 让人工调试 CLI 更顺。
- 错误响应仍然是 JSON 形态，AI 解析路径不变。

对人工"撤销错误 log"的临时方案：

- Web 端进入设置 → 数据设置 → 数据洞察查到对应 entry 后在时间轴页删。
- 服务端管理员通过 `POST /api/data/reset/prepare` + `/api/data/reset` 流程作大范围回滚（仅作为最后手段）。
