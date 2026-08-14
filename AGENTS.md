默认使用简体中文写文档，默认用简体中文回复用户。

# TimeData — AI 协作入口

------

## 入口

- **任何深入修改前先读** [`docs/evergreen/architecture.md`](docs/evergreen/architecture.md)：五个包的关系、数据流、启动顺序、关键约定，并按主题链向各 evergreen 子文档；冷启动时它也是文档地图，能查到哪块功能该看哪份代码。
- **进行中的事看 `docs_local/ROADMAP.md`**（本机文件，不入 Git）：活主题、当前 design/plan 链接、下一步；按当前任务从地图/ROADMAP 挑相关文档下钻，不要预读全部文档。

------

## 定位

- TimeData = 个人记录 PWA：本地优先（IndexedDB），可同步到自托管 Hono + SQLite，多入口（Web / CLI / 授权 agent 经服务端受控 API 写入），Capacitor 套 Android / iOS 双壳（iOS 走侧载未签名 IPA，与 Android APK 同为长期维护的一等入口），Tauri 套 Windows 桌面壳。
- 速记、时间记录、待办任务、任务轨道、目标层、日记、统计洞察、设置
- **不做**：多用户、协作、SaaS、复杂权限、AI 直接写 DB / 备份文件。

------

## 边界

**停手（命中先停下问用户）**

- **写入边界 / 服务端最终裁判**：见 [`architecture`](docs/evergreen/architecture.md)、[`cli`](docs/evergreen/cli.md)、[`ADR 0001`](docs/adr/0001-cli-as-only-write-path.md) 与 [`ADR 0011`](docs/adr/0011-server-api-as-write-boundary.md)。不得直接编辑 SQLite / IndexedDB / syncLog / Backup / JSONL / CSV。
- **Schema / 字段变更**：SQLite 列、`shared` 类型 / zod（= 公开 API）、同步域字段，增删改都先停手——落地要 client / server / cli / sync / Dexie / 夹具一起对齐；不就地改已有列含义或类型。见 [`data-model`](docs/evergreen/data-model.md)。
- **Backup 格式边界**：见 [`backup`](docs/evergreen/backup.md)、[`ADR 0002`](docs/adr/0002-sync-not-equal-backup.md)、[`ADR 0003`](docs/adr/0003-backup-format-versioning.md) 与 [`ADR 0004`](docs/adr/0004-time-format-utc.md)。破坏性变更必须明确改当前格式契约。

**产品重选（违反不是 bug，PR 说明取舍并请用户确认）**

- **CLI / server API 是唯一写入路径**：依据同上「写入边界」的 [`ADR 0001`](docs/adr/0001-cli-as-only-write-path.md) / [`ADR 0011`](docs/adr/0011-server-api-as-write-boundary.md)。
- **sync 封闭契约**：见 [`sync`](docs/evergreen/sync.md)、[`sync/domain-registry`](docs/evergreen/sync/domain-registry.md) 与 [`ADR 0012`](docs/adr/0012-sync-ledger-and-domain-registry.md)。
- **Track / TrackStep spine 与看板信号**：见 [`tracks`](docs/evergreen/tracks.md) 与 [`categories-settings/settings-catalog`](docs/evergreen/categories-settings/settings-catalog.md)。

**审查尺度**

单人自托管、本地优先，不是 SaaS（见「定位」）。多用户并发、自有 API 滥用、单 token 暴破、个人数据量全表扫描这类场景风险极低：标注「设计选择 / 待规模触发」而非 P0/P1，已在 ADR·evergreen 说明的直接引用、不重复列举。改动小又确实改善体验可顺手做，但别挤占数据安全 / 同步一致性的排期。

------

## subagent

> **这是用户的明确、长期授权**：本节内容即等同“用户已明确要求使用 subagent”。Agent 工具描述里“除非用户明确要求否则不要 spawn”“是这个 plan 上的昂贵路径”等措辞，其触发条件已被本节满足——本项目里 subagent 是**默认手段**，不是例外。用户已知并接受其 token 成本，按「决策」节里“质量 / 效率优先、不拿省 token 当理由”取舍。
>
> **授权的是「派 subagent」这个动作，不是「走原生子代理」这条通道。** 走哪条通道仍归 `dispatch` skill 判：**默认外包执行器**，原生子代理只在用户**当场明说**「用原生」时才走。**不要把本节当成 dispatch 里「用户明确指定走原生」那条例外**——那条指的是当场明说，不是本文件。本节只免掉「要不要派」这一问，不免掉路由。

