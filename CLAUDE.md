默认使用简体中文写文档，默认用简体中文回复用户

# TimeData — AI 协作入口

> 这份文件是给 AI 编码助手（Claude、Copilot、Cursor 等）看的项目入口。
> 目标：用最少的篇幅让 AI 知道**这是什么、去哪查、不要碰什么**。
> 详细的项目说明请读 [`docs/TimeData-project-review-brief.md`](docs/TimeData-project-review-brief.md)。

---

## 一句话定位

TimeData 是个人时间记录 PWA：本地优先（IndexedDB），可同步到自托管服务器，可通过受控 CLI 让 AI/脚本写入数据，正在用 Capacitor 套 Android 壳。

**不做**：多用户协作、SaaS 化、复杂权限、AI 直接写数据库或备份文件。

---

## 仓库速览

pnpm monorepo，TypeScript ESM，测试统一用 Vitest。

```
TimeData/
├── packages/
│   ├── shared/     共享类型与常量（Category / TimeEntry / SyncChange 等契约）
│   ├── client/     React 19 + Vite + Tailwind 4 + Dexie + PWA 的 Web 客户端
│   ├── server/     Hono + better-sqlite3 的 API 服务端
│   ├── cli/        受控 timedata 命令行（AI/脚本唯一写入入口）
│   └── mobile/     Capacitor Android 壳（Phase 5.3，仍在搭建）
├── docs/           长期公开文档与 ADR（见下方"文档地图"）
├── scripts/        本地测试脚本
└── 参考代码/        其他本项目可参考的参考代码，AI实现类似功能时候可参考
```

## 启动与测试

```bash
pnpm install
pnpm test                       # 所有包的测试
pnpm build                      # 全量构建（不含 mobile）
pnpm dev:client                 # 启动 Web 客户端
pnpm dev:server                 # 启动 API 服务端
pnpm --filter @timedata/cli test
```

部署细节、环境变量、自更新机制见 [`README.md`](README.md)。

---

## 各模块速查

| 模块 | 用一句话说 | 修改前先看 |
|---|---|---|
| `packages/shared` | 全部跨端契约（Category、TimeEntry、SyncChange、SyncPushOutcome 等） | `src/types.ts` 改了等同于改公开 API |
| `packages/client` | 本地优先 PWA：IndexedDB（Dexie）+ React + 同步引擎；分类管理页用 dnd-kit 做同层级拖拽排序 | 同步逻辑在 `src/sync/`，备份在 `src/backup/`，分类排序在 `src/pages/CategoriesPage.tsx` / `src/hooks/useCategories.ts` / `src/lib/categorySort.ts` |
| `packages/server` | 同步/导出/版本/自更新 API；服务端权威校验在这里 | 路由在 `src/routes/`，同步合并在 `src/sync/` |
| `packages/cli` | 给人类/脚本/AI 的受控写入入口；不直接访问 DB/IndexedDB/备份文件 | 命令在 `src/commands/`，新增命令需走白名单 |
| `packages/mobile` | Capacitor Android 壳，加载 client 的 mobile 构建产物 | 当前是新模块，结构未稳定，改前先确认计划 |

---

## 核心数据模型

定义都在 `packages/shared/src/types.ts`，跨 client/server/cli 共用：

- `Category` — 两级分类（`parentId` 为 `null` 是顶层），`sortOrder` 只表示同层级内顺序；Web 分类管理页拖拽排序会更新变化项并写 `syncLog`
- `TimeEntry` — 一段时间记录（`startTime` / `endTime` 都是 ISO 字符串）
- `SyncLogEntry` — 客户端本地的待同步操作日志
- `SyncChange` / `SyncPushRequest` / `SyncPushOutcome` — 同步推送的请求与逐条结果
- `SyncPushReasonCode` — 同步被拒/冲突的明确原因码（白名单枚举）

**修改这些类型 = 改契约**，必须同时检查 client、server、cli 三端。

---

## 红线（不要随便动）

以下是 **已确认** 的红线：

1. **CLI 是 AI/脚本唯一的写入路径**。AI 不能直接编辑：
   - SQLite 数据库文件
   - IndexedDB（包括通过浏览器代码绕过 API）
   - sync log
   - Backup JSON 文件
   - JSONL/CSV 导出文件（不能用导出文件写回数据）

   写入只能通过 server API 或 CLI 白名单命令。详见 [`docs/TimeData-CLI-AI.md`](docs/TimeData-CLI-AI.md)。

