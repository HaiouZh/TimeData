---
type: evergreen
title: 时间轴与记录时间规则
covers:
  - packages/shared/src/types.ts:TimeEntry
  - packages/shared/src/entitySchemas.ts
  - packages/shared/src/schemas.ts
  - packages/client/src/pages/TimelinePage.tsx
  - packages/client/src/pages/EntryPage.tsx
  - packages/client/src/components/EntryForm.tsx
  - packages/client/src/components/Timeline.tsx
  - packages/client/src/components/CircularTimeline.tsx
  - packages/client/src/components/TimeRangeWheelPicker.tsx
  - packages/client/src/hooks/useEntries.ts
  - packages/client/src/lib/punch.ts
  - packages/client/src/lib/time.ts
  - packages/server/src/routes/entries.ts
  - packages/server/src/lib/entry-service.ts
  - packages/server/src/sync/domains.ts
  - packages/cli/src/commands/log.ts
last-reviewed: 2026-06-25
---

<!-- 复核 2026-06-23（目标层 Phase 1.1）：Goal.members 修正触及 shared schema / sync domains covers；TimeEntry 字段、重叠校验、CLI/server 写入语义均不变。 -->
<!-- 复核 2026-06-25（请求审计一期）：shared types 新增 AdminRequestLog* 只读导出；TimeEntry 字段、重叠校验、CLI/server 写入语义均不变。 -->

# 时间轴与记录时间规则

> 这份文档说明 `TimeEntry` 字段契约、客户端如何把记录渲染成时间轴、如何处理跨夜记录，以及新增记录页面如何解析开始/结束时间。
> 同步账本和备份机制见对应 evergreen 文档；这里只记录时间记录域本身的规则。

## 承上启下

- 上游：用户在时间轴/新增记录页写入；速记页和圆环中心可触发“打点到现在”；CLI `timedata log` 可经服务端受控 API 创建记录。
- 下游：客户端本地写 `timeEntries` 与 `syncLog(tableName="time_entries")`；CLI/server 写 SQLite 后追加 `sync_seq`；统计页按同一 `[start, end)` 交集口径读取。
- 契约：`TimeEntry` 字段 schema 见本文 §1；跨域时间、ID、SQL/Dexie 映射见 [data-model](data-model.md)。
- 邻居：[categories-settings](categories-settings.md) 管分类与打点分类设置；[stats-insights](stats-insights.md) 管统计聚合；[tracks](tracks.md) 管状态线历时；[goals](goals.md) 收编 Task/Track 但不引用 `time_entries`；[sync](sync.md) 管账本和冲突。

## 1. Schema / 契约

```ts
type TimeEntry = {
  id: string;
  categoryId: string;
  startTime: string;
  endTime: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};
```

- `id` / `categoryId` 是 trim 后非空字符串；`categoryId` 必须引用存在且未归档的分类，同批 push 新增的分类也算存在。
- `startTime` / `endTime` / `createdAt` / `updatedAt` 都是严格 UTC ISO 字符串。
- `endTime > startTime`。客户端 mutation 会先拦截，服务端同步校验会把 schema 的 `endTime` refine 映射成 `invalid_time_range`。
- `endTime` 不能晚于服务端当前 UTC；客户端也会拒绝本地未来结束时间，避免待同步队列反复失败。
- 记录区间按半开 `[start, end)` 判断。客户端保存前查重叠并可在单事务内裁剪/删除旧记录；CLI `/api/entries` 创建会拒绝重叠；同步 apply 会删除与 incoming 记录重叠的旧远端记录并写 tombstone + seq。
- `note` 是字符串或 `null`，空白备注在 UI 层归一为空值；备注不参与统计口径。
- SQLite 表名是 `time_entries`，字段是 `category_id/start_time/end_time/note/created_at/updated_at`；Dexie 表名是 `timeEntries`，索引是 `id, categoryId, startTime, endTime`。
- 任务轨道步骤也有 `startedAt -> endedAt` 历时，但那是状态线跨度，不写入 `time_entries`，也不参与本时间轴的分类统计口径。

`TimeEntry.startTime` 和 `TimeEntry.endTime` 存储为 UTC ISO 字符串（带 `Z`），例如：

