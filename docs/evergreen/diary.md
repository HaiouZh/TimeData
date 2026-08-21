---
type: evergreen
title: 日记
covers:
  - packages/client/src/pages/DiaryPage.tsx
  - packages/client/src/pages/settings/SettingsDiaryPage.tsx
  - packages/client/src/components/DateNav.tsx
  - packages/client/src/lib/diary/diaryApi.ts
  - packages/client/src/lib/diary/diaryDate.ts
  - packages/client/src/lib/diary/guideItems.ts
  - packages/server/src/routes/diary.ts
  - packages/server/src/lib/diary-path.ts
contracts:
  - packages/server/src/routes/diary.ts
  - packages/server/src/lib/diary-path.ts
last-reviewed: 2026-08-21
---

# 日记

> 日记域：正文日记每天一条纯文本文件，另有可选的周记（每周一条，回顾页用）；都直接写在用户挂载的本地 vault 目录里（Obsidian 风格），不进 SQLite/Dexie、不进同步账本、不进备份格式。
> 讲什么：路径模板展开与安全校验、mtime 并发守卫、关键契约与不变量、日期与跨零点、设置页模板配置。
> 不讲什么：编辑器三键位语义与撤销栈约束（见子文档 [diary/editor](diary/editor.md)）、宽屏只读参考栏（见子文档 [diary/reference-panel](diary/reference-panel.md)）、日记回顾页（见子文档 [diary/review](diary/review.md)）；QuickNote/待办/时间记录等结构化域的存储与同步（见 [quick-notes](quick-notes.md)/[todo](todo.md)/[timeline](timeline.md)）、通用同步账本（见 [sync](sync.md)）。

## 承上启下

- **上游**：用户在 `/diary`（`DiaryPage.tsx`）编辑当天日记；在 `/settings/diary`（`SettingsDiaryPage.tsx`）配置路径模板。
- **下游**：内容直接写入服务器本机文件系统（`DIARY_VAULT_DIR` 挂载的目录），不落库、不同步、不进独立备份。
- **契约**：`routes/diary.ts` 的六个端点与 `lib/diary-path.ts` 的模板展开/安全校验规则，见本文 §2。编辑页用 `GET/PUT /config` 与 `GET/PUT /:date`；回顾页另用 `POST /batch` 批量取多天、`GET /asset` 取 vault 内资源，见 [diary/review](diary/review.md)。
- **邻居**：[diary/editor](diary/editor.md)、[diary/reference-panel](diary/reference-panel.md) 与 [diary/review](diary/review.md)（同主题子文档）；[quick-notes](quick-notes.md)（QuickNotesPage 提供跳转 `/diary` 的入口，二者是并列的记录方式，互不引用数据）。

## 1. 数据流

```text
DiaryPage 载入
  → GET /api/diary/config（enabled + template）
  → GET /api/diary/:date（content + mtime）
DiaryPage 保存
  → PUT /api/diary/:date { content, baseMtime, force? }
  → server: 当前 mtime !== baseMtime 且非 force → 409 { error:"diary-conflict", mtime }
  → server: vault 无写权限/只读 → 503 { error:"diary-vault-not-writable", message }
  → 前端捕获 409 为 DiaryConflictError，展示「刷新重载」/「仍然覆盖」二选
  → 前端捕获 vault 权限错误，提示检查 DIARY_VAULT_HOST_DIR 挂载目录所有权

SettingsDiaryPage 保存模板 / 存档引导
  → PUT /api/diary/config { template? , weeklyTemplate? , guideItems? }（三个字段至少给一个，否则 400）
  → server 用固定日期 2026-01-01 / 固定周号 2026-W01 校验对应模板语法，非法 → 400 { error: 中文原因 }
  → guideItems 无语法校验（自由多行文本），仅 >10000 字符拒 400（按 trim 后长度判）
```

