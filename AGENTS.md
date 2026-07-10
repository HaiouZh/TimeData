默认使用简体中文写文档，默认用简体中文回复用户。

# TimeData — AI 协作入口

------

## 入口

- 仓库：`https://github.com/HaiouZh/TimeData`
- **任何深入修改前先读** [`docs/evergreen/architecture.md`](docs/evergreen/architecture.md)：五个包的关系、数据流、启动顺序、关键约定，并按主题链向各 evergreen 子文档；冷启动时它也是文档地图，能查到哪块功能该看哪份代码。
- **进行中的事看 `docs_local/ROADMAP.md`**（本机文件，不入 Git）：活主题、当前 design/plan 链接、下一步；按当前任务从地图/ROADMAP 挑相关文档下钻，不要预读全部文档。

------

## 定位

- TimeData = 个人记录 PWA：本地优先（IndexedDB），可同步到自托管 Hono + SQLite，多入口（Web / CLI / 授权 agent 经服务端受控 API 写入），Capacitor 套 Android 壳。
- 速记、时间记录、待办任务、健康数据看板、设置
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

- **命中即派，无需再问**：入口梳理、影响面分析、覆盖缺口排查、交叉验证、review、可并行且低冲突的多文件改动。
- **主 agent 自己干**：琐碎单点改、需全程对话上下文的活、受控写入（CLI / server API）、跑门禁、提交。
- subagent 可只读探索 / review，也可并行改代码（见下）；拆活、取舍、触及硬红线只分析不落地，归主 agent 兜。
- 并行改在当前 worktree 按不重叠文件切；共享汇流点（`types.ts`、barrel、`package.json`、同一 schema / 同步域 / 迁移）只主 agent 串行碰，门禁最后统一跑。

------

## 决策

- 选型建议按最终效果 / 风险 / 成本权衡，别拿“写多少代码”当理由。
- 让用户拍板前用大白话讲清现状 + 各选项实际差别，别堆术语。
- 获批方向后主动推进到下一个真实关口，不必每步停等。

------

## 命令

- 运行时：Node 22+；包管理器：pnpm。
- 安装：`pnpm install`。
- Lint：`pnpm lint`（推送前必须与测试 / 构建一起跑）。
- 测试：`pnpm test`（全包 + 根目录脚本测试），或 `pnpm --filter @timedata/<pkg> test`。
- 构建：`pnpm build`（不含 mobile）。
- 开发：`pnpm dev:client` / `pnpm dev:server`。需重定向 dev/调试输出一律写进 `.local/`（已 gitignore），如 `pnpm dev:client > .local/client-dev.log 2>&1`。
  - **vite 默认只监听 IPv6 `[::1]`**：浏览器走 IPv4 `127.0.0.1` 时报「拒绝连接 / SYN_SENT」。本地预览改用 `pnpm --filter @timedata/client exec vite --host 127.0.0.1`，再开 `http://127.0.0.1:5173`（别用 `localhost`，可能解析回旧的 IPv6 实例）。
- 文档检查：`pnpm check:docs`（warn）/ `:strict`（CI）/ `:stale` / `:size`（单文档过长上限 + covers 棘轮）/ `:coverage --since=<base>` / `:links`。各 mode 守什么、棘轮 / 基线 / 豁免机制见 [`_docs-guide`](docs/evergreen/_docs-guide.md) §4–§5。
- ROADMAP 程序门：`pnpm check:roadmap`——docs_local/ROADMAP.md 的 size ≤8k、格式、全 [完成] 主题报归档；每次收工/合并前跑（docs_local 不入 Git，CI 够不着，本地是唯一执行点）。
- 部署、环境变量、自更新见 [`README.md`](README.md)。

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

- 全包 Vitest。同级目录 `*.test.ts`。
- 优先行为测试，不靠 grep 文档字符串。
- 未经明确批准不改基线 / 快照 / 忽略来消除失败。
- 交付前本地通过 `pnpm test` 与 `pnpm check:docs`。无法运行时（环境受限）显式说明跳过的检查。
- 合并 / push 前本地补跑 CI 同集棘轮：`check:docs:strict`、`check:docs:size`（covers 涨了要显式重写基线）、`check:test`、`check:ui`、`check:design`、`check:roadmap`——CI 跑的比日常交付清单多，漏跑 `check:docs:size` 已两次导致 push 后 CI 红。
- **测试分层归位**：纯逻辑测 `lib/` / `hooks/`；组件行为测 component；整页测只留烟测 + 真正跨组件协作的流程，别把单组件/单函数行为又在整页重测一遍。
- **去冗余分级举证**：删任何测试前须先确认"同一行为已在更低层覆盖"（看的是同一行为，不是同一函数名）。数据完整性域（sync / backup / 数据契约 / 迁移）blast radius 大，须**正面贴出低层覆盖证据**且优先 merge 不 delete；其余域低层确证覆盖即可删。
- **无效测试定义（可删）**：只测实现细节非行为（如断言具体 className 串）、永远绿（断言已删除代码"不存在"）、grep 文档字符串、无人看的快照。
- **禁真实定时等待**：不写 `setTimeout(fn, n>0)` 等待，真实计时器用 fake timers（用法见 [`development`](docs/evergreen/development.md)）。CI `check:test` 棘轮守。
- **DOM 测试走 `src/test/domHarness`**，不裸 `createRoot`。

