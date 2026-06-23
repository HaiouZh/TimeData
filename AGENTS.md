默认使用简体中文写文档，默认用简体中文回复用户。

# TimeData — AI 协作入口

电报风格。仅列根层规则与**单一文档入口**。模块结构、数据流、启动顺序、文档地图均下沉到 `docs/evergreen/architecture.md`，不在本文件复述。

------

## 入口

- 仓库：`https://github.com/HaiouZh/TimeData`
- **任何深入修改前先读** [`docs/evergreen/architecture.md`](docs/evergreen/architecture.md)。它讲清楚五个包的关系、数据流、启动顺序、关键约定，并按主题链向各 evergreen 子文档。
- 冷启动/初次了解项目可查看文档地图：docs/evergreen/architecture.md；可以查到大部分功能该看看哪份代码。

------

## 定位

- TimeData = 个人记录 PWA：本地优先（IndexedDB），可同步到自托管 Hono + SQLite，多入口（Web / CLI / 授权 agent 经服务端受控 API 写入），Capacitor 套 Android 壳。完整定位与五包关系见 [`architecture`](docs/evergreen/architecture.md) §1。
- 速记、时间记录、待办任务、健康数据看板、设置
- **不做**：多用户、协作、SaaS、复杂权限、AI 直接写 DB / 备份文件。

------

## 硬红线（违反 = 数据损坏 / 安全风险 / 不可控写入，先停下问用户）

- **写入边界是服务端受控 API**：用户在 Web 端 → Dexie；脚本/AI/agent 经 server API（CLI 是其中一个客户端，授权 agent 也可直连受控写接口）→ SQLite，服务端做权威校验并分配 id/seq/时间戳。AI 不直接编辑 SQLite / IndexedDB / syncLog / Backup JSON / JSONL / CSV 导出文件。详见 [`ADR 0001`](docs/adr/0001-cli-as-only-write-path.md) 及其修订 [`ADR 0011`](docs/adr/0011-server-api-as-write-boundary.md)。
- **服务端是最终裁判**：时间合法性、分类存在性、重叠、认证最终判定在 `packages/server/`。client / CLI 校验只为体验，不可让 server 跳过。
- **SQLite schema 不就地改已有列含义**：新增表 / 列 / 索引可走兼容迁移；改列类型或语义必须写一次性迁移代码。
- **Backup 格式破坏性变更必须明确改当前格式契约**：当前 `timedata.backup`（`timeFormat: "utc"`）；不维护旧 Backup 格式兼容路径。
- **`参考代码/` 只读**，可借鉴思路，不直接 import 进 `packages/`。

------

## 软约束（产品定位选择，AI 可在 PR 里提出取舍）

- **CLI 本质是 server API 的受控简化封装**，不是新写入通道。
- **sync 的 `SyncPushReasonCode` 与同步域登记簿都是封闭契约**：扩展前先停下，扩展步骤与影响面见 [`sync`](docs/evergreen/sync.md) 与 [`ADR 0012`](docs/adr/0012-sync-ledger-and-domain-registry.md)。
- **任务轨道 `Track`/`TrackStep` schema 是封闭契约**：spine 已冻结，新领域数据靠 `refs`（`Ref{kind,id,label?}`）/`tags` 扩展，**不给 spine 加领域 typed 字段**（如 `commitSha`/里程/waiting）；agent 写轨道只经 `/api/agent/tracks*` 受控端点、`step.source` 恒 `agent`（人手 `source:"user"` 步是另一条路径）。破例 = 回 spec 重议，依据见 [`tracks`](docs/evergreen/tracks.md)。
- **轨道看板信号协议**：轨道标签首先是步骤检索辅助；其中配置为“看板信号”的少数标签会进入 `/tracks` 顶部聚合。默认看板信号为 `待我处理` / `agent在做`。派活给 agent 时若提供 `trackId`，人手可先 append 一步打 `agent在做`；agent 完成或需要人接手时必须经 `/api/agent/tracks/:id/steps` append 一步并打 `待我处理`（或用户当前配置中的等价看板信号）。服务端会自动闭合上一条开口步；看板按 active 轨道最近一条带看板信号的步骤推导，无标签步骤和普通检索标签不清信号。

软约束的违反不是 bug，是产品重选；在 PR 描述里说明并请用户确认，不机械遵守。

------

