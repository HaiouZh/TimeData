---
type: evergreen
title: 任务轨道
covers:
  - packages/server/src/lib/track-rows.ts
  - packages/server/src/routes/agent-tracks.ts
  - packages/client/src/lib/tracks.ts
  - packages/client/src/lib/tracksView.ts
  - packages/client/src/pages/tracks/**
last-reviewed: 2026-06-21
---

# 任务轨道

> 轨道把复杂、易分支的任务升成一条可监控的状态线。T1 落数据地基；T2 提供 agent 受控 ingest API：建轨道、append 步骤、显式闭合当前步、改状态/元信息，并通过 `requestId` 防重复；T3 提供列表与详情监控面。
> 不讲轮到我聚合和人机共编交互；这些属于后续 T4-T5。

## 承上启下

- **上游**：客户端数据层 `lib/tracks.ts` 可本地写入；授权 agent 只能经服务端 `/api/agent/tracks*` 受控端点写入。
- **下游**：`tracks` / `track_steps` 走普通 [sync](sync.md) push/pull、完整 [backup](backup.md)，未来监控面读取它们渲染状态线。
- **契约**：字段 schema 在 `packages/shared/src/entitySchemas.ts`；跨域表名、时间、ID 与 Dexie/SQLite 映射见 [data-model](data-model.md)。
- **邻居**：[todo](todo.md) 是操作台，轨道只是用 `refs` 指过去；[timeline](timeline.md) 是真实时间记录域，轨道步骤的历时不写入 `time_entries`；[health](health.md) 的 runs 等健康数据也只被 `refs` 指向。

## 1. 数据模型

`Ref = { kind, id, label? }` 是开放指针。轨道不拥有被指向领域的数据；能排序、求和、上图的数据留在各自领域，轨道只保存叙事骨架、时间跨度、顺序、来源和指针。

`Track` 只有 `active` / `concluded` / `parked` 三态，没有 done。`TrackStep` 是步骤日志，`endedAt=null` 表示当前步；`endedAt` 允许等于 `startedAt`，表示瞬时步骤。`content` 是宽松字符串，允许空串，便于纯指针步骤。

结构化领域字段不得回流到轨道 spine。新增领域先放到自己的域，再由 `refs` 或 `tags` 连接；不要给 `Track` / `TrackStep` 开通用 JSON 后门。

## 2. 存储与同步

服务端表 `tracks` / `track_steps` 不建 SQL 外键，也不使用数据库级联删除。原因是同步账本只认识显式 change、tombstone 和 `sync_seq`：如果 SQLite 自行级联删除步骤，其他设备按 seq 拉取时不会知道这些步骤已被删。

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
- `POST /api/agent/tracks/:id/steps`：追加 `source="agent"` 步；可带 `sourceLabel`、历史 `startedAt/endedAt`、`refs`、`tags`；追加时自动闭合上一条开口当前步（新步 startedAt 早于开口步则 400）。
- `POST /api/agent/tracks/:id/current-step/close`：只闭合当前步，不前进、不改轨道状态；无开口步 409。
- `PATCH /api/agent/tracks/:id`：改 `status/title/summary/refs`；`concluded` 自动闭合当前步，`parked`/`active` 保留当前步。

这些端点与任务 agent 回写一样走 `applyChange()` + `sync_seq` + `notifySyncChange()`，前台客户端经普通 sync stream 秒级感知。不写 TimeEntry、不扩 force-push、不替代后续 T5 的人手共编入口。

## 5. 监控面(T3)

`/tracks` 列表与 `/tracks/:id` 详情是轨道的独立监控面(监控≠操作,不进今天视图),页面用 `useLiveQuery` 读取、吃 sync 后变化。
取值/排序/格式化全在 `lib/tracksView.ts` 纯函数:`partitionTracks`(active vs 归档)、
`currentStepId`/`orderedTimeline`(当前步=最大 seq 的开口步置顶高亮;无开口步纯倒序、不高亮)、
`trackProgressSummary`/`formatStepDuration`(历时跨天显「N天」)、`isLinkRef`(只有 http(s) 外链可点)、
`isDecisionStep`(tag 命中 `决策`/`decision` 即决策步,不解析 content、不加字段)。
列表用 `CollapsibleSection` 折叠 concluded/parked,顶部最简新建只收标题走 `addTrack`;
详情倒序时间线每步显示 source 徽章、content、历时、tags、refs chip。`task` 等领域指针先占位不跳,agent 写入见 T2。

## 6. 后续阶段

- actionTags「轮到我」聚合 → T4。
- `source="user"` 人手共编 → T5。
- 不接 TimeEntry 写入，不改 todo 子任务模型；扩展靠 `refs`/`tags` 与各领域自己的表，不给 schema 补领域字段。
