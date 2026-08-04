---
type: evergreen
title: 日记 · 参考栏（只读）
covers:
  - packages/client/src/pages/diary/DiaryRef*.tsx
  - packages/client/src/lib/diary/diaryRefEntries.ts
  - packages/client/src/lib/diary/diaryRefEntriesQuery.ts
  - packages/client/src/lib/diary/diaryRefTasks.ts
  - packages/client/src/lib/diary/diaryRefPrefs.ts
last-reviewed: 2026-08-04
---

# 日记 · 参考栏（只读）

> 讲什么：宽屏右栏四块（今天的打点 / 完成的待办 / 速记，回看的昨天 / 上周今日）的布局挂载、数据口径、错误围栏、回看块的两道闸。
> 不讲什么：日记正文的读写与日期语义（见 [diary](../diary.md)）、编辑器键位（见 [diary/editor](editor.md)）。

## 承上启下

- **上游**：`DiaryPage.tsx` 宽屏时把 textarea 包进 `ResizableSplit`，右栏挂 `DiaryReferencePanel`；窄屏整个不渲染。
- **下游**：四块各自读 Dexie（打点/完成待办/速记）或走网络（回看），**只读，不向正文写一个字节**。
- **契约**：只读、失败不污染主编辑区、窄屏不渲染——三条正本在 [diary](../diary.md#diary-s2) 契约 14–16。
- **邻居**：[diary](../diary.md)（主文档）、[diary/editor](editor.md)（同主题子文档）、[timeline](../timeline.md) / [todo](../todo.md) / [quick-notes](../quick-notes.md)（三个数据来源，参考栏只在 UI 层临时组装，不引用它们的数据层）。

## 1 布局与挂载

分栏底座复用 `pages/todo/ResizableSplit.tsx`，靠一个 `SplitPrefs`（存储键 + min/max/default 捆成一体）区分两个页面：待办 `0.62 / 0.35–0.7`、日记 `0.7 / 0.5–0.85`，各存各的 key。**捆成一个对象而非四个独立 prop，是为了让"只传了键、忘了传范围"这种错配在类型层就不可能发生**。

挂载点是内容三元的最后一支：`loading ? … : loadFailed ? … : !enabled ? … : template === "" ? … : (wide ? <ResizableSplit …/> : editor)`。三个 className 缺一不可——`className="min-h-0 flex-1"` + `leftClassName="flex flex-col min-h-0"` + `rightClassName="min-h-0 overflow-y-auto"`；漏掉右栏那条，内容一长会撑穿 `h-dvh` 且 `overflow-y-auto` 永不触发，textarea 的 `flex-1` 也会失效塌成内容高。**这条靠人工冒烟验证，jsdom 不算布局、自动化测不出。**

`<header>` 与跨天提示条保持在分栏**之上**、横跨两栏：页面真正的滚动容器是 App 的 `<main>`，把 header 塞进左栏内部会让 sticky 失效。

<a id="diary-reference-panel-s2"></a>

## 2 四块的数据口径

| 块 | 来源 | 口径 |
|---|---|---|
| 打点 | `listEntriesOverlappingDay(date)` + `useCategories()` | 区间重叠查出，跨零点条目**必须按日界裁剪**（`lib/diary/diaryRefEntries.ts`），否则「23:00–次日01:00」两天各显示成两小时。**不借 `useEntries`**，理由见 §4。每行按分类上色，见下 |
| 完成的待办 | `listTasks().completed` 再过滤 | 硬性三条：`done === true`（排除账本判定耗尽、混在同一桶里的重复模板）、`completedAt !== null`（**绝不回退 `updatedAt`**）、`getDateString(completedAt) === date` |
| 速记 | `listQuickNotesByDate(date)` | 现成，走 `occurredAt` 索引半开区间、日界已是 Asia/Shanghai，**不再包一层过滤** |
| 回看 | `fetchDiary(addDays(date,-1))` / `addDays(date,-7)` | 相对 `date` 而非相对真实今天。两块**一律默认收起、展开才请求**，已加载过不重复拉 |

回看两块的**措辞随 `isToday` 切**：今天说「昨天 / 上周今日」，看历史日期说「前一天 / 前七天」。口径本来就对，但看 7/20 时上半区标题写着「7月20日」、下半区说「昨天 7月19日」，屏幕上同时出现两句互相矛盾的话；非今天时一律用不带绝对时间断言的相对说法。

三个本地源一律 `getDateString`（Asia/Shanghai）。仓库存在两套日界（待办的 today/逾期判定走设备本地 `localDateString`），混用会让非东八区设备上三块内容互相差一天。

**打点行的上色与时间线逐字同款**（`DiaryRefPunches.tsx` ↔ `components/TimeSlot.tsx`）：左侧 3px 实色条 + 同色 10%（`0x1a`）底，色值取 `useCategories().getCategoryColor(categoryId)`（子分类返回父分类的颜色）。逐字复用而不是另调一套，是为了让「参考栏里的这条打点」与「时间线里的那条打点」一眼就是同一个分类——两边各调各的色，同一分类在两个页面会长得不像同一件事。

## 3 本地三块的错误通道：必须自己围 ErrorBoundary

本地三块走 `useLiveQuery`，正常路径只有 loading / empty 两态；它由 Dexie 托管订阅生命周期，**天然免掉手写「切日取消在途」的一整类竞态 bug**——参考栏在这类 bug 上返工过两次（见 [diary](../diary.md#diary-s3-5)）。本地 Dexie 读失败在实践中罕见，为它造一套 retry UI 是 YAGNI，所以三块**没有 retry 入口**，error/retry 只有走网络的「回看」块有。

**但「没有 retry 入口」不等于「没有 error 通道」**。`useLiveQuery` 的 error 通道就是**在 render 里 throw**（`dexie-react-hooks/dist/dexie-react-hooks.js`：`// Throw if observable has emitted error so that an ErrorBoundrary can catch it` / `if (monitor.current.error) throw monitor.current.error;`）。不自己围，离参考栏最近的边界是根路由的 `errorElement`（`App.tsx`），它会把**整个 app shell** 换成「应用出错了」；而日记正文只活在 `DiaryPage` 的 React state（不进 Dexie、不进同步域、不进备份），整页一掀就永久没了。

因此 `DiaryReferencePanel` 里**每块各围一层** `components/ErrorBoundary.tsx`（`RefBlock`，`fallback` 只渲染一行 `{块名}读取失败`）。逐块围而不是整栏围一层，是为了兑现 [diary](../diary.md#diary-s2) 契约 15 的字面：一块挂了，另外三块照常显示。回看块也围——它自己的 `catch` 只接住 `fetchDiary` 的 rejection，接不住渲染期抛出的错。

<a id="diary-reference-panel-s4"></a>

## 4 参考栏的四块口径都各自查，不借用页面级 hook

打点块**不走** `hooks/useEntries(date)`，走 `lib/diary/diaryRefEntries.ts:listEntriesOverlappingDay`。两条理由：

1. `useEntries` 内部是**两条** `useLiveQuery`（`entries` + `previousEntry`），本块只用前者，`previousEntry` 是几乎同构的第二次近全表扫描（`where("startTime").below(...).toArray()`），每次挂载/切日期白付一倍读取；
2. `useEntries` 写的是 `useLiveQuery(...) || []`，把「查询未回」的 `undefined` 兜底成空数组——打点块会在加载中显示「这天没有打点」，把没查完当成事实说出来，而同屏另外两块此刻写着「读取中…」，三块自相矛盾。

判据统一是 `rows === undefined`（`useLiveQuery` 未回）→ 渲染「读取中…」。查询窗口与裁剪窗口共用同一个 `diaryRefDayWindow(date)`，不许各算各的日界，否则边界条目会一边查得出、一边被裁没。

## 5 回看块的两道闸

回看是唯一走网络的一块，两道闸都应保留：

1. **世代号，不是日期比较**。`date` 变了要作废在途响应，判据用**单调递增**的 `epochRef`。用日期字符串比较会在 `A→B→A` 序列下失效（值又相等、闸不生效），这就是 ABA 问题。
2. **`await` 之后一律读活 `ref`**。React 函数组件里闭包捕获的 state 在调用开始那一刻就冻结了；`await` 之后拿它做判断，与函数入口处的同款判断**永远同值**，是「看着在防、结构上永不生效」的假闸。`epochRef.current = epoch` 写在组件体顶层每次渲染同步赋值，异步回调只读它。

> 这两条是两轮返工换来的（[diary](../diary.md#diary-s3-5) 同源），对本页所有异步分支都成立。

**这两道闸在生产路径上的实际作用面比字面小**（如实记账：它们不是主力防线）：`DiaryPage` 的内容三元里 `loading` 排第一支，而正文加载 effect 在 `date` 变化时**无条件** `setLoading(true)`——所以生产环境每次切日期，整个参考栏是被**卸载重挂**的，不是「同一实例换 props」。真正拦住「旧正文配新标签」的是那次卸载；两道 epoch 闸只在「面板不卸载而 `date` 变」的极短窗口内起作用（测试里 `root.render(...)` 直接换 props 就是这个窗口）。闸仍应保留：它是防御性的，且那条窗口不是不可能出现（比如以后有人把 `loading` 支挪到参考栏之外、或给面板加 `key` 复用）。

> **已知缺口（两道闸共用同一条承重用例）**：删掉成功分支的 epoch 守卫，原有用例照样全绿——因为切日的重置 effect 会先把块收起，两条闸保护的是同一个可观察面，「折叠态看不见旧内容」这条断言测不出闸有没有真的在起作用。真正暴露它的是**再次展开**：迟到响应若把 `state` 写成 `loaded`，`toggle()` 会因为 `state.kind` 不是 `idle` 而跳过重新请求，把上一个日期的正文渲染在新日期的标签下。已补用例「迟到响应被作废后，再次展开会重新请求而不是显示旧日期的正文」（`DiaryReferencePanel.test.tsx`）堵住这条。**「折叠态看不见旧内容」不是充分判据，判据必须落在「再次展开时会不会重新请求」上**——这是本阶段唯一一处「两道闸共用一个可观察面」的教训，值得成文。
>
> **更脆的一点**：终审做具名逃逸变异（把两处 `epochRef.current` 换成闭包变量 `epoch`）时，**只有上面那条新补的用例变红**，「A→B→A 切回原日期」那条照绿。也就是说两道闸共用**同一条**承重用例——删掉它，两道闸同时失守且无人报警。
