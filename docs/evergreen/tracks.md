---
type: evergreen
title: 任务轨道
covers:
  - packages/server/src/lib/track-rows.ts
  - packages/server/src/routes/agent-tracks.ts
  - packages/shared/src/trackBoardSignals.ts
  - packages/shared/src/trackStepOrder.ts
  - packages/shared/src/trackMilestones.ts
  - packages/client/src/lib/tracks.ts
  - packages/client/src/lib/trackMilestones.ts
  - packages/client/src/lib/tracksDispatch.ts
  - packages/client/src/lib/tracksView.ts
  - packages/client/src/lib/trackBadgeTone.ts
  - packages/client/src/lib/taskTrackIndex.ts
  - packages/client/src/lib/taskTrackPromote.ts
  - packages/client/src/lib/settings/trackActionTagsSetting.ts
  - packages/client/src/lib/settings/trackAgentExecTagsSetting.ts
  - packages/client/src/pages/settings/SettingsTracksPage.tsx
  - packages/client/src/pages/tracks/**
  - packages/client/src/hooks/useTrackAttentionCount.ts
  - packages/client/src/contexts/TrackAttentionContext.tsx
  - packages/client/src/components/app-shell/NavBadge.tsx
contracts:
  - packages/shared/src/trackBoardSignals.ts
  - packages/server/src/routes/agent-tracks.ts
last-reviewed: 2026-08-07
---

# 任务轨道

> 轨道把复杂、易分支的任务升成一条可监控的人机接力线。数据地基 + agent 受控 ingest API + 列表与详情监控面 + 步骤共编与跨轨道聚合。步骤标签默认是检索辅助；其中少数配置为“看板信号”的标签进入 `/tracks` 顶部聚合。详情时间线仍用开口步高亮执行中的段落。

## 承上启下

- **上游**：客户端数据层 `lib/tracks.ts` 可本地写入；授权 agent 只能经服务端 `/api/agent/tracks*` 受控端点写入。
- **下游**：`tracks` / `track_steps` 走普通 [sync](sync.md) push/pull、完整 [backup](backup.md)，未来监控面读取它们渲染状态线；[goals](goals.md) 可通过 `Goal.members` typed 引用把轨道收编为目标成员。
- **契约**：字段 schema 在 `packages/shared/src/entitySchemas.ts`；跨域表名、时间、ID 与 Dexie/SQLite 映射见 [data-model](data-model.md)。
- **邻居**：[todo](todo.md) 是操作台，轨道只是用 `refs` 指过去；[goals](goals.md) 只读轨道状态与步骤活动做目标 roll-up；[timeline](timeline.md) 是真实时间记录域，轨道步骤的历时不写入 `time_entries`。

## 1. 数据模型

`Ref = { kind, id, label? }` 是开放指针。轨道不拥有被指向领域的数据；能排序、求和、上图的数据留在各自领域，轨道只保存叙事骨架、时间跨度、顺序、来源和指针。

`Track` 只有 `active` / `concluded` / `parked` 三态，没有 done，也不保存 Goal 归属。Goal 对轨道的组织关系只存在于 `Goal.members`，不改变轨道状态机、不参与 agent ingest payload。`TrackStep` 是步骤日志，`endedAt=null` 表示开口步；`endedAt` 允许等于 `startedAt`，表示瞬时步骤。步骤排序和“当前步”裁决统一用语义时间 `(startedAt, seq, id)`，`seq` 只在同刻写入时做稳定裁决。`content` 是宽松字符串，允许空串；`editedAt` 只在人手编辑步骤正文时写入，用于展示编辑痕迹。

结构化领域字段不得回流到轨道 spine。新增领域先放到自己的域，再由 `refs`、`tags` 或对应领域自己的关系字段连接；不给 `Track` / `TrackStep` 开通用 JSON 后门。目标层是组织视图，必须从 Goal 侧引用 Track，而不是给 Track spine 加目标归属字段。

`TrackMilestone` 是阶段骨架（[ADR 0035](../adr/0035-track-milestones-and-signal-priority.md)）：`(id, trackId, title, status: pending|done|dropped, note, taskId, position)`，一行一段。**刻度出生**——建出来只是骨架上的一格，不是任务；需要落实执行时单向挂一条任务（`taskId` 弱引用，勾选镜像见 §3）。排序口径 `(position, createdAt, id)`（shared `trackMilestones.ts`：`orderMilestones` / `milestoneProgress` / `currentMilestone`）；进度 = `done/total` 手动分段条，**dropped 剔除分母**、不物理删（砍掉留痕）。刻意不做 reorder 与 rename-only；`position` 由客户端写入层重编号维护。

## 2. 存储与同步

服务端表 `tracks` / `track_steps` 不建 SQL 外键，也不使用数据库级联删除。目标层成员关系不在 `tracks` 表落列；旧库上的 `tracks.goal_id` 会由 schema 初始化流程幂等删除。同步账本只认识显式 change、tombstone 和 `sync_seq`：如果 SQLite 自行级联删除步骤，其他设备按 seq 拉取时不会知道这些步骤已被删。

三个域均为 LWW：

| 域 | upsertPriority | deletePriority | 说明 |
|---|---:|---:|---|
| `tracks` | 70 | 71 | 父轨道先创建、后删除 |
| `track_steps` | 71 | 70 | 步骤后创建、先删除 |
| `track_milestones` | 76 | 70 | 阶段骨架后创建、先删除；无 op、无 guardedColumns，并发改同段后写胜（接受，[ADR 0035](../adr/0035-track-milestones-and-signal-priority.md)） |

`countsInStatus=false` 只表示不进 `/api/sync/status` 的公开业务计数；服务端 commit hash 和 seq 账本仍会覆盖这些同步域。`track_steps` / `track_milestones` 各有宿主轨道闸：非 delete 写入若找不到对应 `tracks` 行会以 `orphan_step_rejected` / `orphan_milestone_rejected` 跳过，避免离线旧行复活孤儿。`tracks.status` 是守卫列，只有带 `op:{type:"status"}` 的 tracks upsert 能覆盖现有状态；普通标题/摘要快照不会把已归档轨道顶回 active。

## 3. 客户端数据层

`packages/client/src/lib/tracks.ts` 是 T1 的本地写入边界：

- `addTrack` / `updateTrack` / `addTrackStep` / `updateTrackStep` 写入前都走 shared Zod schema。
- `listTracks` / `listTrackSteps` parse-on-read；坏行 `console.warn` 后跳过，未知字段被 schema strip。
- `addTrackStep` 要求轨道存在；未传 `seq` 时取同轨道当前最大序号加 1。
- `appendUserStep`、`closeCurrentStep`、`setTrackStatus(concluded)` 都幂等闭合该轨道全部开口步；闭合时间取 `max(闭合时刻, step.startedAt)`，不再因本机/agent 时钟偏差把合法闭合变成错误。
- `updateTrackStep` 只在正文 `content` 实际变化时写 `editedAt`；改 tags/refs/endedAt 不会误打编辑痕迹。
- `deleteTrack` 必须手工先删该轨道步骤与里程碑，并逐条写 `syncLog`（`track_steps` / `track_milestones` 各自 delete），再删轨道并写 `tracks/delete`。
- Dexie stores：`tracks: "id, status, updatedAt"`；`trackSteps: "id, trackId, [trackId+seq], updatedAt"`；`trackMilestones: "id, trackId, taskId, updatedAt"`。

`packages/client/src/lib/trackMilestones.ts` 是阶段骨架的写入层，全部单 Dexie 事务 + syncLog：`listTrackMilestones`（parse-on-read）、`addMilestones`（批量立骨架，追加末尾连续编号）、`insertMilestoneAt`（加塞，事务内整轨道重编号 0..n-1，只对 position 实际变化的行发 update）、`updateMilestoneTitle`、`setMilestoneStatus`（三态任意翻，翻离 dropped 保留 note）、`dropMilestone`（砍掉留痕，note trim 非空则覆盖）、`linkMilestoneTask` / `unlinkMilestoneTask`（挂/解任务弱引用）。**任务勾选镜像**：`toggleTaskDoneWithTrackConclude`（`taskTrackPromote.ts`）在勾选翻转后、`!task.done` 早退之前调 `syncLinkedMilestoneOnTaskToggle`——查挂靠段（`buildMilestoneTaskIndex` 同键多值取排序在前者、dropped 不进索引）、目标态一致不写（幂等）、失败只 `console.warn` 不回滚勾选，与轨道联动归档互为独立 try。dropped 的段不镜像——砍掉的段不因任务而复活。

## 4. Agent ingest API

`/api/agent/tracks*` 由 scoped auth 保护，可用 master `AUTH_TOKEN` 或窄域 `AGENT_TOKEN`。agent 只能经这些受控端点写轨道，不能直接写 SQLite / IndexedDB / backup / syncLog。分工：server 拥有记账（id/seq/createdAt/updatedAt），agent 拥有语义时间（startedAt/endedAt 可回填）。

- `POST /api/agent/tracks`：建轨道；`requestId` 作为轨道 id，重发返回已有记录。
- `POST /api/agent/tracks/:id/steps`：追加 `source="agent"` 步；可带 `sourceLabel`、历史 `startedAt/endedAt`、`refs`、`tags`；追加时自动闭合全部开口步并在响应返回 `closedSteps`。`startedAt` 允许回填历史，但不得超过 server 当前时间 5 分钟；单步自身 `endedAt < startedAt` 仍 400。缺失 track 返回 404；非 active track 返回 409 `TRACK_NOT_ACTIVE`（与 `:id/context` 同口径，避免交接步静默落进已归档轨道）。
- `POST /api/agent/tracks/:id/current-step/close`：闭合全部开口步，不前进、不改轨道状态；无开口步 409；响应返回 `closedSteps`。
- `PATCH /api/agent/tracks/:id`：改 `status/title/summary/refs`；`concluded` 自动闭合全部开口步，`parked`/`active` 保留开口步；状态变更写 tracks status op。

这些端点与任务 agent 回写一样走 `applyChange()` + `sync_seq` + `notifySyncChange()`，前台客户端经普通 sync stream 秒级感知。不写 TimeEntry、不扩 force-push；人手共编入口见 §6。

agent 续写上下文另有只读 API：`GET /api/agent/tracks/context` 返回 active tracks、每条最近 3 步、`stepCount`、`latestBoardSignal`、当前 `boardSignals` 与 `progress`（里程碑 done/total；列表瘦身刻意不带全量 `milestones`，同「最近 3 步」先例）；`GET /api/agent/tracks/:id/context` 返回单条 active track 的全量 steps（`startedAt ASC, seq ASC, id ASC`）、`stepCount`、`latestBoardSignal`、`boardSignals`、`milestones`（排序后全量）与 `progress`。agent ingest 刻意不写里程碑——阶段骨架的创建修改全走人的手（[ADR 0035](../adr/0035-track-milestones-and-signal-priority.md)）。两个端点只读，不写 `sync_seq`、不触发 `notifySyncChange()`，也不返回 `bestMatch` / `score` / recommendation。缺失 track 返回 404；非 active track 详情返回 409 `TRACK_NOT_ACTIVE`。

<a id="tracks-s5"></a>

## 5. 监控面(T3)

`/tracks` 列表与 `/tracks/:id` 详情是轨道的独立看板面(不进今天视图),页面用 `useLiveQuery` 读取、吃 sync 后变化。
取值/排序/格式化在 `lib/tracksView.ts` 纯函数:`partitionTracks`(active vs 归档)、
`currentStepId`/`orderedTimeline`(当前步=语义时间最大的开口步置顶高亮;无开口步纯语义时间倒序、不高亮)、
`formatStepDuration`(历时跨天显「N天」)、`isLinkRef`(只有 http(s) 外链可点)、
`latestBoardSignal`/`boardItemsForTracks`(按已配置看板信号给每条轨道定信号)。调度台的分组另落在 `lib/tracksDispatch.ts`：`dispatchItems` 按显式信号给每条 active 轨道定性，`groupDispatchItems` 归入 `awaiting-me`/`agent-running`/`wait-external`/`in-progress` 四组，`dispatchStats` 出汇总数；停滞阈值(`STALL_THRESHOLD_MS`=7 天)只产出行上提醒字段 `stalledDays`，不参与分组判定([ADR 0035](../adr/0035-track-milestones-and-signal-priority.md))。列表顶部最简新建走 `addTrack`，归档轨道折叠；详情倒序时间线显示 source、content、历时、tags、refs chip，user 步提供就地编辑/删除，正文编辑后显示“已编辑”。`RefChip` 的 `routeForRef`(kind 白名单)把内部实体 ref 渲染成应用内 `Link`：`task→/todo?taskId=`、`goal→/goals/:id`、`track→/tracks/:id`；未知 kind 保持 inert span，外链仍由 `isLinkRef` 的 http(s) 协议白名单单独放行(不放 `javascript:`/`data:`)。`refs` 的 task 反查通向 todo 侧（`lib/taskTrackIndex.ts` 读侧 + `lib/taskTrackPromote.ts` 写侧复合动作，落在 `tasks.ts`/`tracks.ts` 上层——两者平级互不 import，同 [todo/modules](todo/modules.md)「客户端」`taskNesting.ts` 的依赖方向理由）：`buildTaskTrackIndex` 全表扫 active 轨道（`refs` 无索引）建 `Map<taskId, {track, signal, tone}>`，同任务多轨道取 `updatedAt` 最新；`promoteTaskToTrack` 幂等建轨道（标题复用、`refs` 回指任务、光板不写步，已挂 active 时返回既有）；`toggleTaskDoneWithTrackConclude` 在勾掉任务时附带 `setTrackStatus(concluded)`，**单向 best-effort**——归档失败只 warn 不回滚勾选，取消勾选不重开轨道。客户端 4 个勾选入口消费它，`InlineChildren` 子任务勾选刻意保持直调 `toggleTaskDone`（子任务不给升格入口，不付反查开销）。归档写的系统步不带标签，因此不清 `latestTrackBoardSignal`——徽章消失靠「只认 active 轨道」的反查过滤，不靠信号。徽章不按 `Task.done` 隐藏：正常路径下勾选已归档、索引本就查不到，真显示出来即「任务完成了、轨道还开着」（归档失败或轨道被手动重开），已完成区因此也传徽章插槽——这是该状态在 todo 侧唯一的长期可见落点。勾选附带归档时给一条带撤销的提示，撤销是完整回退（取消勾选 + 轨道重开 active）；`toggleTaskDoneWithTrackConclude` 的返回值交出 `concludedTrack`（未归档含静默失败恒 `null`），调用方据它决定提不提示，不会把失败伪装成成功。**四个入口都给提示**，文案与回退动作同源于 `buildTrackConcludeUndo`（未归档恒返回 `null`，纯勾选因此不弹）；**落地组件是两套**：todo 侧（`TodoPage` / `TaskDetailSheet`）走 `ActionToastBar`，各持独立 `useActionToast` 实例（`ACTION_TOAST_DISMISS_MS`=6 秒）并与普通反馈槽分开渲染，防止有时限的撤销被随后的纯文字提示顶掉；goals 侧（`GoalGraphEditor` / `GoalGalaxyCanvas`）走目标图自带的 `GoalGraphUndoToast`（默认 5 秒，以 `message` 为身份键重置计时）。两套的差别只在组件与撤销窗口宽度，文案与回退口径同源。**删除任务刻意不解链**：轨道是独立过程史，任务删除（含 `markOccurrenceSkipped`）后轨道保留、其 task ref 成为失效引用，同 Goal 对失效成员的既有处置。refs 自由编辑器仍推迟。

导航「轨道」图标带回手 badge(TK-12):`useTrackAttentionCount` 用 `useLiveQuery` 统计当前看板信号命中「待我处理」约定(=第一个配置的看板信号)的 active 轨道数;经 `TrackAttentionContext`(默认 0,Provider 挂在 `App` 默认导出、db 可用层)下发,桌面侧栏 `NavIconLink` 与移动底栏 `MobileIconLink` 用 `NavBadge` 在 `/tracks` 图标上显示计数。纯统计 `countAttentionTracks` 可单测;无 Provider(如只渲染导航的单测)读默认 0、不触 db、不显 badge。

## 6. 人手共编(T5)

详情页是轻量共编入口,只写 `track_steps` / `tracks`,不编辑 agent 原文、不加领域字段、不写 `TimeEntry`。人手写一步的 mode 由 `resolveStepMode(signal, tags)`(StepComposer) 判定：带看板信号=状态交接→`open`，开一个 `source="user"`、`endedAt=null` 的当前步并闭合全部旧开口步；无信号且只是点记(`批注`/`提醒`)→`instant`(`endedAt=startedAt`)，**不打断进行中的开口步**；其余(纯正文推进 / `决策` / 自定义标签)仍走 `open`。

`决策 / 批注 / 提醒` 是普通快捷标签，不驱动特殊底色或“决策步”徽标。开口语义只留给“真在做一段事”的步骤：步骤历时不再作为设计卖点(见 §8)，随手批注/提醒因此走 `instant`，避免截断 agent 的开口段、也避免点记自己挂成“进行中 N 天”。看板信号单选、检索标签多选，三组并存不互斥(`StepComposer`)。

另有 `closeCurrentStep`(闭合全部开口步、不前进;无开口步报错)与 `setTrackStatus`(切 active/concluded/parked;`concluded` 顺手闭合全部开口步,镜像 T2 的 `PATCH`)。`setTrackStatus` 在状态**真正改变**时写一条 instant 系统步(`source="user"`、`endedAt=startedAt`、content 为 `归档`/`重新推进`/`搁置`)留痕(TK-18),让归档/重新推进在时间线可查;状态未变则不写。这些都只写 Dexie + `syncLog`,写入经 `recordSyncLog` 自动调度上传(见 [sync/realtime-and-scheduler](sync/realtime-and-scheduler.md#sync-realtime-and-scheduler-s2)),不需要 UI 手动触发;数据层不按状态拦写入,改由详情页只对 `active` 显示加步/闭合入口。

产品生命周期收敛为 `推进中 / 已归档`：active 显示 `推进中` 和 `归档` 按钮；归档写底层 `concluded` 并闭合开口步；旧数据里的 `parked` 只兼容读取为 `已归档`，非 active 统一显示 `重新推进`。user 步可就地编辑正文或删除，agent 步只读；轨道本身可从详情页二次确认后删除，删除时显式写每条步骤 tombstone。批注串联到具体步(`ref{kind:"track_step"}`)、自由 refs/tags 编辑器仍推迟。

## 7. 看板信号与步骤检索标签

`TrackStep.tags` 首先是步骤检索辅助。普通标签如 `决策 / 批注 / 提醒 / 自定义标签` 不表达生命周期、不表达写者，也不进入列表聚合，除非用户在 `/settings/tracks` 主动把它们加入看板信号配置。

看板信号配置写 `track.actionTags.v2`。新写入是 JSON 字符串数组；未配置时种子为 `待我处理 / agent在做`。旧 `track.actionTags.v1` 只作读时影子源；早期 v2 的 `{tag,court}` 数组兼容读取但只消费 `tag` 文本并忽略 `court`。读到旧默认 `[等我,待决策,卡住,agent在做]` 时归一为新默认两件套；显式 `[]` 仍表示没有看板信号。

每条 active 轨道的当前看板信号 = 按语义时间倒序查找最近一条带已配置看板信号的 step；同一步有多个信号时按配置顺序取第一个。无标签步骤和普通检索标签步骤不会清掉已有信号。比如 `agent在做` 之后补一条 `决策` 或无标签步骤，列表仍显示 `agent在做`，直到后续步骤写入新的已配置看板信号。

看板信号计算在 `packages/shared/src/trackBoardSignals.ts`，client `tracksView.ts` 与 server agent context API 共用同一纯函数：按语义时间倒序找最近一条含已配置看板信号的 step；同一步多个信号时按 `boardSignals` 顺序取第一个；无标签步骤和普通检索标签不清空已有信号。语义时间比较器在 `packages/shared/src/trackStepOrder.ts`，client/server 的当前步、最新步和看板信号都走同一口径。

`/tracks` 列表的分组、统计带与状态卡展示见 §8（调度台按判定优先级分组，不再是扁平列表+顶部 chip OR 筛选）。

agent 接力协议：派活时给 agent `trackId` 和当前看板信号词表；人手可先 append 一步打 `agent在做`。agent 完成或需要人接手后经 `/api/agent/tracks/:id/steps` append 一步，打 `待我处理` 或用户当前配置中的等价看板信号。append 自动闭合全部旧开口步；该步成为看板当前信号，直到后续步骤写入新的已配置看板信号。

**标签由调用方传，服务端不注入默认值**：append 端点的 `tags` 是可选字段，缺省落空数组。不带 tags 的 append 是一条无标签步骤，按上面的信号规则**不清空也不推进**已有信号——看板上那条轨道会停在 agent 接手前的信号，看不出它在等人。所以"交接回人"这层语义完全由调用方显式打标签承载，服务端不会替它补。

**「打 `待我处理`」是协议对调用方的要求，不是服务端会补的默认值**：端点的 `tags` 是可选字段，缺省落 `[]`（`endedAt` 才是真由服务端默认成 `null` = 开口）。agent 漏带标签时这一步照样写入、照样闭合旧开口步，但看板信号**不会**前进到 `待我处理`——轨道静悄悄停在上一个信号上，回手 badge 也不亮。想让它成为服务端保证就得改 API 加默认值，当前不是。

本地续写协议的单一事实源是 `track-step` skill 的 `SKILL.md`（平台无关，任何能跑 shell/Node 的 agent 通用；技术契约见同目录 `references/api.md`，执行器 `scripts/td-track.mjs`）。**它是 Claude Code skill，按 skill 的常规两处安装位查**：用户级 `~/.claude/skills/track-step/` 或项目级 `<repo>/.claude/skills/track-step/`；两处的 `.claude/` 都是本地 AI state，都不入 Git，所以在仓库里找不到它是正常的、不代表协议退役（服务端 `/api/agent/tracks/:id/steps` 端点在不在才是判据）。evergreen 只记录指针和端点契约，不复制协议正文。协议要求 agent 被用户显式召回后先读 context、保守匹配已有 active track、命中后写 step、未命中时回报建议新建标题，且写入或未写入都必须给回执。

<a id="tracks-s8"></a>

## 8. 状态卡与调度台（含宽屏 master-detail）

track 定位 = 每条工作流的存档点（状态卡）+ /tracks 调度台；当前帧 = 最新一步的投影（写新步=覆盖当前帧、编辑最新步=修正当前帧），零 schema 改动。/tracks 顶部统计带「等我接 N · agent 在跑 M · 等外部 W · 停滞 K」答"此刻几条在并发"（停滞 K 是跨组提醒计数=`stalledDays !== null` 的条目数，不是组）；每条 active 轨道一张状态卡（标题+最新步内容 2-3 行+信号徽章+最后动静，计时弱化不显历时/步数；卡上保留行内「写一步」composer——appendUserStep 就地追加），按调度语义分组：判定优先级=等我接（信号命中 actionTags[0]）> agent在跑（信号命中 agentExecTags）> 等外部（信号命中 waitExternalTags，settings `track.waitExternalTags.v1` 默认 `等外部`）> 推进中；**停滞退出分组判定**（[ADR 0035](../adr/0035-track-milestones-and-signal-priority.md)），降为行上提醒 `stalledDays`（最后动静>7 天给整天数、无步轨道用 createdAt 兜底，各组都标"N 天没动静"）——信号是用户宣告的，系统只提醒不改判；显示序=等我接→agent在跑→等外部→推进中，组内最后动静倒序，空组不渲染。信号口径=`latestTrackBoardSignal`（最近一个带信号的步，同导航 badge / goals 候选——中途补无信号步不清除信号）。agent 在跑消费独立 Track signal tone；它不是动作色、模块署名色或 Goal 色，本文不复制具体 hex/className（见 [design-language](design-language.md#design-language-s1)）。纯函数层 `packages/client/src/lib/tracksDispatch.ts`（node 快桶单测）。详情页倒置：顶部当前帧卡（最新步全文+就地编辑/删除，只显示"X 前"）→ StepComposer（写入即成为新当前帧）→ 闭合当前步（次要）→「历史 N 步」默认折叠（hash 锚点命中历史步时自动展开；折叠/中段折叠语义在 TrackTimeline 内不变）。宽屏（≥1024px）`TracksShell`：左列调度台常驻（400px、独立滚动）+ 右栏随路由（/tracks=空态提示、/tracks/:id=详情），选中卡 accent 边框；窄屏壳纯透传。并发甘特（2026-07-08~09）已整体退役：甘特回答"什么时候有动静"、适合规划未来的并发，本场景要的是"此刻横切面"，由调度台分组+统计带承接。todo 行徽章与勾选联动归档消费同一信号口径与 `setTrackStatus`（入口在 todo 侧，见 [todo](todo.md)）。

## 9. 后续阶段

- track-workbench metaspec（docs_local）阶段2 起消费本阶段地基：/tracks/:id workbench（骨架编排+分段条）、todo 轨道桶与手头抓取、项目储备四件套。
- 仍待后续:批注串联到具体步(`ref{kind:"track_step"}`)、自由 refs/tags 编辑器。
- **步骤「历时」不作设计卖点**：`formatStepDuration` 产出的历时仅作展示辅助,不做时间统计桥(历时聚合进 Stats 已放弃);轨道步骤的历时不写入 `time_entries`。开口/瞬时之分因此只服务于时间线可读性(开口步=正在进行的段),不服务于计量。
- 不接 TimeEntry 写入，不改 todo 子任务模型；扩展靠 `refs`/`tags` 与各领域自己的表，不给 schema 补领域字段。