## 项目定位边界（审查时务必代入场景判断）

本项目是**单人自托管、本地优先**工具，不是 SaaS。下列场景在当前部署模型下风险极低，不应作为数据安全或紧急安全项排期：

- 多用户并发写入（如 sync-logs 并发、备份 manifest 并发、SQLite busy_timeout）
- 自有 API 滥用（如 sync push 批量上限、entries 查询参数滥发）
- 暴力破解单 token（默认部署在内网或 DNS 不公开）
- IndexedDB 个人级数据量下的全表扫描性能

审查发现此类问题时，应：
1. 标注“设计选择”或“待数据规模触发再优化”，不要列为 P0/P1
2. 在 ADR 0007 或对应 evergreen 文档中已有说明的，直接引用，不重复列举
3. 若确实改善体验且改动小，可顺手做；但不要为此挤占数据安全 / 同步一致性的修复排期

------

## AI 协作 / subagent

派 subagent 加速并提质，挑**可并行、低冲突、可独立验收**的活：代码入口梳理、影响面调查、测试/文档覆盖缺口、方案交叉验证、review。冷启动有成本，琐碎活自己干。

- **默认 subagent 只读探索 / reviewer**；拆活、汇总、取舍、改文件、写入命令、跑门禁、提交归主 agent。
- **并行实现就在当前 worktree**：可按**不重叠文件**切给多个 subagent 同时改，不必另开 worktree。底线——同一文件，及共享汇流点（`shared/src/types.ts`、barrel 出口、`package.json`、同一 schema / 同步域 / 迁移链路）只能主 agent 串行碰；门禁等全部落地后统一跑。
- 触及硬红线范围的，subagent 只分析建议，落地按本文件红线由主 agent 受控执行。
- 大任务先并行侦察（入口 / 测试文档覆盖 / 风险各一路）→ 主 agent 合成 plan 再做；完成后安排独立 reviewer pass（数据安全、同步一致、测试、文档契约）。

------

## 命令

- 运行时：Node 22+；包管理器：pnpm（仅用仓库默认值，未经审批不替换）。
- 安装：`pnpm install`。
- Lint：`pnpm lint`（推送前必须与测试 / 构建一起跑）。
- 测试：`pnpm test`（全包 + 根目录脚本测试），或 `pnpm --filter @timedata/<pkg> test`。
- 构建：`pnpm build`（不含 mobile）。
- 开发：`pnpm dev:client` / `pnpm dev:server`。需重定向 dev/调试输出时一律写入 `.local/`（已 gitignore，仅保留 `.gitkeep`），如 `pnpm dev:client > .local/client-dev.log 2>&1`；不要把 log 散落到仓库根目录。
- 文档影响：`pnpm check:docs`（warn）/ `pnpm check:docs:strict`（CI，改了被覆盖代码须同步文档）/ `pnpm check:docs:stale`。
- 文档体量：`pnpm check:docs:size`（棘轮，要求 baseline 覆盖当前全部 evergreen，且字符数 / `covers:` 不超过基线；合理增长或文档增删需重写 `scripts/evergreen-size-baseline.json` 并说明原因）。
- 文档覆盖：`pnpm check:docs:coverage --since=<base>`（新增 `packages/*/src/**` 源文件必须被某文档 covers 认领，否则失败；测试/`.d.ts`/mock/夹具/story 已豁免）。
- 文档链接：`pnpm check:docs:links`（evergreen 内部 `.md` 互链不得指向不存在的文档）。
- 部署、环境变量、自更新见 [`README.md`](README.md)。

------

## 代码

