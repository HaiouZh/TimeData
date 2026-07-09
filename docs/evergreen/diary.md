---
type: evergreen
title: 日记
covers:
  - packages/client/src/pages/DiaryPage.tsx
  - packages/client/src/pages/settings/SettingsDiaryPage.tsx
  - packages/client/src/lib/diary/**
  - packages/server/src/routes/diary.ts
  - packages/server/src/lib/diary-path.ts
contracts:
  - packages/server/src/routes/diary.ts
  - packages/server/src/lib/diary-path.ts
last-reviewed: 2026-07-09
---

# 日记

> 日记域：每天一条纯文本文件，直接写在用户挂载的本地 vault 目录里（Obsidian 风格），不进 SQLite/Dexie、不进同步账本、不进备份格式。
> 讲什么：路径模板展开与安全校验、mtime 并发守卫、有序列表续号、设置页模板配置。
> 不讲什么：QuickNote/待办/时间记录等结构化域的存储与同步（见 [quick-notes](quick-notes.md)/[todo](todo.md)/[timeline](timeline.md)）、通用同步账本（见 [sync](sync.md)）。

## 承上启下

- **上游**：用户在 `/diary`（`DiaryPage.tsx`）编辑当天日记；在 `/settings/diary`（`SettingsDiaryPage.tsx`）配置路径模板。
- **下游**：内容直接写入服务器本机文件系统（`DIARY_VAULT_DIR` 挂载的目录），不落库、不同步、不进独立备份。
- **契约**：`routes/diary.ts` 的四个端点（`GET/PUT /config`、`GET/PUT /:date`）与 `lib/diary-path.ts` 的模板展开/安全校验规则，见本文 §2。
- **邻居**：[quick-notes](quick-notes.md)（QuickNotesPage 提供跳转 `/diary` 的入口，二者是并列的记录方式，互不引用数据）。

## 1. 数据流

```text
DiaryPage 载入
  → GET /api/diary/config（enabled + template）
  → GET /api/diary/:date（content + mtime）
DiaryPage 保存
  → PUT /api/diary/:date { content, baseMtime, force? }
  → server: 当前 mtime !== baseMtime 且非 force → 409 { error:"diary-conflict", mtime }
  → 前端捕获 409 为 DiaryConflictError，展示「刷新重载」/「仍然覆盖」二选

SettingsDiaryPage 保存模板
  → PUT /api/diary/config { template }
  → server 用固定日期 2026-01-01 校验模板语法，非法 → 400 { error: 中文原因 }
```

`enabled` 由服务端 `DIARY_VAULT_DIR` 环境变量是否配置决定（非 server_config 存储项）；`template` 存在 `server_config` 表（key = `diary.pathTemplate.v1`，走 `garminConfig.ts` 的 `getServerConfig`/`setServerConfig` 通用 KV，与 Garmin 配置共用同一张表但 key 独立）。

## 2. 关键契约 / 不变量

1. **路径模板占位符**只认 `{yyyy}` `{MM}` `{dd}`，其余占位符（含未知花括号）在展开时报错「未知占位符」。
2. **模板安全校验**（`expandDiaryTemplate`）：不能含反斜杠、不能是绝对路径（`/` 开头或 `X:` 盘符开头）、不能含 `..` 段；展开后的绝对路径必须仍在 `vaultDir` 内（`resolveDiaryFile` 二次校验，防止模板拼接后越权）。
3. **mtime 并发守卫**：`PUT /:date` 非 `force` 请求时，服务器当前文件 mtime 必须等于客户端携带的 `baseMtime`（文件不存在时 `baseMtime` 应为 `null`），否则 409 冲突并回传服务器当前 mtime；`force:true` 无条件覆盖。mtime 精度为 `Math.floor(mtimeMs)`（毫秒截断）。
4. **`enabled=false`（vault 未挂载）时**页面仍可加载/展示，但视为不可用状态提示用户，不阻断路由本身；`template=""`（未配置模板）在 `DiaryPage` 单独提示并链接到 `/settings/diary`。
5. **有序列表续号**（`orderedList.ts:applyEnterInOrderedList`）只依据光标前后文本判定 `^\d+\. ` 前缀，IME 组合态回车（`event.nativeEvent.isComposing`）不触发续号；光标前是空列表项且行内光标后无余文时，回车清空该行序号而非续号。
6. **离开/重载确认走 `useConfirm`**（自绘 `ConfirmSheet`），不用裸 `window.confirm`（Phase 1 表单控件棘轮闸 `check:ui` 强制）。

## 3. 模块速查

| 入口 | 职责 |
|---|---|
| `pages/DiaryPage.tsx` | 编辑页：加载当天内容、有序列表续号、脏态提示离开、mtime 冲突 UI |
| `pages/settings/SettingsDiaryPage.tsx` | 设置页：显示 enabled 状态、编辑并保存路径模板、400 错误展示服务器中文 message |
| `lib/diary/diaryApi.ts` | 客户端 API 封装：`fetchDiaryConfig`/`saveDiaryTemplate`/`fetchDiary`/`saveDiary`，`DiaryConflictError` |
| `lib/diary/orderedList.ts` | 有序列表回车续号纯函数 |
| `server/routes/diary.ts` | 四端点：`GET/PUT /config`、`GET/PUT /:date` |
| `server/lib/diary-path.ts` | 模板展开 + 路径安全校验纯函数 |

**client**：`pages/DiaryPage.test.tsx`、`pages/settings/SettingsDiaryPage.test.tsx`、`lib/diary/{diaryApi,orderedList}.test.ts`
**server**：`routes/diary.test.ts`、`lib/diary-path.test.ts`
