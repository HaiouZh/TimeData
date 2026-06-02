---
type: evergreen
title: 时间轴与记录时间规则
covers:
  - packages/client/src/pages/TimelinePage.tsx
  - packages/client/src/pages/EntryPage.tsx
  - packages/client/src/pages/StatsPage.tsx
  - packages/client/src/components/Timeline.tsx
  - packages/client/src/components/CircularTimeline.tsx
  - packages/client/src/components/TimeRangeWheelPicker.tsx
  - packages/client/src/hooks/useEntries.ts
  - packages/client/src/lib/stats.ts
  - packages/client/src/lib/time.ts
last-reviewed: 2026-06-02
---

# 时间轴与记录时间规则

> 这份文档说明客户端如何把 `TimeEntry` 渲染成时间轴、如何处理跨夜记录，以及新增记录页面如何解析开始/结束时间。
> 同步、备份和服务端校验规则见对应 evergreen 文档；这里只记录用户可见的客户端时间表现。

## 1. 时间字段约定

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

**中心三行**：顺序为 `HH:mm - HH:mm` / 分类路径或“待记录” / 时长，直接绘在卡片底色之上（不再有内圈填色圆）。点击中心按钮才执行跳转——记录进入编辑页，空档进入新增页并通过 URL query 带上 `start` / `end`、`date`。当槽位变化时默认选中最后一个空档；若没有空档则退选最后一条记录；`future` 段永远不会进入默认选中。

**指针交互**：圆环 `<svg>` 监听 `pointerDown` / `pointerMove` / `pointerUp`，按指针位置反算角度（atan2 + 12 点钟为 0 顺时针递增）→ 当日分钟数（0–1440）→ 落在哪段就把 selection 切到哪段。`future` 段在拖拽过程中不切 selection。pointerDown 后调用 `setPointerCapture`，touch-action 设为 none，避免与垂直滚动竞争。指针箭头以 `ARROW_TIP_RADIUS`（环带靠内 25% 处）为尖、`ARROW_BASE_RADIUS`（内半径再向内 4px）为底，由内指向外；箭头位置由 `dragMinutes ?? selectedMidpoint` 驱动——任意 pointer 交互后箭头停在用户拖到的分钟数（无极、不吸附），只在 `initialSelection` 重算（切日期、记录变化等）时回到默认选中段中点。

统计页的日/周/月分类汇总使用 `packages/client/src/lib/stats.ts`。它和时间轴使用同样的本地日期边界：先用 `localDateTimeToUtc()` 生成统计窗口，再按 `entry.startTime < rangeEnd && entry.endTime > rangeStart` 找出与窗口有交集的记录，最终只累计落在窗口内的可见时长。对合法且不晚于当前时间的记录，日统计与同一天时间轴使用一致的本地日期交集口径；统计展示会按 0.1 小时取整。跨日记录只统计落在当天或统计窗口内的部分。

统计页的数据洞察增强由 `packages/client/src/lib/insights/` 下的纯函数承担：`overview.ts` 负责按统计窗口裁剪后的总时长、父分类到子分类占比、记录覆盖率；`routine.ts` 负责把睡眠分类记录按醒来日期归属，计算入睡、起床、睡眠时长和通常睡眠窗口。`dailyRollup.ts` 会先按本地午夜边界预聚合日桶，`cache.ts` 在 React 外用条目/分类指纹缓存日桶和重型洞察结果，让统计页切换周期、离开后重进、同日刷新时复用未变数据。睡眠分类的正式入口在 `/settings/insights`，设置值来自同步 settings 表；统计页通过 React Router `Link` 进入设置页，Android WebView 内不会触发整页外部跳转。未配置时，覆盖率按全天估算，异常睡眠窗口回退到默认 23:00~07:00。