```text
2026-05-07T15:57:00.000Z
2026-05-07T22:00:00.000Z
```

客户端写入前会把表单本地时间转换为 UTC，展示和时间轴计算时再按应用时区 `Asia/Shanghai` 转回本地时间。`packages/client/src/lib/time.ts` 的 `buildTimeSlots`、`formatTime`、`formatDateTimeRange` 会接受 UTC 输入；内部比较先解析为毫秒时间戳，避免混用历史本地字符串和新 UTC 字符串时产生字典序误判。

## 2. 时间轴数据来源

`TimelinePage` 根据当前日期读取：

- `entries`：与所选日期有交集的记录。
- `previousEntry`：所选日期之前、可能影响当天首段显示的上一条记录。

`useEntries(date)` 查询记录时，不只取 `startTime` 落在当天的记录；只要记录满足：

```text
entry.startTime < 次日 00:00:00 对应的 UTC 边界
entry.endTime > 当天 00:00:00 对应的 UTC 边界
```

就会进入当天时间轴候选集。这保证跨夜记录可以在前一天和后一天都被正确考虑。

`TimelinePage` 每次渲染都会重新读取当前时间；`AppShell` 的恢复刷新信号和 `useMidnightTick` 只负责触发重渲染，随后由 `buildTimeSlots` 用新的 `now` 决定今天的已流逝区间和未来区间。

## 3. 时间槽生成规则

`buildTimeSlots(entries, date, dayStartHour, options)` 把记录转换成时间轴槽位：

- 记录按解析后的时间戳升序处理。
- `dayStart` 默认是所选日期本地 `00:00:00` 转换出的 UTC 边界。
- 历史日期的 `dayEnd` 是本地次日 `00:00:00` 转换出的 UTC 边界，用于把跨夜记录截到当天结束。
- 今天的 `dayEnd` 是当前时间，避免未来空档出现在时间轴上；当调用方传入无时区的本地时间字符串作为 `now` 时，`buildTimeSlots` 按应用时区 `Asia/Shanghai` 解析，避免 CI/服务器 UTC 时区把当天末尾空档推迟 8 小时。
- 两条记录之间的空白区间渲染为 `entry: null` 的空档，点击空档进入新增记录。
- 如果当天没有更早记录，上一条记录结束在前一天且未跨过当天 `00:00`，只有当它距离当天 `00:00` 不超过 4 小时时，首段空档才从上一条结束时间开始；超过 4 小时则从当天 `00:00` 开始。

## 4. 跨夜记录显示

跨夜记录分两类展示：

1. **前一天视角**：记录从当天开始、延续到次日时，在当天时间轴上显示到 `24:00`，槽位标记为 `displayMode: "truncated"`。
2. **后一天视角**：上一条记录从前一天跨到当天，并且当天启用跨夜合并时，时间轴顶部直接显示完整记录，槽位标记为 `displayMode: "merged"`。

时间轴槽位格式化时间范围时：

- 时间轴内统一只显示时钟，不显示 `MM-DD` 日期。
- `truncated` 的结束时间显示为 `24:00`。
- 普通空档如果结束在次日 `00:00`，也显示为 `24:00`，例如 `00:07 - 24:00`。
- `merged` 只显示时钟，例如 `23:57 - 06:00`。
- 通用时间范围格式化函数仍可在时间轴外显示日期；时间轴组件使用时间轴专用格式化入口。

## 5. 避免跨夜记录重复显示

当 `previousEntry` 已经以 `merged` 方式放到所选日期顶部时，`buildTimeSlots` 会跳过 `entries` 中同 ID 的记录，避免同一条跨夜记录在当天时间轴重复出现。

合并后，空档游标从该跨夜记录的 `endTime` 继续，而不是从当天 `00:00` 重新开始。

## 6. 圆环时间轴交互

`CircularTimeline` 使用 `buildTimeSlots` 生成的同一组 `slots` 绘制 24 小时单环。视觉规则借鉴仓库内 `参考代码/` 下的环形时间轴实现，配色按 TimeData 深色主题适配。

**几何**：外半径 104、内半径 62（比例 0.6），内圈不再画底色圆，选中段的分类色作为指针填色暗示；每段都是两个同心圆之间的闭合 SVG 环形扇区，段首段尾由径向直线切分，不用圆头粗线描边。