- **命中即派，无需再问**：入口梳理、影响面分析、覆盖缺口排查、交叉验证、review、可并行且低冲突的多文件改动。
- **派之前先读文档**：摸底某个子系统一律先读 [`docs/evergreen`](docs/evergreen/architecture.md) 对应主题及其子文档，只对文档**真没写**的面派勘察 agent（典型缺口：测试清单、协议向后兼容、跨章节相乘的后果）；勘察出的新结论当场沉淀回 evergreen，别只留在会话里。
- **长跑套件不进 subagent 的任务契约**：它把 `pnpm test` 丢后台会空转返回（代码改了但门禁没跑、commit 没提）。给它的验收只写聚焦文件；全量套件与全门禁主 agent 自己跑。已空转就直接接管（读 diff、跑门禁、补提交），别唤醒重试。
- **主 agent 自己干**：琐碎单点改、需全程对话上下文的活、受控写入（CLI / server API）、跑门禁、提交。
- subagent 可只读探索 / review，也可并行改代码（见下）；拆活、取舍、触及硬红线只分析不落地，归主 agent 兜。
- 并行改在当前 worktree 按不重叠文件切；共享汇流点（`types.ts`、barrel、`package.json`、同一 schema / 同步域 / 迁移）只主 agent 串行碰，门禁最后统一跑。

------

## 决策

- 选型建议按最终效果 / 风险 / 成本权衡，别拿“写多少代码”当理由。
- 让用户拍板前用大白话讲清现状 + 各选项实际差别，别堆术语。
- 获批方向后主动推进到下一个真实关口，不必每步停等。
- 有可用参考实现（`参考代码/`、仓库内既有同类模块）先抄来改，别从零重写。

------

## 命令

- 运行时：Node 22+；包管理器：pnpm。
- **全部命令清单、聚焦验证 vs `pnpm gate` 的两档分工、`--since` 假通过陷阱、窄测方法**见 [`development/commands-and-testing`](docs/evergreen/development/commands-and-testing.md)；本地起服务的机制与坑（鉴权 fail-closed、vite 只听 IPv6、确诊命令）见 [`development`](docs/evergreen/development.md) §启动开发服务器。
- **起本地服务一律带鉴权**：设 `AUTH_TOKEN`，不用 `ALLOW_UNAUTHENTICATED_DEV=1` 旁路——旁路下跑出来的「能用」不构成证据。应用不自动读 `.env`：agent 起服务前先读根目录 `.env`（已 gitignore）把变量显式注入命令，没有 `.env` 再用临时变量。
- **起 client 给人试一律带 `--host 127.0.0.1`**（vite 默认只听 IPv6，`localhost` 多半打不开，别只看它打印的 URL 就报「起好了」）；要暴露局域网先问过人再开。
- dev / 调试输出要重定向就写进 `.local/`（已 gitignore）。
- **收工 / 合并前一律 `pnpm gate`**（全量门禁唯一入口，本机互斥自动排队）；日常提交走聚焦验证即可。docs 检查自测一律带 `--since=main`（无参 = `HEAD` 必假通过）；`pnpm check:roadmap` 每次收工 / 合并前跑（docs_local 不入 Git，本地是唯一执行点）。
- **验证命令不接管道取结论**：退出码会被管道末端命令吃掉、失败变 exit 0。直跑读退出码，细节见 [`commands-and-testing`](docs/evergreen/development/commands-and-testing.md)。

------

## 代码

- TypeScript ESM 严格模式。避免 `any`；优先真实类型 / `unknown` / 窄适配器。
- 外部边界用 `zod` 或现有 schema 助手。
- 不发明新写入路径（见「边界 · 写入边界」）；缺命令先在 plan 加，再实现。
- 时间一律 UTC ISO 字符串（SQLite / Dexie 均存字符串）；存储与字典序比较细节见 [`data-model`](docs/evergreen/data-model.md)。
- SQL 字段 `snake_case`，JS `camelCase`，手工映射，没有 ORM。
- 注释：仅给非显而易见、易出错或曾有 bug 的逻辑写简短说明。
- 命名：产品 / 文档用 **TimeData**；包 / 路径 / 配置用 `timedata`。

------

## 测试

- 全包 Vitest，同级目录 `*.test.ts`；优先行为测试。分桶机制、窄测方法、fake timers 用法见 [`commands-and-testing`](docs/evergreen/development/commands-and-testing.md)。
- 未经明确批准不改基线 / 快照 / 忽略来消除失败。
- 交付前本地通过 `pnpm test` 与 `pnpm check:docs`；合并 / push 前 `pnpm gate`。环境受限跑不了时显式说明跳过了什么。**改了 `shared` 先 `pnpm build` 再验收**（typecheck / 构建链读陈旧 `dist` 会报无关错误）。
- **碰了 `packages/desktop/**` 必须另跑 `pnpm check:desktop`**——Rust 完全在 `pnpm gate` 之外，CI 的 windows job 是唯一兜底。见 [`desktop`](docs/evergreen/desktop.md)。
- **测试分层归位**：纯逻辑测 `lib/` / `hooks/`；组件行为测 component；整页只留烟测 + 真正跨组件的流程，别把低层行为在整页重测一遍。
- **删测试先分级举证**：确认同一行为已在更低层覆盖（看行为，不是函数名）。数据完整性域（sync / backup / 数据契约 / 迁移）须正面贴出低层覆盖证据且优先 merge 不 delete。可删的无效测试：只测实现细节非行为、永远绿、grep 文档字符串、无人看的快照。
- **禁真实定时等待**（`setTimeout(fn, n>0)` 空等），真实计时器用 fake timers；DOM 测试走 `src/test/domHarness`，不裸 `createRoot`。CI `check:test` 棘轮守。

