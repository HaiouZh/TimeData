---
type: evergreen
title: 任务轨道
covers:
  - packages/server/src/lib/track-rows.ts
  - packages/server/src/routes/agent-tracks.ts
  - packages/shared/src/trackBoardSignals.ts
  - packages/client/src/lib/tracks.ts
  - packages/client/src/lib/tracksView.ts
  - packages/client/src/lib/settings/trackActionTagsSetting.ts
  - packages/client/src/pages/settings/SettingsTracksPage.tsx
  - packages/client/src/pages/tracks/**
last-reviewed: 2026-07-02
---

# 任务轨道

> 轨道把复杂、易分支的任务升成一条可监控的人机接力线。T1 落数据地基；T2 提供 agent 受控 ingest API；T3 提供列表与详情监控面；T4/T5 已提供步骤共编与跨轨道聚合。本期口径：步骤标签默认是检索辅助；其中少数配置为“看板信号”的标签进入 `/tracks` 顶部聚合。详情时间线仍用开口步高亮执行中的段落。

## 承上启下

- **上游**：客户端数据层 `lib/tracks.ts` 可本地写入；授权 agent 只能经服务端 `/api/agent/tracks*` 受控端点写入。
- **下游**：`tracks` / `track_steps` 走普通 [sync](sync.md) push/pull、完整 [backup](backup.md)，未来监控面读取它们渲染状态线；[goals](goals.md) 可通过 `Goal.members` typed 引用把轨道收编为目标成员。
- **契约**：字段 schema 在 `packages/shared/src/entitySchemas.ts`；跨域表名、时间、ID 与 Dexie/SQLite 映射见 [data-model](data-model.md)。
- **邻居**：[todo](todo.md) 是操作台，轨道只是用 `refs` 指过去；[goals](goals.md) 只读轨道状态与步骤活动做目标 roll-up；[timeline](timeline.md) 是真实时间记录域，轨道步骤的历时不写入 `time_entries`；[health](health.md) 的 runs 等健康数据也只被 `refs` 指向。

## 1. 数据模型

`Ref = { kind, id, label? }` 是开放指针。轨道不拥有被指向领域的数据；能排序、求和、上图的数据留在各自领域，轨道只保存叙事骨架、时间跨度、顺序、来源和指针。

`Track` 只有 `active` / `concluded` / `parked` 三态，没有 done，也不保存 Goal 归属。Goal 对轨道的组织关系只存在于 `Goal.members`，不改变轨道状态机、不参与 agent ingest payload。`TrackStep` 是步骤日志，`endedAt=null` 表示当前步；`endedAt` 允许等于 `startedAt`，表示瞬时步骤。`content` 是宽松字符串，允许空串，便于纯指针步骤。

结构化领域字段不得回流到轨道 spine。新增领域先放到自己的域，再由 `refs`、`tags` 或对应领域自己的关系字段连接；不要给 `Track` / `TrackStep` 开通用 JSON 后门。目标层是组织视图，必须从 Goal 侧引用 Track，而不是给 Track spine 加目标归属字段。

## 2. 存储与同步

服务端表 `tracks` / `track_steps` 不建 SQL 外键，也不使用数据库级联删除。目标层成员关系不在 `tracks` 表落列；旧库上的 `tracks.goal_id` 会由 schema 初始化流程幂等删除。同步账本只认识显式 change、tombstone 和 `sync_seq`：如果 SQLite 自行级联删除步骤，其他设备按 seq 拉取时不会知道这些步骤已被删。

两个域均为 LWW：

| 域 | upsertPriority | deletePriority | 说明 |
|---|---:|---:|---|
| `tracks` | 70 | 71 | 父轨道先创建、后删除 |
| `track_steps` | 71 | 70 | 步骤后创建、先删除 |

`countsInStatus=false` 只表示不进 `/api/sync/status` 的公开业务计数；服务端 commit hash 和 seq 账本仍会覆盖这些同步域。

## 3. 客户端数据层

`packages/client/src/lib/tracks.ts` 是 T1 的本地写入边界：

- `addTrack` / `updateTrack` / `addTrackStep` / `updateTrackStep` 写入前都走 shared Zod schema。
- `listTracks` / `listTrackSteps` parse-on-read；坏行 `console.warn` 后跳过，未知字段被 schema strip。
- `addTrackStep` 要求轨道存在；未传 `seq` 时取同轨道当前最大序号加 1。
- `deleteTrack` 必须手工先删该轨道步骤，并逐条写 `syncLog(tableName="track_steps", action="delete")`，再删轨道并写 `tracks/delete`。
- Dexie stores：`tracks: "id, status, updatedAt"`；`trackSteps: "id, trackId, [trackId+seq], updatedAt"`。

## 4. Agent ingest API

`/api/agent/tracks*` 由 scoped auth 保护，可用 master `AUTH_TOKEN` 或窄域 `AGENT_TOKEN`。agent 只能经这些受控端点写轨道，不能直接写 SQLite / IndexedDB / backup / syncLog。分工：server 拥有记账（id/seq/createdAt/updatedAt），agent 拥有语义时间（startedAt/endedAt 可回填）。

- `POST /api/agent/tracks`：建轨道；`requestId` 作为轨道 id，重发返回已有记录。
- `POST /api/agent/tracks/:id/steps`：追加 `source="agent"` 步；可带 `sourceLabel`、历史 `startedAt/endedAt`、`refs`、`tags`；追加时自动闭合上一条开口当前步（新步 startedAt 早于开口步则 400）。缺失 track 返回 404；非 active track 返回 409 `TRACK_NOT_ACTIVE`（与 `:id/context` 同口径，避免交接步静默落进已归档轨道）。
- `POST /api/agent/tracks/:id/current-step/close`：只闭合当前步，不前进、不改轨道状态；无开口步 409。
- `PATCH /api/agent/tracks/:id`：改 `status/title/summary/refs`；`concluded` 自动闭合当前步，`parked`/`active` 保留当前步。

这些端点与任务 agent 回写一样走 `applyChange()` + `sync_seq` + `notifySyncChange()`，前台客户端经普通 sync stream 秒级感知。不写 TimeEntry、不扩 force-push；人手共编入口见 §6。

agent 续写上下文另有只读 API：`GET /api/agent/tracks/context` 返回 active tracks、每条最近 3 步、`stepCount`、`latestBoardSignal` 与当前 `boardSignals`；`GET /api/agent/tracks/:id/context` 返回单条 active track 的全量 steps（`seq ASC, startedAt ASC, id ASC`）、`stepCount`、`latestBoardSignal` 与 `boardSignals`。两个端点只读，不写 `sync_seq`、不触发 `notifySyncChange()`，也不返回 `bestMatch` / `score` / recommendation。缺失 track 返回 404；非 active track 详情返回 409 `TRACK_NOT_ACTIVE`。

## 5. 监控面(T3)

`/tracks` 列表与 `/tracks/:id` 详情是轨道的独立看板面(不进今天视图),页面用 `useLiveQuery` 读取、吃 sync 后变化。
取值/排序/格式化在 `lib/tracksView.ts` 纯函数:`partitionTracks`(active vs 归档)、
`currentStepId`/`orderedTimeline`(当前步=最大 seq 的开口步置顶高亮;无开口步纯倒序、不高亮)、
`trackProgressSummary`/`formatStepDuration`(历时跨天显「N天」)、`isLinkRef`(只有 http(s) 外链可点)、
`latestBoardSignal`/`boardItemsForTracks`/`collectStatusFacetsFromItems`/`filterBoardItemsByStatusTags`(从已配置看板信号派生顶部 chip 与 OR 筛选)。列表顶部最简新建走 `addTrack`，active 轨道保持扁平列表，归档轨道折叠；详情倒序时间线显示 source、content、历时、tags、refs chip。`task` 等领域指针先占位不跳,agent 写入见 T2。

## 6. 人手共编(T5)

详情页是轻量共编入口,只写 `track_steps` / `tracks`,不编辑 agent 原文、不加领域字段、不写 `TimeEntry`。人手入口统一为“写一步”：提交时调用 `appendUserStep({mode:"open"})`，开一个 `source="user"`、`endedAt=null` 的当前步，并镜像 agent 自动闭合最新开口步(守卫闭合时间不早于开口步 `startedAt`)。

`决策 / 批注 / 提醒` 只是普通快捷标签，不再是特殊步骤性质，也不驱动特殊底色或“决策步”徽标。底层 `appendUserStep(mode:"instant")` 能力和历史瞬时步骤仍可兼容存在，但主 UI 不再让用户先选择“开始做这段 / 记一个点”。

另有 `closeCurrentStep`(只闭合最新开口步、不前进;无开口步报错)与 `setTrackStatus`(切 active/concluded/parked;`concluded` 顺手闭合开口步,镜像 T2 的 `PATCH`)。这些都只写 Dexie + `syncLog`,写入经 `recordSyncLog` 自动调度上传(见 [sync](sync.md) §1.6),不需要 UI 手动触发;数据层不按状态拦写入,改由详情页只对 `active` 显示加步/闭合入口。

产品生命周期收敛为 `推进中 / 已归档`：active 显示 `推进中` 和 `归档` 按钮；归档写底层 `concluded` 并闭合开口步；旧数据里的 `parked` 只兼容读取为 `已归档`，非 active 统一显示 `重新推进`。批注串联到具体步(`ref{kind:"track_step"}`)、历史步编辑/删除、自由 refs/tags 编辑器均推迟。

## 7. 看板信号与步骤检索标签

`TrackStep.tags` 首先是步骤检索辅助。普通标签如 `决策 / 批注 / 提醒 / 自定义标签` 不表达生命周期、不表达写者，也不进入列表聚合，除非用户在 `/settings/tracks` 主动把它们加入看板信号配置。

看板信号配置写 `track.actionTags.v2`。新写入是 JSON 字符串数组；未配置时种子为 `待我处理 / agent在做`。旧 `track.actionTags.v1` 只作读时影子源；早期 v2 的 `{tag,court}` 数组兼容读取但只消费 `tag` 文本并忽略 `court`。读到旧默认 `[等我,待决策,卡住,agent在做]` 时归一为新默认两件套；显式 `[]` 仍表示没有看板信号。

每条 active 轨道的当前看板信号 = 按步骤倒序查找最近一条带已配置看板信号的 step；同一步有多个信号时按配置顺序取第一个。无标签步骤和普通检索标签步骤不会清掉已有信号。比如 `agent在做` 之后补一条 `决策` 或无标签步骤，列表仍显示 `agent在做`，直到后续步骤写入新的已配置看板信号。

看板信号计算在 `packages/shared/src/trackBoardSignals.ts`，client `tracksView.ts` 与 server agent context API 共用同一纯函数：按步骤倒序找最近一条含已配置看板信号的 step；同一步多个信号时按 `boardSignals` 顺序取第一个；无标签步骤和普通检索标签不清空已有信号。

`/tracks` 列表保持扁平，不再按阵营或“该谁了”分组，也不保存本地分组视图偏好。顶部 chip 按配置顺序显示看板信号计数，如 `待我处理 N`、`agent在做 N`；点击 chip 做 OR 筛选。卡片只展示 `#tag` 信号牌、最新 3 步，并可就地”写一步”（`appendUserStep`，写入经 `recordSyncLog` 自动调度上传）。

agent 接力协议：派活时给 agent `trackId` 和当前看板信号词表；人手可先 append 一步打 `agent在做`。agent 完成或需要人接手后经 `/api/agent/tracks/:id/steps` append 一步，默认开口并打 `待我处理` 或用户当前配置中的等价看板信号。append 自动闭合上一开口步；该步成为看板当前信号，直到后续步骤写入新的已配置看板信号。

本地续写协议的单一事实源是 `.claude/skills/track-step/SKILL.md`（平台无关，任何能跑 shell/Node 的 agent 通用；技术契约见同目录 `references/api.md`，执行器 `scripts/td-track.mjs`）。该目录是本地 AI state，被 `.gitignore` 忽略；evergreen 只记录指针和端点契约，不复制协议正文。协议要求 agent 被用户显式召回后先读 context、保守匹配已有 active track、命中后写 step、未命中时回报建议新建标题，且写入或未写入都必须给回执。

## 8. 后续阶段

- 仍待后续:批注串联到具体步(`ref{kind:"track_step"}`)、历史步编辑/删除、自由 refs/tags 编辑器、时间统计桥(历时聚合进 Stats)。
- 不接 TimeEntry 写入，不改 todo 子任务模型；扩展靠 `refs`/`tags` 与各领域自己的表，不给 schema 补领域字段。