- TypeScript ESM 严格模式。避免 `any`；优先真实类型 / `unknown` / 窄适配器。
- 外部边界用 `zod` 或现有 schema 助手。
- **改 `packages/shared/src/types.ts` = 改公开 API**：必须跨 client / server / cli 三端检查。
- 不发明新写入路径。需要 AI 写入就走 CLI 或 server API；缺命令先在 plan 加，再实现。
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
- **测试分层归位**：纯逻辑测 `lib/` / `hooks/`；组件行为测 component；整页测只留烟测 + 真正跨组件协作的流程，别把单组件/单函数行为又在整页重测一遍。
- **去冗余分级举证**：删任何测试前须先确认"同一行为已在更低层覆盖"（看的是同一行为，不是同一函数名）。数据完整性域（sync / backup / 数据契约 / 迁移）blast radius 大，须**正面贴出低层覆盖证据**且优先 merge 不 delete；其余域低层确证覆盖即可删。
- **无效测试定义（可删）**：只测实现细节非行为（如断言具体 className 串）、永远绿（断言已删除代码"不存在"）、grep 文档字符串、无人看的快照。
- **禁真实定时等待**：测试不写 `setTimeout(fn, n>0)` 等待。组件真实计时器用 `vi.useFakeTimers` + `advanceTimersByTime`（`shouldAdvanceTime` 可保留 `setTimeout(0)` 让位）；只为让位 Dexie / 渲染异步用 `setTimeout(0)` 的宏任务边界。CI `check:test` 棘轮闸守，存量在 `scripts/test-hygiene-baseline.json`。
- **DOM 测试走 `src/test/domHarness`**，不裸 `createRoot`（统一清理 + 收口 unmount，CI `check:test` 守存量棘轮）。

------

## 文档 / 变更日志

文档分三类，处理方式不同：

| 类型 | 位置 | 改了代码该怎么做 |
|---|---|---|
| 长期文档（evergreen） | `docs/evergreen/**`、`README.md`、本文件 | 必须同步修改 |
| 架构决策（ADR） | `docs/adr/**` | 仅追加，不改既有条目；新决策写新 ADR |
| 本地过程文档 | `docs_local/**`（不进 Git） | 沉淀后才同步到 evergreen 或 ADR |

- AI 生成的 spec / plan / review / 审查 / 历史归档默认写入 `docs_local/{specs,plans,reviews,archive,ideas,scratch}/`。
- **superpowers 等技能默认把 spec / plan 写到 `docs/superpowers/**`，本项目一律改投 `docs_local/{specs,plans}/`**（统一不进 Git）；技能运行产生的本地状态目录（如 `.superpowers/`）是临时产物，不提交。
- 长期文档头部 `covers:` 字段声明管辖代码路径。改代码后回头看 `covers` 是否命中，命中即改对应段落，并更新 `last-reviewed`。
- 哪个 evergreen 子文档管哪块代码，**去 `architecture.md` 第 6 节"模块速查"或各文档 frontmatter 查**，不在本文件维护。
- evergreen 大调整保留代码入口 / 路由 / 测试文件路径，便于按文档反查实现。
- 文档怎么组织、新增文档放哪、单文档多大该外提，见 [`docs/evergreen/_docs-guide.md`](docs/evergreen/_docs-guide.md)。

------

## Git

- 提交：约定式风格、简洁、分组。每个 worktree 尽量 1 个 commit；TDD 多步实现可保留每步一 commit。
- 不删 / 重命名意外文件；阻碍时询问，否则忽略。
- 用户说 `commit`：只提交本次变更。`commit all`：分组提交所有变更。`push`：可先 `git pull --rebase`。
- 不主动推送至远端，除非用户明确要求。
- 默认 `main`，保持线性 history（不用 merge commit）。
- **worktree 合 main 的标准做法**：在 main 仓库内 `git cherry-pick <base>..<branch>`（`<base>` 是 worktree 创建时的基底 commit，通常等于当时的 `origin/main`）。不用 `git merge`、不用 `--no-ff`。如果 worktree 内只有 1 个 commit，等价于 `git cherry-pick <hash>`。
- 推送前在最新 `origin/main` 上变基；变基后重跑验收命令。
- 合完清理 worktree：`git worktree remove <path>` 加 `git branch -D <branch>`，避免目录堆积。

------

## 安全 / 发布

- 不提交真实凭证 / token / API 地址 / SQLite 文件 / 备份文件 / `.env`。
- 敏感端点（sync / admin）有速率限制与请求体上限，不可移除。边界见 [`security`](docs/evergreen/security.md)，参数默认值见 [`deployment`](docs/evergreen/deployment.md)。
- 后台洞察 `/api/admin/*` 不暴露任意 SQL，除受控维护端点外保持只读（机制见 [`security`](docs/evergreen/security.md)）。
- 升级 / 发布 / 版本变更必须明确批准。
- 依赖补丁 / 覆盖 / vendor 变更需要明确批准。

------

*Last reviewed: 2026-06-23（软约束更新“轨道看板信号协议”；机制与依据归 [`tracks`](docs/evergreen/tracks.md)）*