统计页的 Dexie 查询以近 90 天基线窗口为超集，当前周期和默认趋势窗口优先从该超集内存切片；只有窗口早于基线起点时才回退独立查询。图表集中在 `packages/client/src/pages/stats/InsightCharts.tsx`，由 `React.memo` 包裹：环形图 `CategoryDonut`（中央覆盖层叠加总时长与覆盖率）和趋势折线/面积图基于 Recharts、固定高度，页面通过 `packages/client/src/hooks/useInView.ts` 等图表区进入视口后再挂载；父分类→子分类构成条 `CategoryCompositionBars` 是纯 CSS 分段条（点击父分类展开子分类明细），连同文字洞察在总览区即时渲染，不走视口门控。

统计页顶部的「日 / 周 / 月」切换按钮都显式声明 `type="button"`，并通过 `aria-pressed` 暴露当前选中的窗口模式，方便屏幕阅读器和键盘用户感知切换；窗口内没有数据时统一显示「暂无统计数据」占位。相关测试在 `packages/client/src/pages/StatsPage.test.tsx`。

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

当所选日期当天没有更早记录，但前一天最后一条记录在当天开始前结束，例如 `23:30`，当天首个空档可以从前一天最后结束时间开始，而不是固定从 `00:00` 开始。这样点击首个空档新增记录时，会自然接上昨天最后一条记录。客户端查找这条记录时使用 Dexie `endTime` 索引按倒序取第一条，仅取当天 UTC 边界之前结束的最近记录，不把所有候选记录拉到内存排序。

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

跨午夜场景之外，新增记录页的”逻辑日期”由 URL `date=YYYY-MM-DD` 参数显式决定。TimelinePage 在空挡跳转时把当前 timeline 的 `date` 一起带过去；EntryPage 读取后，作为表单 `end.date` 的锚，并把 `defaults.end` 钉到 `${date}T23:59:00`（非今天）或当前时刻（今天），避免”昨天尾部空挡的 dayEnd 实际是次日 00:00”导致表单悄悄滑到今天。`resolveClockRangeAroundEndDate` 因此只保留”endClock <= startClock 时把 start 日期前移一天”这一条规则，不再根据”endTime 落在未来”自动推一天；用户真要补昨天就应当先切到昨天的 timeline。表单顶部不再有”已识别为…”蓝字提示。点保存时 `EntryPage.handleSave` 走单一流程：`isFutureLocalDateTime` 兜底（手填的未来 endTime 直接红字”不能记录尚未发生的时间”），否则查重叠，按既有”切两段阻断 / 多条裁剪确认”弹窗处理。

`useEntryMutations` 是客户端本地写入 `timeEntries` 和 `syncLog` 的边界。`addEntry` 和 `updateEntry` 在写入 IndexedDB 前会再次校验 `endTime > startTime` 且 `endTime` 不晚于当前本地时间，防止绕过表单的未来记录进入本地待同步队列并被同步反复重试。`addEntry` / `updateEntry` / `deleteEntry` 的业务表写入与 `syncLog` 追写同处一个 Dexie transaction；同步日志写入失败时，记录新增、编辑或删除都会整体回滚。新增/编辑记录页如果检测到可自动处理的重叠记录，会在用户确认后调用事务级保存入口：旧记录截断或删除、目标记录写入、对应 `syncLog` 追写都在同一个 Dexie transaction 里完成；如果目标记录保存失败，重叠调整和同步日志一起回滚。记录保存或删除成功后，页面调用 `SyncContext.syncAfterWrite()`，在 1.5 秒防抖窗口后把本地待同步日志推到服务器；进入时间轴页的对账兜底仍由 `syncIfStale()` 走较长节流。

如果旧版本或设备时钟偏移已经把未来结束记录写进本地 IndexedDB，当前客户端不再提供单条本地未来记录修复入口。用户应先校准设备时间；若异常记录导致同步持续失败，可在 `设置 → 数据设置 → 高级 · 数据恢复` 中运行同步诊断，并在确认云端数据正确时使用“将本地数据替换为云端数据”恢复本地数据。
