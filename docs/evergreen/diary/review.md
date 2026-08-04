---
type: evergreen
title: 日记 · 回顾页
covers:
  - packages/client/src/lib/diary/reviewDates.ts
  - packages/client/src/lib/diary/reviewMarkdown.ts
  - packages/client/src/lib/diary/reviewPrefs.ts
  - packages/client/src/pages/diary/review/DiaryMarkdown.tsx
  - packages/client/src/pages/diary/review/DiaryReviewPage.tsx
  - packages/client/src/pages/diary/review/ReviewCard.tsx
  - packages/client/src/pages/diary/review/WeekColumn.tsx
contracts:
  - packages/client/src/lib/diary/diaryApi.ts
  - packages/client/src/lib/diary/reviewDates.ts
  - packages/client/src/lib/diary/reviewMarkdown.ts
  - packages/client/src/lib/diary/reviewPrefs.ts
  - packages/client/src/pages/diary/review/DiaryMarkdown.tsx
  - packages/client/src/pages/diary/review/DiaryReviewPage.tsx
  - packages/server/src/routes/diary.ts
last-reviewed: 2026-08-04
---

# 日记 · 回顾页

> 母主题：[diary](../diary.md)。本文管 `/diary/review`：按历史同日、近三日和周览回看 vault 中的日记文件。
> 不管正文编辑器、mtime 并发守卫和参考栏；分别见 [diary](../diary.md)、[diary/editor](editor.md)、[diary/reference-panel](reference-panel.md)。

## 1. 模式与日期口径

回顾页有三种模式：

| 模式 | 日期集合 |
|---|---|
| A | 最近 N 年的同月同日与前一天同月同日，按年份回看 |
| B | 锚定日前三天，不含锚定日 |
| C | 上周与本周的 ISO 周览，周一为首 |

年份范围偏好默认 5，最小 1、最大 10；非法值回默认，写入时 clamp。模式偏好只接受 `A/B/C`，B 模式布局偏好只接受 `grid/list`，坏值都回默认。三项偏好存 localStorage，不进 Dexie `settings` 同步表。

`sameDayInYear` 对闰年 2 月 29 日有固定折算：目标年份没有 2 月 29 日时落到 2 月 28 日。ISO 周用“本周四所在年”确定 week year，避免跨年周被错误归到日历年。

## 2. 数据流与页面状态

`DiaryReviewPage` 复用 `resolveDiaryDate` 读取当前日期，但回顾页只读，所以无参视图可以跟随实时今天。切日期使用 `replace`，周览左右步进 7 天；冷入口的返回兜底在挂载时冻结，避免 `replace` 改掉 `location.key` 后退化。

页面根据模式一次性请求 `fetchDiaryBatch({ dates, weeks })`。缺文件是“无内容”，不是错误；`weeklyConfigured=false` 表示周记模板未配置，`WeekColumn` 会链接到 `/settings/diary`，不能当成周记空白。batch 请求失败只显示错误条，不替换已有内容区；渲染异常通过 ErrorBoundary key 随 mode/date/retry 重挂。

卡片只读：已有日记进编辑页，缺失日记提供创建入口；未来日期降饱和且不提供创建入口。长内容在卡片内滚动，不撑破回顾布局。

## 3. Markdown 与附件边界

回顾页 Markdown 渲染不执行原始 HTML，不让链接跳转。Obsidian 图片 wikilink 会转换为附件 URL，非图片 wikilink 与嵌入语法降级为文本；附件路径逐段编码并保留 `/` 分隔。

附件图片走 `/api/diary/asset?path=`，只有本站附件 fetch 才带 Authorization。外链图片不带 token；`data:`、`javascript:` 和未知 scheme 禁用。表格和代码块标 `data-edge-swipe-block`，给 iOS 边缘返回让路。

## 4. 模块速查

| 关注点 | 入口 |
|---|---|
| 日期集合与 ISO 周 | `lib/diary/reviewDates.ts` |
| Markdown / wikilink 预处理 | `lib/diary/reviewMarkdown.ts` |
| localStorage 偏好 | `lib/diary/reviewPrefs.ts` |
| 页面状态机 | `pages/diary/review/DiaryReviewPage.tsx` |
| 只读 Markdown | `pages/diary/review/DiaryMarkdown.tsx` |
| 日卡 / 周列 | `pages/diary/review/{ReviewCard,WeekColumn}.tsx` |
