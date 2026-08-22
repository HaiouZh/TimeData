# 派单事故日志（dispatch 七查回流入口）

> 每行一条：日期 单号/场景 现象 → 缺口。攒到主题收尾时把仍成立的提进 dev-conventions `_meta/adoption-log.md` 回流候选。
> 本文件 2026-08-21 补建——backlog 2026-08-20 条记录的「落点不存在」自此闭合；2026-08-20 临时记进安装版 runtime 的那条待搬回。

- 2026-08-21 x4a 收割复跑 · 主控复跑 `pnpm --filter client test` 挂死 36min（node 进程 CPU 仅 22s、vitest 无 TTY 偶发悬挂），taskkill 重跑即过 → 缺口：收割复跑长命令该带看门狗（挂 Monitor 观察日志增长，N 分钟零增长即杀重跑），skill 收割节可补一句。
- 2026-08-21 x4a 派单书 · 验收写 `biome check <files>`（含 format+organize-imports 域）而仓库门禁是 `biome lint .`（仅 lint 域），执行器被逼 `--write` 全文件重排出 163 行格式化衍生污染 diff → 缺口：聚焦 lint 的验收命令必须抄仓库 lint script 的真实口径，不许默认 `check`；「本项目落点」的门禁命令字段应含 lint 的准确调用形。
- 2026-08-21 y3-wire 首轮 · 执行器会话被外部中断（events 尾部 "Tool execution aborted"/interrupted:true）而 wrapper 退 0，结果单停在骨架、工作树半成品 184 行 → 假成功「65 形态」又一例：EXITCODE=0 + STATUS 停预填 BLOCKED + COVERAGE 全占位即判骨架；处置 = git restore 半成品 + 重派同单（events 轮转）。缺口：launch.sh 的 65 判据只查 RESULT.md 存在性，可考虑加「STATUS 仍为预填 BLOCKED 且必填字段含『待』」的骨架探测。
- 2026-08-22 kbd 三单批 第一轮三单同死于最终写入被上游掐断（末步 0 token、EXIT=0、REPORT 全丢）→ 缺口①：launcher 的 result_is_skeleton 过滤词只认「待填|TBD|<」，执行器半填 "pending/in progress" 即绕过续跑闸；缺口②：派单书模板未强制「逐命题增量落盘」，产出攒到最后一次写等于押全部产出于最脆的一步（第二轮加了该条款后同样被掐仍保住 P9/P10 全量）。
- 2026-08-22 kbd 三单批 同树并发三张「只读+写自己 .dispatch 目录」单，其一自述目击 4 个白名单外文件瞬时变 M 后自愈（blockerCandidates/TaskWaitingRow 两对）→ opencode 会话快照按工作树共享的已知互踩形态在纯分析单上也会现身；收割时 git status 已净、无实损，但「只读单同树并行安全」的边界应收窄为「连 .dispatch 都不写才算只读」。
- 2026-08-22 kbd 三单批 追记更正：上一条「快照互踩」归因错误。真相是同仓另有一个交互会话（timedata-e5）在并行改 blockerCandidates/TaskWaitingRow 四文件；ios-flash 执行器把它们当「非本任务的脏文件」跑了还原（SPEC_ISSUES 里自述「已还原至基线」——这是违规 git 写操作，收割六查当时只record未深究），调度方后来又 checkout 还原了一次，两次都误伤并行会话的在飞改动（该会话的 harness 会自动重写，实损有限；21:35 状态已存 .dispatch/ghost-blocker-changes-20260822.patch）。缺口③：派单前该查一眼本机有无同仓并行交互会话（ListAgents），有则派单书勿碰清单必须点名它们正在改的文件；缺口④：执行器自述里出现「已还原/已清理」字样应在六查按违规 git 写操作追查，而不是当背景噪音。
