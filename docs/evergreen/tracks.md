---
type: evergreen
title: 任务轨道
covers:
  - packages/server/src/lib/track-rows.ts
  - packages/client/src/lib/tracks.ts
last-reviewed: 2026-06-21
---

# 任务轨道

> 轨道把复杂、易分支的任务升成一条可监控的状态线。T1 只落数据地基：实体 schema、同步域、服务端行映射、客户端本地 CRUD、备份与同步接入。
> 不讲 UI、agent ingest API、轮到我聚合和人机共编交互；这些属于后续 T2-T5。

## 承上启下

- **上游**：当前只有客户端数据层 `lib/tracks.ts` 可本地写入；后续 agent ingest 仍必须走服务端受控 API。
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

## 4. T1 明确不做

- 不做轨道页面、导航入口、列表或时间线 UI。
- 不做 agent ingest API，也不扩展 server force-push 协议。
- 不接入 TimeEntry 写入，不改变 todo 子任务模型。
- 不给 schema 补领域专用字段；扩展靠 `refs` / `tags` 和对应领域自己的表。