`enabled` 由服务端 `DIARY_VAULT_DIR` 环境变量是否配置决定（非 server_config 存储项）；`template`、周记模板 `weeklyTemplate` 与存档引导 `guideItems` 都存在 `server_config` 表（key 分别是 `diary.pathTemplate.v1`、`diary.weeklyPathTemplate.v1` 与 `diary.guideItems.v1`，走 `lib/serverConfig.ts` 的 `getServerConfig`/`setServerConfig` 通用 KV，同表其他配置项 key 独立）。`PUT /config` 按传入字段分别写入，三者互不牵连。**但对空串不对称**：`template: ""` 照走语法校验、被「模板不能为空」拦成 400；`weeklyTemplate: ""` 与 `guideItems: ""` 显式跳过校验直接落库，等于**清除对应配置**（兑现设置页「留空 = 不显示」）。`guideItems` 是多行文本一行一条，server 落库前整串 `trim()`（首尾空白不入库、内部换行保留），长度上限 10000 也按 trim 后的落库值判；**拆行唯一口径在客户端** `lib/diary/guideItems.ts:parseGuideItems`（split `/\r?\n/` + trim + 滤空行），宽屏面板与窄屏容器都从它拿条目、不许各拆各的；client 读取处对缺字段兜 `?? ""`（旧服务器升级窗口的响应没有这个字段）。

<a id="diary-s2"></a>

## 2. 关键契约 / 不变量