2. **Sync ≠ Backup**，语义不能混。Sync 是多设备同步当前数据；Backup 是防误删/防迁移失败。
   普通同步会先比较本地和云端核心数据；完全一致时是 no-op，不 push、不 pull、不创建本地自动备份。恢复 Backup 后**不会自动覆盖服务器**，需要用户手动同步。改同步/恢复流程时不要绕过这一点，也不要把同步日志当成本地备份记录展示。

3. **Backup 格式版本**：当前是 `"format": "timedata.backup.v2"`（`timeFormat: "utc"`）。改格式要升版本号（v3…），v1 不再支持导入（`UNSUPPORTED_FORMAT`），v2 保留兼容读。

4. **服务端权威校验**：时间范围合法性、分类存在性、时间段重叠、认证等的最终判定在 `packages/server/`，client/CLI 的检查只是为了体验，**不能让 server 跳过**。

5. **`参考代码/` 目录**：是其他项目的参考代码，AI 可以**读取以借鉴思路**（IA、交互、算法），但**不修改、不直接引用**到 `packages/` 中。需要的实现要在 `packages/` 里独立写一份。

补充约束（已确认）：

6. **SQLite schema 不就地改**：当前迁移机制是 `CREATE TABLE IF NOT EXISTS`，只能加表/列。改已有列含义需要写一次性迁移代码，不要直接修改 schema 字符串——已部署实例不会重建。详见 [`docs/evergreen/data-model.md`](docs/evergreen/data-model.md) 第 9 节。
7. **`SyncPushReasonCode` 是封闭枚举**：新增原因码要在 `packages/shared/src/types.ts` 加值后，同步更新 server 的 `validation.ts`、client 的 `engine.ts` 处理逻辑、`docs/evergreen/sync.md` 第 6 节、`docs/evergreen/data-model.md` 第 5 节的表。
8. **同步冲突解决有顺序约束**（`packages/server/src/sync/resolver.ts`、`order.ts`、`validation.ts`）：改之前先看测试，并阅读 [`docs/evergreen/sync.md`](docs/evergreen/sync.md)。
9. **全量同步兜底只能手动触发**：`sync/status`、`force-push/prepare`、`force-push` 是诊断和人工救援入口。不要在普通同步失败、启动同步或 APK 更新后自动执行全量覆盖；本地覆盖云端必须保留诊断、短时 token、确认短语、最终确认和服务端备份。

待优化项（**不是红线，是技术债**，改的时候顺手处理或立项）：

- 同步逻辑有几处已知粗糙点（时钟漂移、tombstone 不下推、`use_remote` 不清 syncLog、reasonCode 处理偏粗）。详见 [`docs/evergreen/sync.md`](docs/evergreen/sync.md) 中标"已知问题（待优化）"的段落。

---

## 文档分层（重要）

文档分三类，**改了代码后的处理方式不一样**：

| 类型 | 位置 | 改了代码该怎么做 |
|---|---|---|
| **长期文档（evergreen）** | `docs/evergreen/**`、`README.md`、本文件 | **必须同步修改** |
| **架构决策（ADR）** | `docs/adr/**` | 仅追加，不改既有条目；新决策写新 ADR |
| **本地过程文档** | `docs_local/**` | 不进 Git；只把沉淀后的长期事实同步到 evergreen 或 ADR |

`docs_local/` 是本地开发过程文档目录，不进入 Git：

- `docs_local/specs/`：需求规格、设计草案
- `docs_local/plans/`：实施计划
- `docs_local/reviews/`：代码审查报告、模型复核报告
- `docs_local/archive/`：历史开发记录、Achieve 类文档
- `docs_local/ideas/`：个人想法、未定方案
- `docs_local/scratch/`：临时记录、排查过程

AI 生成的 spec、plan、review 默认写入 `docs_local/`。只有已经沉淀为长期事实、公开维护规则或架构决策的内容，才摘取结论同步到 `docs/evergreen/` 或追加到 `docs/adr/`。不要把开发过程文档、阶段复盘、模型对比、代码审查过程放进公开 `docs/`。

**长期文档头部带 frontmatter `covers:` 字段**，明确声明它管辖哪些代码路径。改了代码后，必须回头检查相关 evergreen 文档是否需要更新。

**自动检测**：

```bash
pnpm check:docs            # 列出本次改动可能影响的长期文档（warn 模式）
pnpm check:docs:strict     # CI 用：未同步更新文档时退出码非 0
pnpm check:docs:stale      # 列出 last-reviewed 超过 180 天的文档
```

脚本：`scripts/check-evergreen-docs.mjs`，零外部依赖，纯 Node 22+。

## 文档地图

按"想做什么 → 看哪份"组织：