**段配色**：所有段一律 100% 不透明。`slot.kind === "entry"` 用分类色；`"gap"`（已过、未填）用 `rgb(100 116 139)`（slate-500 暖灰）；`"future"`（今天 `now → 24:00` 尚未到达）用 `rgb(30 41 59)`（slate-800，比底色 slate-700 更暗一档），并禁用点击交互。`buildTimeSlots` 在当日还有“未到达”区间时显式追加 `kind: "future"` 的 slot，列表组件 `Timeline.tsx` 会过滤掉该段，圆环则保留以维持“一整圈被填满”的视觉。

**刻度**：三层刻度——144 个 10 分钟微刻度（弱、短），每隔 3 个升级为半点刻度，每隔 6 个升级为整点刻度（最长、最亮）；在 RADIUS 中线位置标 0–23 全部整点数字，0/6/12/18 加粗作为锚点。文字以深色描边压在分段之上避免被分类色淹没。

**中心打点**：中心大圆是固定的打点入口（⏱ + “打点到现在”），点击调用 `punchNow`（规则同速记页 header 打点：起点=今天最后一条记录 end，否则今天 0 点，分类取 `设置 → 记录偏好 → 打点分类` 绑定的子分类），成功后 `syncAfterWrite`；未配置或分类失效时不写记录并显示提示。中心不再展示选中段信息、也不再承担编辑/补录跳转——查看、编辑记录与补录空档全部交给下方的 `Timeline` 列表（点记录进编辑页、点空档进新增页并带 `start` / `end` / `date`）。环面仍保留选中态：当槽位变化时默认选中最后一个空档、否则退选最后一条记录、`future` 段永不进入默认选中，用于高亮与指针箭头，但不驱动中心。`onEntryOpen` / `onGapOpen` 降为可选 prop、保留兼容但中心已不使用。

时间轴页在圆环后直接进入时间流列表，不再保留独立的日覆盖率卡片；覆盖率、时长分析等汇总口径保留在统计页，不作为时间轴页 standalone UI。

**指针交互**：圆环 `<svg>` 监听 `pointerDown` / `pointerMove` / `pointerUp`，按指针位置反算角度（atan2 + 12 点钟为 0 顺时针递增）→ 当日分钟数（0–1440）→ 落在哪段就把 selection 切到哪段。`future` 段在拖拽过程中不切 selection。pointerDown 后调用 `setPointerCapture`，touch-action 设为 none，避免与垂直滚动竞争。指针箭头以 `ARROW_TIP_RADIUS`（环带靠内 25% 处）为尖、`ARROW_BASE_RADIUS`（内半径再向内 4px）为底，由内指向外；箭头位置由 `dragMinutes ?? selectedMidpoint` 驱动——任意 pointer 交互后箭头停在用户拖到的分钟数（无极、不吸附），只在 `initialSelection` 重算（切日期、记录变化等）时回到默认选中段中点。

统计页的日/周/月分类汇总与时间轴使用同样的本地日期边界和 `[start, end)` 交集口径；具体模块、基线、异常、布局和图表行为见 [stats-insights](stats-insights.md)。本文只保留时间轴如何生成和展示时间槽。

## 7. 时间轴同步状态指示器

时间轴页的圆环容器右上角显示同步状态圆点。圆点由 `packages/client/src/components/SyncIndicator.tsx` 渲染，挂在 `CircularTimeline` 的 overlay 插槽上；圆环本身的 SVG 绘制和选中段展示仍由 `CircularTimeline` 负责。

状态来自 `packages/client/src/contexts/SyncContext.tsx`：

- 灰色：云同步未启用。
- 绿色：空闲或最近一次同步成功。
- 黄色：正在同步，使用 1.5 秒 opacity 脉冲动画。
- 红色：最近一次同步失败，使用 2.5 秒 opacity 慢闪动画。

该指示器是纯展示，不可点击；同步详情和手动修复入口仍在设置页。

## 8. 新增记录的默认时间

新增记录页面优先使用 URL query 中的 `start` 和 `end`：

```text
/entries/new?start=...&end=...
```