1. **路径模板占位符分两套且互不通用**：日模板（`expandDiaryTemplate`，日期形态 `YYYY-MM-DD`）只认 `{yyyy}` `{MM}` `{dd}`，周记模板（`expandWeeklyTemplate`，周号形态 `YYYY-Www`）只认 `{gggg}` `{ww}`；两边都对其余占位符（含未知花括号）在展开时报错「未知占位符」。
2. **模板安全校验两套共用**（`validateTemplateShape`，两个 expand 各自先调它）：不能为空、不能含反斜杠、不能是绝对路径（`/` 开头或 `X:` 盘符开头）、不能含 `..` 段；展开后的绝对路径必须仍在 `vaultDir` 内（`resolveDiaryFile` / `resolveWeeklyFile` 都走 `resolveInsideVault` 二次校验，防止模板拼接后越权）。
3. **mtime 并发守卫**：`PUT /:date` 非 `force` 请求时，服务器当前文件 mtime 必须等于客户端携带的 `baseMtime`（文件不存在时 `baseMtime` 应为 `null`），否则 409 冲突并回传服务器当前 mtime；`force:true` 无条件覆盖。mtime 精度为 `Math.floor(mtimeMs)`（毫秒截断）。
4. **`enabled=false`（vault 未挂载）时**页面仍可加载/展示，但视为不可用状态提示用户，不阻断路由本身；`template=""`（未配置模板）在 `DiaryPage` 单独提示并链接到 `/settings/diary`。
5. **有序列表回车重排**（`orderedList.ts:applyEnterInOrderedList`）不是逐行 +1，是把光标所在项到块尾整段拉直编号（`listModel.ts:renumberBlock`）；IME 组合态回车（`event.nativeEvent.isComposing`）不触发；光标前是空列表项且行内光标后无余文时不续号，**有缩进先退一层、退到顶层再按一次才清行**（逐级出层）。附属行/围栏豁免/单项块护栏/光标落点公式等完整语义见 [diary/editor](diary/editor.md#diary-editor-s2)。
6. **离开/重载确认走 `useConfirm`**（自绘 `ConfirmSheet`），不用裸 `window.confirm`（表单控件棘轮闸 `check:ui` 强制）。
7. **未保存修改的离开守卫**统一走 `hooks/useUnsavedChangesGuard`（`useBlocker` + `beforeunload`），覆盖桌面侧栏 / 底栏 / `<Link>` / `navigate()` / 浏览器后退 / 安卓返回键；页面**不再**自管 `beforeunload`，返回按钮也不自己弹确认（否则会连弹两次）。页内「刷新重载」的确认不归它管，仍走 `useConfirm`。**已知缺口**：`appUpdate.tsx` 检测到新构建时会在 `visibilitychange`/`focus` 上程序化调用 `window.location.reload()`（无用户激活的硬刷新），浏览器对此类 reload 普遍抑制 `beforeunload` 提示，且 Android WebView 本就不显示 `beforeunload` 对话框；这条路径既不过 `useBlocker`（不是路由内导航）也不过 `beforeunload`（被抑制/不支持），日记正文又不进任何本地存储或同步域，因此是离开守卫覆盖不到的出口。
8. <a id="diary-save-revision"></a>**保存在途中的编辑不丢**：`handleSave` 发起时记下编辑序号（`editRevisionRef`，每次 `markDirty` +1），请求回来只在序号未变（= 这一发上传的就是当前内容）时清脏；用户在请求在途中继续打字时保持脏态。无条件清脏会连 §2.7 的离开守卫一起关掉，换页即静默丢那段从未上传的内容。判据用序号不用内容比对，原因见 [diary/editor](diary/editor.md#diary-editor-s8) 行尾保护。
9. **`handleReload` 失败只出条状错误提示**（`setError`），不进 `loadFailed` 全屏态、不清冲突条：正文还在编辑器里、用户还能接着编辑保存，全屏失败态反而会把这份没上传的内容从屏幕上抹掉。
10. **vault 写权限**：生产镜像 entrypoint 在降权到 UID/GID 1000 前，只创建并递归校正固定挂载根 `/app/vault` 的所有权；`DIARY_VAULT_DIR` 子目录由应用按需创建，误配到挂载根外或含 `.` / `..` 路径段时只告警。文件系统拒绝改权时启动继续但输出 warning，日记写接口把 `EACCES` / `EPERM` / `EROFS` 收敛为 503 `diary-vault-not-writable`，不再暴露通用 500。
11. **日期口径**：日记的「今天」恒用 `getDateString`（`lib/time.ts`，固定 `Asia/Shanghai`），**禁止** import 待办域的 `localDateString`（设备本地日界）。服务端对 `:date` 是纯字符串透传、自己从不求「今天」（`diary-path.ts` 只做占位符替换与日历有效性校验），**文件名日期 100% 由客户端口径决定**，选错就是文件名整体错一天且服务端不会纠偏。由 `pnpm check:diary`（`scripts/check-diary-date.mjs`，CI 必跑）静态守：日记域源码出现 `localDateString` 即红——单测锁不住（本机与 CI 时区同为 UTC+8，两套日界恒等）。
12. **当前日期的事实源是 URL `?date=`**（`lib/diary/diaryDate.ts:resolveDiaryDate`）：有合法的过去日期 = 显式模式（用户自选的补写目标，跨零点**永不**提示）；无参 = 跟随模式，展示 `followAnchor` 并在实时今天越过它时出提示条。非法 / 未来 / 恰是今天的参数一律归一成无参形态（`replace`，不新增历史条目）。不用 `following: boolean` state 表达模式——state 活不过 PWA 冷启动。
13. **切日期用 `replace` 不用 `push`**。与时间轴的「保留 push」有意分叉：日记页有 header 返回按钮（`handleBack` 走 `navigate(-1)`）且安卓返回键 `/diary` 分支恒返回 `back`，push 会把「离开日记页」变成「逐日倒带」，翻 5 天要按 6 次才出得去；时间轴没有返回按钮，不暴露这个矛盾。
14. **参考栏只读**：不向正文写一个字节，无「插入」入口。它既是产品选择，也免掉了光标插入/格式化/撤销栈交互的一整片复杂度。只读原则同样覆盖窄屏 chips 容器与存档引导块——引导是「看的」，永不写正文。
15. **参考栏不得污染主编辑区状态**：任何一块的加载中/失败只在自己那块显示，绝不 set 页面的 `loading`/`loadFailed`/`conflict`/`error`/`dirty`。否则参考栏一超时会连累正文写不了。
16. **窄屏（<1024px，含 APK）不渲染常驻参考栏面板**，改由 `DiaryMobileRefBar` chips 参考条按需展开：收起态只占一行、展开区限高内滚、单开语义（同时最多一块）。挂载在内容三元的窄屏分支——全部全局条（跨天/冲突/错误）之后、正文之前。容器语义见 [diary/reference-panel](diary/reference-panel.md#diary-reference-panel-s6)。
17. **空正文预填 `"1. "`**（`DiaryPage.tsx:DIARY_SEED`）：`fetchDiary` 返回的 `content === ""` 时（文件不存在，或存在但是空的）正文预填一条空的有序列表项，之后每次回车由 §2.5 自动接号。判据是**内容**不是 `mtime === null`——手动清空过的旧文件也该照样预填。**预填不置脏**（不调 `markDirty`）：不写字就不落盘，既不会每天路过一眼就在 vault 里攒出一堆只有 `"1. "` 的空壳文件，离开也不会弹「未保存的修改」。这条靠 dirty 的记账口径天然成立（dirty 只由 `onChange` / 降级编辑置位，不是内容比对，见 §2.8）；谁把 dirty 改成内容比对，这里会连带变成「打开就永远脏」。**只在加载路径预填，`handleReload` 不预填**——重载语义是「我要看服务器到底是什么」。
18. **预填后只有宽屏抢焦点**（光标落到 `"1. "` 之后）：窄屏（手机）抢焦点会立刻顶起软键盘，把本就矮的正文区再压掉半屏，而用户这一步多半只是想先扫一眼当天的打点。窄屏仍然预填，只是等用户自己点进去。驱动它的 `seedNonce` 是**计数器不是布尔**：连续切到第二天空日记时 `true→true` 不会触发 effect，第二天的光标就不会归位。

## 3. 日期与跨零点

### 3.1 两种模式

`resolveDiaryDate({ param, liveToday, followAnchor })` 是唯一裁决点，返回 `{ date, following, rolledOver, clearParam }`：

- **显式模式**（URL 有合法且早于今天的 `?date=`）：`date` = 该日期，`rolledOver` **恒 false**。用户翻到 7/20 补写时头上不会一直挂着「切到今天」。
- **跟随模式**（无参 / 参数非法 / 未来 / 恰是今天）：`date` = `followAnchor`，`rolledOver` = 实时今天是否已越过锚点，`clearParam` 提示页面把冗余参数 `replace` 掉。

`followAnchor` 是 **state 不是 ref**：它参与渲染（`date` 与 `rolledOver` 都由它算出来），改了必须重渲染。它只在「（重新）进入跟随模式」时前进（点提示条、或用 DateNav 切回今天），**绝不随实时今天自动前进**——自动前进就是跨零点把用户正在写的正文换到新文件。

> 一个反直觉的实测点：同 URL 的 `setSearchParams({})` **不是** no-op——它照样发起一次真导航并触发重渲染。所以「锚必须是 state」的理由只是上面那条朴素的「它参与渲染」，**不是**「setSearchParams 不触发渲染」。

### 3.2 跨天：只提示不自动切

过零点后正文与存盘日期都停在原处，只出一条提示条。自动切 = 正在写的那段被换到新文件；不点提示条就一直存到昨天那篇，这正是「补写昨天」的语义。提示条文案**必须带具体日期**——`useAppResumeRefresh` 让息屏几天后回前台立刻刷新，一次可能跨好几天。

**红线**：正文加载 effect 的依赖数组里**绝不能出现** `liveToday` / `now`。写进去就是每分钟重新 `fetchDiary` + `setContent`，直接覆盖用户正在编辑的正文，且静默。

### 3.3 切日期必须重置的五态，与真正兜底的那道闸

`loading` / `error` / `conflict` / `loadFailed` / `dirty` **没有任何地方会自动重置**（`loading` 全文只有置 false、`loadFailed` 只有置 true；`dirty` 只在加载**成功**路径才清），必须在日期 effect 开头显式重置：

| 态 | 不重置的后果 |
|---|---|
| `loading` | 旧正文原地留着直到新内容到达，用户对着上一天的内容打字然后被覆盖 |
| `error` | 上一天的错误提示条挂在新一天页面上，误导用户 |
| `conflict` | 上一天的冲突条挂到新一天头上，点「仍然覆盖」force 掉新一天的文件 |
| `loadFailed` | 一次加载失败之后，切到任何日期都永远是全屏「加载失败」 |
| `dirty` | 新一天**加载失败**时脏标记永久停在 true，把共享的 `useUnsavedChangesGuard`（含 `beforeunload` 那条腿）钉死在武装状态，对着一份用户已确认丢弃、屏幕上也不存在的内容反复弹「放弃未保存的修改？」——保护 vault 的最后一道人肉闸被喊成狼来了 |

`fetchDiaryConfig` 拆在独立的 `[]` effect 里：config 与日期无关，不拆则每切一天多一次往返，也多一次「config 失败 → 整页 loadFailed」的机会。

日期 effect 同时把 `baseMtime` 清成 `null`，但这**不是**一道有效防线：`handleSave` 现在 `loading || loadFailed` 两态都早退，已经覆盖了"`content` 还是上一天残留"的全部窗口，`baseMtime` 清不清都轮不到它起作用（删掉这行、跑 DiaryPage 全部测试验证过仍然全绿）。保留只是语义上仍然对、给将来改动留的防御性兜底，**它不需要专属测试**。

真正堵住这个窗口的是 `handleSave` 入口的 `if (loading || loadFailed) return;`。不加这道闸：切日期后新一天的正文还没加载出来（`loading` 期）或加载失败（`loadFailed` 期）时，`content` 里是上一天的残留正文，且 `baseMtime` 已被日期 effect 清成 `null`；此时若能保存，会把上一天的正文写进新一天的文件，且 `baseMtime === null` 会让服务端 mtime 并发守卫（§2 第 3 条）当成"文件不存在"直接放行——不报 409 冲突，静默写坏新一天的文件。**触发路径不需要 textarea 挂载**：这两态下主区域是全屏提示、textarea 未渲染，容易误以为"用户碰不到保存"，但 Ctrl+S 的快捷键监听挂在 `window` 上，不经过 textarea，且保存按钮本身在 `loadFailed` 态下也没有单独置灰——两条路都能触发 `handleSave`。这条早退是四态重置之外**必须另外补的一道闸**，不是四态重置能自然带出来的推论。

### 3.4 脏态确认由页面自己弹

`useUnsavedChangesGuard` 的 `shouldBlock` 只比 `pathname`，`?date=` 变化 pathname 不变 → **它一概拦不到**。所以切日期 / 点提示条时必须页面自己 `await confirm(...)`；不弹就是静默丢数据。反过来说也不会出现双弹层。文案单独写（并没有「离开」页面），不复用守卫默认的「离开后当前修改将丢失」。

<a id="diary-s3-5"></a>

### 3.5 在途响应的三道闸（正交，不可互相替代）

加载 effect 有 `cancelled` 守卫；`handleSave` / `handleReload` 各自需要：

| 闸 | 判据 | 管什么 |
|---|---|---|
| `editRevisionRef` | 内容序号 | 内容变没变（保存在途打字不清脏；重载在途打字不被盖掉） |
| `loadEpochRef` | 单调递增的加载世代号 | 目标文件的**加载生命周期**换没换（A 日的 mtime / 冲突不落到 B 日） |
| `savingRef` / `reloadingRef` | 在途写标志，**双向** | 有没有别的写在飞（save 与 reload 交错会让 mtime 守卫失效） |

**世代号不能退化成日期字符串比较**。曾用 `dateRef.current !== dateAtRequest` 做这道闸，有 ABA：7/25 保存在飞 → 切到 7/24 → 再切回 7/25，字符串又相等、闸认不出这是上一轮加载的响应，旧 save 的 mtime 会落到新一轮加载的正文上；用户再改一个字保存，服务端守卫比对通过、不报冲突，刚保存成功的那版被旧内容静默覆盖。世代号在正文 effect 每次开始时 `+= 1`，任何一次重新加载都换代，严格强于值比较。

**save↔reload 的互锁必须是双向的**。只让 `handleReload` 挡 `saving` 是不够的——`handleReload` 自己也要置 `reloading`，否则 `handleSave` 不知道有重载在路上：冲突条 →「刷新重载」确认（`fetchDiary` 弱网飞着，页面无任何在途迹象）→ 用户以为没点上、改点「仍然覆盖」（该按钮当时只看 `saving`，可点）→ force 把本地内容写进 vault → reload 先回来把正文换成服务器版本、`baseMtime` 换成旧值 → force save 后回来把 `baseMtime` 改成落盘后的新值 → **编辑器显示服务器版本，而 `baseMtime` 恰好等于盘上真实 mtime** → 用户随手改一个字保存，服务端不报冲突，他刚刚明确选择保住的那份内容被静默销毁。三个写入口（保存 / 刷新重载 / 仍然覆盖）在任一方在飞时都要置灰。

`savingRef` / `reloadingRef` 的 `finally` 解锁**不加世代号或日期判据**——它们是页面级的「有没有在途写」，加了会让切日后按钮永久置灰。

**所有 `await` 之后读的判据一律走活 ref，不许读闭包里的 state**。React 函数组件里，一次调用开始后闭包中的 state 就冻结了：`await` 期间外部 `setSaving(true)` 读不到，与函数入口那道判据永远同值——写成 `if (saving)` 就是一道结构上**永不生效**的假闸。这个坑真实发生过两次（`handleReload` confirm 之后那道、`handleSave` 入口那道），且三轮逐任务审查都没看出来，只有专门问「这行代码真的在做事吗」的视角才抓到。

重载在途中用户又打字时**取消这一发重载并提示**，不盖服务器版本——那与「保存在途打字被清脏」是同类的静默丢数据。

### 3.6 不用改的东西

- `lib/backNavigation.ts` 的 `/diary` 分支恒返回 `{type:"back", fallbackTo:"/quick-notes"}`，不用改。它不需要像 `/` 分支那样显式判 `has("date")`——`/` 无 date 时的动作是 `exit`（退出 app），必须先把日期历史退完；而 `/diary` 的动作恒为 `back`，且切日期一律走 `replace`（§2.13），压根不产生日期历史。

**但 `location.key === "default"` 这个哨兵会被 `replace` 打破**：`handleBack` 拿它判断「书签 / PWA 快捷方式 / 硬刷新直接落地，没有 app 内历史」，而本页的 `setSearchParams(..., { replace: true })`（切日期两处 + `?date=` 归一一处）会把 `location.key` 从 `"default"` 换成随机 key。所以必须在**挂载那一刻**把这个判断定下来存进 ref，不能每次渲染现读——否则直接落地后切一次日期，返回按钮就从「兜底回速记页」退化成 `navigate(-1)` 空转。

> **已知缺口**：安卓返回键的执行层 `AndroidBackButtonHandler.tsx` 是 app 全局挂载的，在按键那一刻**现读** `location.key`，踩的是同一个坑。窄场景（直接落地 `/diary` + 切过日期 + 按安卓返回键）下它会 `navigate(-1)` 空转；页内返回按钮仍可用，所以不是死路。修它要动全局导航层，留待单独处理。
- `components/DateNav.tsx` **一个字节不动**：它有 3 条 `check:design` 精确豁免，匹配是「rule + 文件 + trim 后整行文本」三元组，改一个字符就失配。要调间距在外面包容器。它自己每次渲染现算 `today`，跨零点会自动跟上，无需传 prop。

## 4. 模块速查

| 入口 | 职责 |
|---|---|
| `pages/DiaryPage.tsx` | 编辑页：加载当天内容、`handleKeyDown` 分派三键位、脏态提示离开、mtime 冲突 UI（见 [diary/editor](diary/editor.md)）、日期驱动与跨零点提示（§3） |
| `pages/settings/SettingsDiaryPage.tsx` | 设置页：显示 enabled 状态、编辑并保存路径模板、400 错误展示服务器中文 message |
| `lib/diary/diaryDate.ts` | `resolveDiaryDate`：显式/跟随两种日期模式的唯一裁决点（§3.1） |
| `lib/diary/diaryApi.ts` | 客户端 API 封装：`fetchDiaryConfig`/`saveDiaryTemplate`/`saveDiaryWeeklyTemplate`/`fetchDiary`/`saveDiary`/`fetchDiaryBatch`，`DiaryConflictError` |
| `lib/diary/textareaEdit.ts` | 程序化编辑唯一出口：`applyEdit` 走 `execCommand` 保住原生撤销栈，`runEditAction` 统一落地 `EditAction`（[diary/editor](diary/editor.md) §1、§5、§6、§7） |
| `lib/diary/orderedList.ts` | 有序列表回车整段重排纯函数（[diary/editor](diary/editor.md#diary-editor-s2)） |
| `lib/diary/listModel.ts` | 共享行模型与有序列表重排原语（供回车重排与 Tab 缩进复用，见 [diary/editor §2](diary/editor.md#diary-editor-s2) 与 [§3](diary/editor.md#diary-editor-s3)） |
| `lib/diary/indent.ts` | Tab/Shift+Tab 缩进出层纯函数，带父行约束与顶层逃生口（[diary/editor](diary/editor.md#diary-editor-s3)） |
| `lib/diary/link.ts` | Ctrl+K 补 markdown 链接纯函数，四态返回（null/noop/select/replace）+ 围栏豁免，七 case（[diary/editor](diary/editor.md#diary-editor-s4)） |
| `lib/diary/eol.ts` | 行尾保护：探测原文件主导行尾（CRLF/LF），`DiaryPage` 保存时据此还原，避免打开 CRLF 文件后静默改写成 LF（[diary/editor](diary/editor.md#diary-editor-s8)） |
| `lib/diary/diaryRefPrefs.ts` | 参考栏折叠偏好：「今天」三块 + 引导块的展开/折叠状态存取（[diary/reference-panel](diary/reference-panel.md#diary-reference-panel-s2)） |
| `lib/diary/guideItems.ts` | `parseGuideItems`：存档引导拆行唯一口径（一行一条、trim 滤空）。纯函数，模块图里不得出现 db |
| `pages/diary/DiaryMobileRefBar.tsx` | 窄屏参考条：横排 chips 单开展开，五块+引导复用，`MobileLookback` 挂载即拉（[diary/reference-panel §6](diary/reference-panel.md#diary-reference-panel-s6)） |
| `lib/diary/diaryRefEntries.ts` | 日界裁剪 `clipEntriesToDay` + 窗口原语 `diaryRefDayWindow`。**纯函数，模块图里不得出现 db**——它的测试跑 node 干净桶（零 DOM、零 db），import 一次 db 就整桶报废（[diary/reference-panel §4](diary/reference-panel.md#diary-reference-panel-s4)） |
| `lib/diary/diaryRefEntriesQuery.ts` | 上一行拆出来的那半：打点当天窗口查询 `listEntriesOverlappingDay`，碰 db，共用 `diaryRefDayWindow`（[diary/reference-panel §2](diary/reference-panel.md#diary-reference-panel-s2)） |
| `lib/diary/diaryRefTasks.ts` | 完成待办过滤：`selectTasksCompletedOn` 三条硬性口径（[diary/reference-panel](diary/reference-panel.md#diary-reference-panel-s2)） |
| `pages/diary/DiaryReferencePanel.tsx` + `pages/diary/DiaryRef*.tsx` | 参考栏五个组件：`DiaryReferencePanel`（挂载、两个分区、每块各一层 `ErrorBoundary`）、`DiaryRefPunches`、`DiaryRefDoneTasks`、`DiaryRefQuickNotes`、`DiaryRefLookback`（[diary/reference-panel](diary/reference-panel.md)） |
| 编辑器三键位 / EditAction 四态 / onChange 红线 / dirty 记账 / 行尾保护 | → [diary/editor](diary/editor.md) |
| 参考栏布局挂载 / 四块数据口径 / 错误围栏 / 回看两道闸 | → [diary/reference-panel](diary/reference-panel.md) |
| 回顾页模式 / 周记列 / markdown 附件渲染（`pages/diary/review/**`、`lib/diary/review*.ts`） | → [diary/review](diary/review.md) |
| `server/routes/diary.ts` | 六端点：编辑页用 `GET/PUT /config`、`GET/PUT /:date`；回顾页另用 `POST /batch`、`GET /asset`。**`GET /asset` 必须注册在 `GET /:date` 之前**，否则被 `:date` 参数路由吞掉（`POST /batch` 与只注册了 GET/PUT 的 `/:date` 天然不冲突，顺序对它无风险） |
| `server/lib/diary-path.ts` | 日模板与周记模板的展开 + 路径安全校验纯函数（`expandDiaryTemplate` / `expandWeeklyTemplate` / `resolve*File`） |

**client**：`pages/DiaryPage.test.tsx`、`pages/DiaryPage.successPath.test.tsx`、`pages/DiaryPage.wide.test.tsx`、`pages/settings/SettingsDiaryPage.test.tsx`、`lib/diary/{diaryApi,diaryDate,guideItems,orderedList,listModel,indent,link,eol,diaryRefPrefs,diaryRefEntries,diaryRefTasks,reviewDates,reviewMarkdown,reviewPrefs}.test.ts`、`lib/diary/textareaEdit.test.tsx`、`pages/diary/DiaryReferencePanel.test.tsx`、`pages/diary/DiaryMobileRefBar.test.tsx`、`pages/diary/review/{DiaryReviewPage,DiaryReviewPage.narrow,DiaryMarkdown}.test.tsx`（分栏底座本身的用例在 `pages/todo/ResizableSplit.test.tsx`）
**server**：`routes/diary.test.ts`、`lib/diary-path.test.ts`
