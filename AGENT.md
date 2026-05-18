默认使用简体中文写文档，默认用简体中文回复用户。

# TimeData — AI 协作入口

电报风格。仅列根层规则与**单一文档入口**。模块结构、数据流、启动顺序、文档地图均下沉到 `docs/evergreen/architecture.md`，不在本文件复述。

------

## 入口

- **任何深入修改前先读** [`docs/evergreen/architecture.md`](docs/evergreen/architecture.md)。它讲清楚五个包的关系、数据流、启动顺序、关键约定，并按主题链向各 evergreen 子文档。
- 本文件不再充当文档地图；不要在这里查"backup / sync / cli 看哪份"。
- 子目录如有 `AGENTS.md` / `AGENT.md`，处理对应范围前先读。

------

## 一句话定位

- TimeData = 个人时间记录 PWA：本地优先（IndexedDB），可同步到自托管 Hono + SQLite 服务，AI/脚本通过受控 CLI 写入，Capacitor 套 Android 壳。
- pnpm monorepo，TypeScript ESM，全部 Vitest。
- **不做**：多用户、协作、SaaS、复杂权限、AI 直接写 DB / 备份文件。

------

## 硬红线（违反 = 数据损坏 / 安全风险 / 不可控写入，先停下问用户）

- **写入路径只有两条**：用户在 Web 端 → Dexie；脚本/AI 通过 CLI → HTTP API → SQLite。不存在第三条。AI 不直接编辑 SQLite / IndexedDB / syncLog / Backup JSON / JSONL / CSV 导出文件。详见 [`docs/adr/0001-cli-as-only-write-path.md`](docs/adr/0001-cli-as-only-write-path.md)。
- **服务端是最终裁判**：时间合法性、分类存在性、重叠、认证最终判定在 `packages/server/`。client / CLI 校验只为体验，不可让 server 跳过。
- **SQLite schema 不就地改已有列含义**：新增表 / 列 / 索引可走兼容迁移；改列类型或语义必须写一次性迁移代码。
- **Backup 格式破坏性变更必须明确改当前格式契约**：当前 `timedata.backup`（`timeFormat: "utc"`）；不维护旧 Backup 格式兼容路径。
- **`参考代码/` 只读**，可借鉴思路，不直接 import 进 `packages/`。

------

## 软约束（产品定位选择，AI 可在 PR 里提出取舍）

- **Sync ≠ Backup**：Sync 是多设备同步，Backup 是防误删。状态一致时是 no-op，恢复 Backup 不自动覆盖服务器。
- **全量同步兜底只能手动触发**：`force-push/prepare` + `force-push` 五重保护（诊断、短时 token、确认短语、最终确认、服务端备份）。
- **CLI 本质是 server API 的受控简化封装**，不是新写入通道。
- **`SyncPushReasonCode` 是封闭枚举**：扩展需同步 server validation / client engine / 文档表。

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

## 命令

- 运行时：Node 22+；包管理器：pnpm（仅用仓库默认值，未经审批不替换）。
- 安装：`pnpm install`。
- 测试：`pnpm test`（全包），或 `pnpm --filter @timedata/<pkg> test`。
- 构建：`pnpm build`（不含 mobile）。
- 开发：`pnpm dev:client` / `pnpm dev:server`。
- 文档影响：`pnpm check:docs`（warn）/ `pnpm check:docs:strict`（CI）/ `pnpm check:docs:stale`。
- 部署、环境变量、自更新见 [`README.md`](README.md)。
- Shell：使用 Bash 或专用工具，**不使用 PowerShell**。

------

## 代码

- TypeScript ESM 严格模式。避免 `any`；优先真实类型 / `unknown` / 窄适配器。
- 外部边界用 `zod` 或现有 schema 助手。
- **改 `packages/shared/src/types.ts` = 改公开 API**：必须跨 client / server / cli 三端检查。
- 不发明新写入路径。需要 AI 写入就走 CLI 或 server API；缺命令先在 plan 加，再实现。
- 时间一律 UTC ISO 字符串；SQLite 存字符串字段，比较靠字典序；Dexie 同样存字符串。
- SQL 字段 `snake_case`，JS `camelCase`，手工映射，没有 ORM。
- 注释：仅给非显而易见、易出错或曾有 bug 的逻辑写简短说明。
- 命名：产品 / 文档用 **TimeData**；包 / 路径 / 配置用 `timedata`。

------

## 测试

- 全包 Vitest。同级目录 `*.test.ts`。
- 优先行为测试，不靠 grep 文档字符串。
- 未经明确批准不改基线 / 快照 / 忽略来消除失败。
- 交付前本地通过 `pnpm test` 与 `pnpm check:docs`。无法运行时（环境受限）显式说明跳过的检查。

------

## 文档 / 变更日志

文档分三类，处理方式不同：

| 类型 | 位置 | 改了代码该怎么做 |
|---|---|---|
| 长期文档（evergreen） | `docs/evergreen/**`、`README.md`、本文件 | 必须同步修改 |
| 架构决策（ADR） | `docs/adr/**` | 仅追加，不改既有条目；新决策写新 ADR |
| 本地过程文档 | `docs_local/**`（不进 Git） | 沉淀后才同步到 evergreen 或 ADR |

- AI 生成的 spec / plan / review / 审查 / 历史归档默认写入 `docs_local/{specs,plans,reviews,archive,ideas,scratch}/`。
- 长期文档头部 `covers:` 字段声明管辖代码路径。改代码后回头看 `covers` 是否命中，命中即改对应段落，并更新 `last-reviewed`。
- 哪个 evergreen 子文档管哪块代码，**去 `architecture.md` 第 6 节"模块速查"或各文档 frontmatter 查**，不在本文件维护。
- evergreen 大调整保留代码入口 / 路由 / 测试文件路径，便于按文档反查实现。

------

## Git

- 提交：约定式风格、简洁、分组。
- 不删 / 重命名意外文件；阻碍时询问，否则忽略。
- 用户说 `commit`：只提交本次变更。`commit all`：分组提交所有变更。`push`：可先 `git pull --rebase`。
- 不主动推送至远端，除非用户明确要求。
- 默认 `main`；无合并提交，推送前在最新 `origin/main` 上变基。

------

## 安全 / 发布

- 不提交真实凭证 / token / API 地址 / SQLite 文件 / 备份文件 / `.env`。
- 服务端鉴权：单一 Bearer Token；缺 `AUTH_TOKEN` 时受保护 `/api/*` 默认 fail-closed，只有显式 `ALLOW_UNAUTHENTICATED_DEV=1` 才允许本地开发无 token 放行。
- 速率限制：`/api/sync/*` 60s 窗口 `SYNC_RATE_MAX` 次（默认 60）；`/api/admin/*` 同窗口 `ADMIN_RATE_MAX` 次（默认 120）。
- 后台洞察 `/api/admin/*` 不暴露任意 SQL；除受控维护端点（如 `/api/admin/sync-logs`）外保持只读。
- 升级 / 发布 / 版本变更必须明确批准。
- 依赖补丁 / 覆盖 / vendor 变更需要明确批准。

------

*Last reviewed: 2026-05-18（2026-05-18 审查整改完成：补强项目定位边界；A1-A4 / B1 / B4 / D2 / E1 / E2 / E6 / F1 / F2 / F11 全部落地；新增 ADR 0007 / 0008，修订 ADR 0003 / 0004）*
