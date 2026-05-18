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
last-reviewed: 2026-05-18
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

`CircularTimeline` 使用 `buildTimeSlots` 生成的同一组 `slots` 绘制 24 小时单环。圆环参考 iTime 的单环时间轴：每个记录或空档都是两个同心圆之间的闭合 SVG 环形扇区，段首段尾由径向直线切分，而不是用圆头粗线描边。记录槽位用分类颜色填充，空档槽位用低透明度灰色填充；点击圆环上的任意记录或空档只会切换当前选中段，不会立即跳转。

刻度线压在圆环带内部（`OUTER_RADIUS - 4` 到 `INNER_RADIUS + 4`），刻度数字 `0, 2, 4, ..., 22` 居中在圆环带中线上，文字以深色描边压在分段之上，避免被分类色淹没；圆环和中心圆之间的间隙完全留白，给中心信息让位。选中段会叠加同色描边，并在圆环外侧画一个朝向中心的三角形指示器，比之前的引线 + 小圆点更显眼。圆心展示当前选中段的分类路径或“待记录”、时长和时间范围。点击圆心按钮才执行跳转：记录进入编辑页，空档进入新增页并通过 URL query 带上 `start` / `end`。当槽位变化时，默认选中最后一个空档；如果没有空档，则选中最后一条记录。

统计页的日/周/月分类汇总使用 `packages/client/src/lib/stats.ts`。它和时间轴使用同样的本地日期边界：先用 `localDateTimeToUtc()` 生成统计窗口，再按 `entry.startTime < rangeEnd && entry.endTime > rangeStart` 找出与窗口有交集的记录，最终只累计落在窗口内的可见时长。对合法且不晚于当前时间的记录，日统计与同一天时间轴使用一致的本地日期交集口径；统计展示会按 0.1 小时取整。跨日记录只统计落在当天或统计窗口内的部分。

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

当所选日期当天没有更早记录，但前一天最后一条记录在当天开始前结束，例如 `23:30`，当天首个空档可以从前一天最后结束时间开始，而不是固定从 `00:00` 开始。这样点击首个空档新增记录时，会自然接上昨天最后一条记录。

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

`EntryForm` 会用解析后的 `nextEndTime` 派生即时错误：结束时间在未来时，顶部“本次记录时长”区域直接显示“不能记录尚未发生的时间”，不等到用户点击保存后才提示。保存时仍复用同一个错误状态，不调用保存回调；这条规则同时作用于新增和编辑记录。

`useEntryMutations` 是客户端本地写入 `timeEntries` 和 `syncLog` 的边界。`addEntry` 和 `updateEntry` 在写入 IndexedDB 前会再次校验 `endTime > startTime` 且 `endTime` 不晚于当前本地时间，防止绕过表单的未来记录进入本地待同步队列并被同步反复重试。`addEntry` / `updateEntry` / `deleteEntry` 的业务表写入与 `syncLog` 追写同处一个 Dexie transaction；同步日志写入失败时，记录新增、编辑或删除都会整体回滚。新增/编辑记录页如果检测到可自动处理的重叠记录，会在用户确认后调用事务级保存入口：旧记录截断或删除、目标记录写入、对应 `syncLog` 追写都在同一个 Dexie transaction 里完成；如果目标记录保存失败，重叠调整和同步日志一起回滚。

如果旧版本已经把未来结束记录写进本地 IndexedDB，用户可在 `设置 → 数据设置 → 本地未来记录修复` 中检查并删除这类当前设备本地记录。该入口只删除本地 `timeEntries`，不直接修改服务器数据库。对已同步过的记录，删除会按正常删除语义写入 `syncLog delete`；对本地创建后从未成功同步的记录，修复会把对应未同步 create 轨迹标为已处理（新数据用 `synced=1`），避免下次同步继续推送这条未来记录。