这些参数通常来自点击时间轴空档。也就是说，新增记录默认开始时间主要由时间轴空档生成逻辑决定，而不是由新增页单独推断。

当新增记录页通过时间轴空档进入时，URL 里的 `start` 和 `end` 是唯一可信的空档边界；这些参数可能是本地时间字符串，也可能是时间轴槽位直接带出的 UTC ISO 字符串，新增页会先转换成应用本地时间再作为默认值。只有直接打开 `/entries/new` 且没有任何有效时间参数时，才允许读取本地上一条记录结束时间作为默认开始时间。

当客户端从后台恢复到前台时，应用会重新读取当前时间并刷新时间相关页面。时间轴会用新的当前时间重新生成今天的末尾空档；新增记录页在没有 URL 时间参数时也会重新计算默认开始/结束时间，避免沿用上一次可见时的“现在”。

时间轴页还使用 `useMidnightTick`（`packages/client/src/hooks/useMidnightTick.ts`）调度本地午夜定时器：长时间停留在前台、跨过 00:00 时，会主动把 `now` 推进到新的一天，避免今天的末尾空档卡在昨天的结束时间。

当所选日期当天没有更早记录，而前一天最后一条记录在当天开始前结束，首个空档可从前一天最后结束时间开始，不固定从 `00:00` 开始。点击首个空档新增记录时，会接上昨天最后一条。时间轴页 `findPreviousEntry()` 先按 `startTime < dayStart` 取候选，优先返回 `endTime > dayStart` 的跨日记录；否则过滤 `endTime >= previousDayStart` 并按 `endTime` 倒序取最近记录。

直接打开新增页且没有 URL `start/end` 参数时，默认开始时间才用 `findLatestEntryEndingBefore()`：它通过 Dexie `endTime` 索引倒序取当天 UTC 边界前结束的最近记录，避免把所有候选拉到内存排序。

这个接续只允许来自所选日期的前一天，并且上一条记录结束时间必须距离当天 `00:00` 不超过 4 小时。结束时间早于前一天 `20:00` 时，当天首个空档从当天 `00:00` 开始，避免很久以前的记录制造跨日长空档。

## 9. 时间选择器的跨夜解析

新增/编辑记录时，时间选择器允许用户只调整时钟。保存和顶部时长展示都使用同一套解析规则：

- 如果结束时钟晚于开始时钟，开始日期就是结束日期。
- 如果结束时钟早于或等于开始时钟，开始日期回退到结束日期的前一天。

例如在结束日期 `2026-05-08` 下选择 `23:53 -> 08:01`，实际范围是：

```text
2026-05-07T23:53:00 -> 2026-05-08T08:01:00
```

顶部“本次记录时长”和最终保存必须使用同一个解析结果，避免出现保存为跨夜记录但 UI 显示 `0分钟` 的问题。

跨午夜场景之外，新增记录页的”逻辑日期”由 URL `date=YYYY-MM-DD` 参数显式决定。TimelinePage 在空挡跳转时把当前 timeline 的 `date` 一起带过去；EntryPage 读取后，作为表单 `end.date` 的锚，并把 `defaults.end` 钉到 `${date}T23:59:00`（非今天）或当前时刻（今天），避免”昨天尾部空挡的 dayEnd 实际是次日 00:00”导致表单悄悄滑到今天。`resolveClockRangeAroundEndDate` 因此只保留”endClock <= startClock 时把 start 日期前移一天”这一条规则，不再根据”endTime 落在未来”自动推一天；用户真要补昨天就应当先切到昨天的 timeline。表单顶部不再有”已识别为…”蓝字提示。点保存时 `EntryPage.handleSave` 走单一流程：`isFutureLocalDateTime` 兜底（手填的未来 endTime 直接红字”不能记录尚未发生的时间”），否则查重叠，按既有”切两段阻断 / 多条裁剪确认”弹窗处理。新增或编辑记录保存成功后，返回的时间轴日期按表单本地时间决定：同日记录回到开始日期；跨天且结束时间不是 `00:00` 的记录回到结束日期，便于保存 `22:00 -> 05:00` 后直接看到完成日的跨夜合并段；跨天但精确结束在 `00:00` 的记录仍回到开始日期，因为 TimeData 的时间段按 `[start, end)` 处理，下一天没有可见时长。