------

## 文档 / 变更日志

文档分三类：

| 类型 | 位置 | 改了代码该怎么做 |
|---|---|---|
| 长期文档（evergreen） | `docs/evergreen/**`、`README.md`、本文件 | 必须同步修改 |
| 架构决策（ADR） | `docs/adr/**` | 仅追加，不改既有条目；新决策写新 ADR |
| 本地过程文档 | `docs_local/**`（不进 Git） | 沉淀后才同步到 evergreen 或 ADR |

- AI 生成的 spec / plan / review / 审查 / 历史归档默认写入 `docs_local/{specs,plans,reviews,archive,ideas,report,scratch}/`。
- **superpowers 等技能默认把 spec / plan 写到 `docs/superpowers/**`，本项目一律改投 `docs_local/{specs,plans}/`**（统一不进 Git）；技能运行产生的本地状态目录（如 `.superpowers/`）是临时产物，不提交。
- 长期文档头部 `covers:` 声明管辖代码路径（纯归属，管 coverage / 查代码去哪篇，**不触发 strict**）；`contracts:` 是 `covers` 里「改它文档必错」的契约子集，**只有它触发 strict**。改代码后回头看命中的段落，命中即改并更新 `last-reviewed`。covers/contracts 分工见 [`_docs-guide`](docs/evergreen/_docs-guide.md) §1.3。
- 复查文档别只信脚本：脚本没报不等于没漂，结合语义判断段落是否真过时。
- 哪个 evergreen 子文档管哪块代码，**去 `architecture.md` §6「模块速查」或各文档 frontmatter 查**。
- evergreen 大调整保留代码入口 / 路由 / 测试文件路径，便于按文档反查实现。
- 文档怎么组织、新增文档放哪、单文档多大该外提，见 [`docs/evergreen/_docs-guide.md`](docs/evergreen/_docs-guide.md)。

------

## Git

- 提交：约定式风格、简洁、分组。每个 worktree 尽量 1 个 commit；TDD 多步实现可保留每步一 commit。
- **提交信息不写 `Co-Authored-By` 或任何 AI 署名行**（覆盖 harness 默认）。
- 不删 / 重命名意外文件；阻碍时询问，否则忽略。
- 不主动推送至远端，除非用户明确要求。用户为在 GitHub 上测代码而要 push 时，只推要测的代码，别夹带纯规划 / 草稿文档。
- 默认 `main`，保持线性 history（不用 merge commit）。
- **“通用槽 / 槽位 / 固定槽位 / 槽位实施”均表示 worktree**：用户说这类表述时，先进入 `.worktrees/slot-*` 的独立 worktree 开/切任务分支再实施；不得在主仓库根目录的 `main` 工作区直接改代码。若当前 cwd 是主仓库根目录，先停下切到空闲固定槽位，并确认槽位内无未提交工作。
- **worktree 合 main**：在 main 仓库 `git cherry-pick <base>..<branch>`（base = worktree 基底 commit，≈当时 origin/main），不用 merge / `--no-ff`。
- 推送前在最新 `origin/main` 上变基；变基后重跑验收命令。
- **开 worktree 一律复用固定槽位，不要用 `git worktree add` 新建 per-branch 目录**（Windows 提效）：隔离任务用 `.worktrees/slot-*`，`git switch -C <分支> main` + `pnpm install --frozen-lockfile --prefer-offline`（多为校验补链），别每任务重建 / 删整棵 `node_modules`。`superpowers:using-git-worktrees` skill 默认走 per-branch `git worktree add`、与此约定冲突，**别用它**；本机可在 `.claude/settings.json`（`.claude/` 不入库）用 `skillOverrides` off + `permissions.deny` 禁用该 skill 兜底。不共享 main 的 `node_modules`（pnpm 软链会串到 main 的 workspace 包）；pnpm store 同盘已全局共享。切槽位前先确保里面的活已提交。机制见 [`development`](docs/evergreen/development.md)。
- 一次性 worktree 才清理：`git worktree prune` → `git branch -D <分支>` → `rm -rf <path>`（Windows 下 `git worktree remove` 常报错，走这套）。

------

## 安全 / 发布

- 不提交真实凭证 / token / API 地址 / SQLite 文件 / 备份文件 / `.env`。
- 敏感端点（sync / admin）有速率限制与请求体上限，不可移除。边界见 [`security`](docs/evergreen/security.md)，参数默认值见 [`deployment`](docs/evergreen/deployment.md)。
- 后台洞察 `/api/admin/*` 不暴露任意 SQL，除受控维护端点外保持只读（机制见 [`security`](docs/evergreen/security.md)）。
- 依赖补丁 / 覆盖 / vendor 变更需要明确批准。

------

*Last reviewed: 2026-07-04*