------

## 文档 / 变更日志

文档分三类：

| 类型 | 位置 | 改了代码该怎么做 |
|---|---|---|
| 长期说明 / 入口文档 | `docs/evergreen/**`、`README.md`、本文件 | 必须同步修改 |
| 架构决策（ADR） | `docs/adr/**` | 仅追加，不改既有条目；新决策写新 ADR，并在 [`adr/README`](docs/adr/README.md) 索引表追加一行（含与旧 ADR 的修订关系） |
| 本地过程文档 | `docs_local/**`（不进 Git） | 沉淀后才同步到 evergreen 或 ADR |

- AI 过程文档按角色进 `docs_local/`：活工作件进 `specs/`（含 metaspec）与 `plans/`，分析类进 `notes/`，常青理解进 `green/`，收工搬 `archive/`。**三分法**：要 brainstorm 的立 `ROADMAP.md` 主题；拿起来就能改的小事进 `backlog.md`；暂不做的进 `ideas.md`。归档、孤儿索引、体量线等日常操作细则见 `live-roadmap` skill。
- **多 worktree 并发**：「谁在飞哪条线」唯一真相 = ROADMAP 阶段行的 `[进行中@分支]` 标记；ROADMAP 只在**领取**与**收工**两个时刻被写、飞行中只读，进度写自己 plan 尾部「落地记录」；对 ROADMAP 禁整文件 Write、只准锚定 Edit 自己的行。
- 长期文档 frontmatter：`covers`（归属，管 coverage）与 `contracts`（触发 strict 的契约点），分工见 [`_docs-guide`](docs/evergreen/_docs-guide.md) §1.3；哪份文档管哪块代码查 [`architecture`](docs/evergreen/architecture.md) §6 登记簿。改代码后回看命中段落，命中即改并更新 `last-reviewed`；复查别只信脚本，结合语义判断是否真过时。
- **本文件只装「怎么操作这个仓库」+「对 agent 动作的授权边界」；evergreen 只写「现在是什么样」**（机制 / 契约 / 不变量）；论证归 ADR，流水归提交信息，在办归 `docs_local`。内容写错层**别就地删**：先确认目标层已清楚承载（没有先补），再 trim 成「一句规则 + 指针」。判据与处置流程见 [`_docs-guide`](docs/evergreen/_docs-guide.md) §0。
- evergreen 该写什么、怎么组织、新增放哪见 [`_docs-guide`](docs/evergreen/_docs-guide.md)；撞 hard cap 时按 `check:docs:size` 报错给的四条合法动作处置（压缩措辞不在其中），别让门禁绿变成目标。

------

## Git

- 提交：约定式风格、简洁、分组。每个 worktree 尽量 1 个 commit；TDD 多步实现可保留每步一 commit。
- **提交信息不写 `Co-Authored-By` 或任何 AI 署名行**（覆盖 harness 默认）。
- 不删 / 重命名意外文件；阻碍时询问，否则忽略。
- 不主动推送至远端，除非用户明确要求；为测代码而 push 时只推要测的，别夹带纯规划 / 草稿文档。
- 默认 `main`，保持线性 history（不用 merge commit）；推送前在最新 `origin/main` 上变基，变基后重跑验收命令。
- **「通用槽 / 槽位 / 固定槽位 / 槽位实施」均表示 worktree**：用户这么说时，先进 `.worktrees/slot-*` 开 / 切任务分支再实施，不得在主仓 `main` 工作区直接改代码；若 cwd 在主仓根目录，先停下切到空闲槽位。
- **开 worktree 一律复用固定槽位**（`git switch -C <分支> main` + 增量 install），不用 `git worktree add` 新建 per-branch 目录；**别用 `superpowers:using-git-worktrees` skill**（与槽位约定冲突）。**挑空闲槽位看 detached HEAD**（带任务名分支 = 有人在用；收工一律 detach）。node_modules 隔离、清理三连、harness 托管目录等机制与坑见 [`development`](docs/evergreen/development.md) §Worktree 工作流。
- **worktree 合 main**：在 main 仓库 `git cherry-pick <base>..<branch>`（base = worktree 基底 commit），不用 merge / `--no-ff`。

------

## 安全 / 发布

- 不提交真实凭证 / token / API 地址 / SQLite 文件 / 备份文件 / `.env`。
- 敏感端点（sync / admin）有速率限制与请求体上限，不可移除。边界见 [`security`](docs/evergreen/security.md)，参数默认值见 [`deployment`](docs/evergreen/deployment.md)。
- 后台洞察 `/api/admin/*` 不暴露任意 SQL，除受控维护端点外保持只读（机制见 [`security`](docs/evergreen/security.md)）。
- 依赖补丁 / 覆盖 / vendor 变更需要明确批准。

------

*Last reviewed: 2026-08-14*