`TimeRangeWheelPicker` 的滚轮选择行为已抽到共享 `packages/client/src/components/Wheel.tsx`；时间记录页面仍通过 `TimeRangeWheelPicker` 组合时、分两列并保留原有解析规则，共享组件只复用滚动索引、吸附与无框滚轮交互，不改变新增/编辑记录的时间语义。

`useEntryMutations` 是客户端本地写入 `timeEntries` 和 `syncLog` 的边界。`addEntry` 和 `updateEntry` 在写入 IndexedDB 前会再次校验 `endTime > startTime` 且 `endTime` 不晚于当前本地时间，防止绕过表单的未来记录进入本地待同步队列并被同步反复重试。`addEntry` / `updateEntry` / `deleteEntry` 的业务表写入与 `syncLog` 追写同处一个 Dexie transaction；同步日志写入失败时，记录新增、编辑或删除都会整体回滚。新增/编辑记录页如果检测到可自动处理的重叠记录，会在用户确认后调用事务级保存入口：旧记录截断或删除、目标记录写入、对应 `syncLog` 追写都在同一个 Dexie transaction 里完成；如果目标记录保存失败，重叠调整和同步日志一起回滚。记录保存或删除成功后，页面调用 `SyncContext.syncAfterWrite()`，在 1.5 秒防抖窗口后把本地待同步日志推到服务器；进入时间轴页的对账兜底仍由 `syncIfStale()` 走较长节流。

## 10. 相邻记录合并

合并是“表单时间边界的快捷调整”，不是立即写库：点“向上合并”把表单开始时间设为上一条记录的开始时间，点“向下合并”把表单结束时间设为下一条记录的结束时间。

相邻关系按严格边界相等判定：上一条 `endTime === 当前开始`，下一条 `startTime === 当前结束`。`EntryForm` 通过 `useAdjacentEntriesForRange` 以表单当前时间范围实时查询，所以新增页从时间轴空档进入、编辑页调整时间后，都能在存在严格相邻记录时显示合并按钮。

真正写入仍只走保存流程：`EntryPage.handleSave()` 经 `findOverlappingEntries` / `planEntryOverlapAdjustments` 弹覆盖确认，再由 `saveEntryWithOverlapAdjustments()` 在单个 Dexie transaction 里把被并入的相邻记录裁剪或删除。编辑态语义是当前记录扩展并存活，相邻记录保存时被并入删除；点“向上合并/向下合并”时，`EntryForm` 会把表单分类同步到被并入的上一条/下一条记录，备注仍归当前记录。

如果旧版本或设备时钟偏移已经把未来结束记录写进本地 IndexedDB，当前客户端不再提供单条本地未来记录修复入口。用户应先校准设备时间；若异常记录导致同步持续失败，可在 `设置 → 数据设置 → 高级 · 数据恢复` 中运行同步诊断，并在确认云端数据正确时使用“将本地数据替换为云端数据”恢复本地数据。

## 11. 模块速查

| 关注点 | 入口 |
|---|---|
| 类型 / schema | `packages/shared/src/entitySchemas.ts`、`packages/shared/src/types.ts` |
| 客户端查询与写入 | `packages/client/src/hooks/useEntries.ts` |
| 页面 | `packages/client/src/pages/TimelinePage.tsx`、`packages/client/src/pages/EntryPage.tsx` |
| 时间轴组件 | `packages/client/src/components/Timeline.tsx`、`packages/client/src/components/CircularTimeline.tsx`、`packages/client/src/components/TimeRangeWheelPicker.tsx` |
| 时间工具 | `packages/client/src/lib/time.ts`、`packages/client/src/lib/punch.ts` |
| 服务端受控写入 | `packages/server/src/routes/entries.ts`、`packages/server/src/lib/entry-service.ts` |
| 同步域钩子 | `packages/server/src/sync/domains.ts` 的 `time_entries` |
| CLI | `packages/cli/src/commands/log.ts` |
| 代表测试 | `useEntries.test.ts`、`TimelinePage.test.tsx`、`EntryPage.test.tsx`、`time.test.ts`、`entry-service.test.ts`、`routes/entries.test.ts`、`commands/log.test.ts` |