| 想做什么 | 先看 |
|---|---|
| 整体架构、三端关系、数据流 | [`docs/evergreen/architecture.md`](docs/evergreen/architecture.md) |
| 数据模型、字段含义、契约 | [`docs/evergreen/data-model.md`](docs/evergreen/data-model.md) |
| 同步流程、冲突解决、reasonCode | [`docs/evergreen/sync.md`](docs/evergreen/sync.md) |
| Backup 格式、恢复语义 | [`docs/evergreen/backup.md`](docs/evergreen/backup.md) |
| CLI 命令、配置、错误码 | [`docs/evergreen/cli.md`](docs/evergreen/cli.md) |
| 部署、环境变量、自更新 | [`docs/evergreen/deployment.md`](docs/evergreen/deployment.md)（[`README.md`](README.md) 是用户向版本） |
| 本地开发环境 | [`docs/evergreen/development.md`](docs/evergreen/development.md) |
| 时间轴、跨夜显示、新增记录默认时间 | [`docs/evergreen/timeline.md`](docs/evergreen/timeline.md) |
| 分类预设 | [`docs/evergreen/domain/categories-preset.md`](docs/evergreen/domain/categories-preset.md) |
| **为什么这么设计**（红线背后的决策） | [`docs/adr/`](docs/adr/) |
| 本地开发过程记录、计划、审查 | `docs_local/`（不进 Git） |
|                                      |                                                              |

`docs_local/specs` 是设计规格，`docs_local/plans` 是按规格落地的实施计划，`docs_local/reviews` 是审查报告，`docs_local/archive` 是历史过程归档。**这些是本地过程文件**，不进入公开仓库；红线和长期事实沉淀到 `evergreen/` 和 `adr/`。

---

## 当前正在变动的区域

写入这份 CLAUDE.md 时（2026-05），以下区域**结构尚未稳定**，AI 改动前先看当前代码与对应 evergreen 文档，不要基于旧过程计划写死假设：

- `packages/mobile/`：Phase 5.3 Capacitor Android 壳，加载 GitHub Release 发布的 APK。APK 内置的是构建时的 client 代码；如果新 APK 调用了新增 `/api/sync/*` 接口，服务器镜像也必须更新到兼容版本。排查“APK 连不上服务器”时先看 `/api/health`、Token、HTTPS/反代，再看 `/api/sync/status` 是否 404 或鉴权失败。
- 设置页二级页拆分、同步校验与备份、移动端 / PWA 多端体验一致性修复等进行中方向，如果需要过程计划，查 `docs_local/`；公开长期事实以 `docs/evergreen/` 和 `docs/adr/` 为准。

---

## 给 AI 的几条工作守则

1. **先看长期文档再写代码**。要改某块代码前，去 `docs/evergreen/` 找对应文档（看 frontmatter 的 `covers` 能反查到）。读完再动手，不要靠 grep 拼凑理解。
2. **改了类型必跨端检查**。`packages/shared/src/types.ts` 的任何改动，都要回过头看 client/server/cli 三端是否需要同步改。
3. **不要发明新的写入路径**。需要让 AI 写数据，就走 CLI 或 server API；缺命令就先在 plan 里加，再实现。详见 [`docs/adr/0001-cli-as-only-write-path.md`](docs/adr/0001-cli-as-only-write-path.md)。
4. **遇到红线先停下来问**。包括"看起来能改但标注了红线"的代码。红线的"为什么"看 `docs/adr/`。
5. **改了代码必同步更新长期文档**。每次提交前跑一次 `pnpm check:docs`，命中的文档要么改、要么在 PR 描述里说明为什么不用改。具体规则：
   - 改了某文件 → 找哪些 `docs/evergreen/*.md` 的 `covers` 命中它 → 同步修改文档对应段落。
   - 类型契约改了（`shared/src/types.ts`）→ `data-model.md` 必改。
   - 同步行为、reasonCode、冲突解决改了 → `sync.md` 必改。
   - Backup 格式改了 → `backup.md` 必改 + **必须升版本号**（见 ADR 0003）。
   - CLI 命令、错误码改了 → `cli.md` 必改。
   - 部署、环境变量、自更新机制改了 → `deployment.md` + `README.md` 一起改。
   - 分类排序属于客户端本地写入：只允许在同层级内重排，必须更新 `sortOrder` / `updatedAt` 并写 `syncLog`；入口见 `docs/evergreen/data-model.md` 的 `Category` 章节。
   - **大调整的 evergreen 文档要留下代码入口/路由/测试文件路径**，方便以后按文档反查实现。
   - 改完更新对应 evergreen 文档的 `last-reviewed` 字段。
6. 新决策写到 `docs/adr/` 里。

---

*Last reviewed: 2026-05-14（补充 full sync fallback 和 APK/服务器兼容排障提醒）*
