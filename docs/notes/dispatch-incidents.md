# 派单事故日志（dispatch 七查回流入口）

> 每行一条：日期 单号/场景 现象 → 缺口。攒到主题收尾时把仍成立的提进 dev-conventions `_meta/adoption-log.md` 回流候选。
> 本文件 2026-08-21 补建——backlog 2026-08-20 条记录的「落点不存在」自此闭合；2026-08-20 临时记进安装版 runtime 的那条待搬回。

- 2026-08-21 x4a 收割复跑 · 主控复跑 `pnpm --filter client test` 挂死 36min（node 进程 CPU 仅 22s、vitest 无 TTY 偶发悬挂），taskkill 重跑即过 → 缺口：收割复跑长命令该带看门狗（挂 Monitor 观察日志增长，N 分钟零增长即杀重跑），skill 收割节可补一句。
- 2026-08-21 x4a 派单书 · 验收写 `biome check <files>`（含 format+organize-imports 域）而仓库门禁是 `biome lint .`（仅 lint 域），执行器被逼 `--write` 全文件重排出 163 行格式化衍生污染 diff → 缺口：聚焦 lint 的验收命令必须抄仓库 lint script 的真实口径，不许默认 `check`；「本项目落点」的门禁命令字段应含 lint 的准确调用形。
- 2026-08-21 y3-wire 首轮 · 执行器会话被外部中断（events 尾部 "Tool execution aborted"/interrupted:true）而 wrapper 退 0，结果单停在骨架、工作树半成品 184 行 → 假成功「65 形态」又一例：EXITCODE=0 + STATUS 停预填 BLOCKED + COVERAGE 全占位即判骨架；处置 = git restore 半成品 + 重派同单（events 轮转）。缺口：launch.sh 的 65 判据只查 RESULT.md 存在性，可考虑加「STATUS 仍为预填 BLOCKED 且必填字段含『待』」的骨架探测。
