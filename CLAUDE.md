read [AGENTS.md](AGENTS.md)

## 验证命令

- 聚焦验证：`pnpm typecheck`、`pnpm --filter @timedata/<pkg> test`
- **收工 / 合并 / push 前一律 `pnpm gate`** —— 全量门禁唯一入口（17 步：lint、typecheck、全部 `check:*`、两端测试、构建），与 [AGENTS.md](AGENTS.md) 一致。

  **不要逐条列 `check:*` 命令代替它**：那种清单漏过 `pnpm lint`，让 lint error 两次走到合并前（2026-08-19 的块内 `var`、2026-08-20 的条件调用 hook），两次都是「列出来的验收项全绿、gate 一跑就红」。
