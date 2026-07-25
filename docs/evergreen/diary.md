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
last-reviewed: 2026-07-26
---

<!-- 复核 2026-07-25（diary-workbench 阶段二 · 编辑器语义收口）：补三键位（回车整段重排/Tab缩进出层/Ctrl+K补链接）契约、EditAction 四态、onChange 红线、撤销栈已知缺口、dirty 记账四条路径、行尾保护 §3.8；不新增 covers（lib/diary/** 通配已覆盖全部新文件）。 -->
<!-- 复核 2026-07-25（存量两问题）：补 §2.8 保存在途脏标记（编辑序号判据）、§2.9 重载失败只出条状提示；§3.7 补 markDirty 与清脏出口。 -->
<!-- 复核 2026-07-26（diary-workbench 阶段三 · 日期与跨零点收口）：§2 追加日期口径/事实源/replace 三条契约（第 11–13 条）；新开 §4「日期与跨零点」（两种模式、跨天只提示不自动切、切日重置四态与 handleSave 的早退真防线、脏态确认为何页面自己弹、在途响应三道正交闸、不用改的东西），原 §4「模块速查」顺延为 §5；订正 §3.7 表格首行与概括句里裸 `setDirty(true)` 与 `markDirty()` 的自相矛盾。不新增 covers：新文件 `lib/diary/diaryDate.ts` 落在既有 `packages/client/src/lib/diary/**` 通配下。 -->

# 日记

> 日记域：每天一条纯文本文件，直接写在用户挂载的本地 vault 目录里（Obsidian 风格），不进 SQLite/Dexie、不进同步账本、不进备份格式。
> 讲什么：路径模板展开与安全校验、mtime 并发守卫、编辑器三键位语义（回车/Tab/Ctrl+K）与撤销栈约束、行尾保护、设置页模板配置。
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
  → server: vault 无写权限/只读 → 503 { error:"diary-vault-not-writable", message }
  → 前端捕获 409 为 DiaryConflictError，展示「刷新重载」/「仍然覆盖」二选
  → 前端捕获 vault 权限错误，提示检查 DIARY_VAULT_HOST_DIR 挂载目录所有权

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
5. **有序列表回车重排**（`orderedList.ts:applyEnterInOrderedList`）不是逐行 +1，是把光标所在项到块尾整段拉直编号（`listModel.ts:renumberBlock`）；IME 组合态回车（`event.nativeEvent.isComposing`）不触发；光标前是空列表项且行内光标后无余文时，回车清空该行前缀而非续号。附属行/围栏豁免/单项块护栏/光标落点公式等完整语义见 §3.2。
6. **离开/重载确认走 `useConfirm`**（自绘 `ConfirmSheet`），不用裸 `window.confirm`（Phase 1 表单控件棘轮闸 `check:ui` 强制）。
7. **未保存修改的离开守卫**统一走 `hooks/useUnsavedChangesGuard`（`useBlocker` + `beforeunload`），覆盖桌面侧栏 / 底栏 / `<Link>` / `navigate()` / 浏览器后退 / 安卓返回键；页面**不再**自管 `beforeunload`，返回按钮也不自己弹确认（否则会连弹两次）。页内「刷新重载」的确认不归它管，仍走 `useConfirm`。**已知缺口**：`appUpdate.tsx` 检测到新构建时会在 `visibilitychange`/`focus` 上程序化调用 `window.location.reload()`（无用户激活的硬刷新），浏览器对此类 reload 普遍抑制 `beforeunload` 提示，且 Android WebView 本就不显示 `beforeunload` 对话框；这条路径既不过 `useBlocker`（不是路由内导航）也不过 `beforeunload`（被抑制/不支持），日记正文又不进任何本地存储或同步域，因此是离开守卫覆盖不到的出口。
8. **保存在途中的编辑不丢**：`handleSave` 发起时记下编辑序号（`editRevisionRef`，每次 `markDirty` +1），请求回来只在序号未变（= 这一发上传的就是当前内容）时清脏；用户在请求在途中继续打字时保持脏态。无条件清脏会连 §2.7 的离开守卫一起关掉，换页即静默丢那段从未上传的内容。判据用序号不用内容比对，原因见 §3.8 行尾保护。
9. **`handleReload` 失败只出条状错误提示**（`setError`），不进 `loadFailed` 全屏态、不清冲突条：正文还在编辑器里、用户还能接着编辑保存，全屏失败态反而会把这份没上传的内容从屏幕上抹掉。
10. **vault 写权限**：生产镜像 entrypoint 在降权到 UID/GID 1000 前，只创建并递归校正固定挂载根 `/app/vault` 的所有权；`DIARY_VAULT_DIR` 子目录由应用按需创建，误配到挂载根外或含 `.` / `..` 路径段时只告警。文件系统拒绝改权时启动继续但输出 warning，日记写接口把 `EACCES` / `EPERM` / `EROFS` 收敛为 503 `diary-vault-not-writable`，不再暴露通用 500。
11. **日期口径**：日记的「今天」恒用 `getDateString`（`lib/time.ts`，固定 `Asia/Shanghai`），**禁止** import 待办域的 `localDateString`（设备本地日界）。服务端对 `:date` 是纯字符串透传、自己从不求「今天」（`diary-path.ts` 只做占位符替换与日历有效性校验），**文件名日期 100% 由客户端口径决定**，选错就是文件名整体错一天且服务端不会纠偏。
12. **当前日期的事实源是 URL `?date=`**（`lib/diary/diaryDate.ts:resolveDiaryDate`）：有合法的过去日期 = 显式模式（用户自选的补写目标，跨零点**永不**提示）；无参 = 跟随模式，展示 `followAnchor` 并在实时今天越过它时出提示条。非法 / 未来 / 恰是今天的参数一律归一成无参形态（`replace`，不新增历史条目）。不用 `following: boolean` state 表达模式——state 活不过 PWA 冷启动。
13. **切日期用 `replace` 不用 `push`**。有意偏离时间轴 TL-15 已拍板的「保留 push」：日记页有 header 返回按钮（`handleBack` 走 `navigate(-1)`）且安卓返回键 `/diary` 分支恒返回 `back`，push 会把「离开日记页」变成「逐日倒带」，翻 5 天要按 6 次才出得去；时间轴没有返回按钮，不暴露这个矛盾。

## 3. 编辑器语义（回车 / Tab / Ctrl+K）

> 三个键位在 `DiaryPage.tsx` 的 `handleKeyDown` 里统一分派：先过 IME 组合态守卫（`event.nativeEvent.isComposing` 提前 return，三键位共用同一处判断，不在各自纯函数里重复判断），再按 `event.key` 依次尝试 `applyEnterInOrderedList` / `applyIndent` / `applyLinkShortcut`，命中的纯函数返回一个 `EditAction`，交给 `runEditAction`（`textareaEdit.ts`）统一落地。三个纯函数与 `listModel.ts` 共享同一份行模型（行定位 `splitLines`/`lineIndexAt`、保护位扫描 `scanProtected`、分块 `assignBlocks`、重排 `renumberBlock`）——这是本阶段唯一准用的一份实现，两处各写一套曾被判定为最大架构风险。

### 3.1 EditAction 四态契约

| 返回值 | 语义 | `handleKeyDown` 动作 | 是否置 dirty |
|---|---|---|---|
| `null` | 不处理这个按键 | **不** `preventDefault`，交还浏览器默认行为 | 不涉及 |
| `{ kind: "noop" }` | 吃掉按键但不改任何东西 | `preventDefault`，不碰 `setValue`/`markDirty` | 否 |
| `{ kind: "select" }` | 只挪光标 | `preventDefault`，只调 `field.setSelectionRange`，**不**走 `execCommand` | 否 |
| `{ kind: "replace" }` | 替换 `[start,end)` 为 `text`，落点 `[selStart,selEnd)` | `preventDefault`，走 `applyEdit`（execCommand） | 见 §3.7 |

`null` 与 `{ kind: "noop" }` 都不碰 `setValue`/`markDirty`，差别只在按键要不要交还浏览器继续处理（唯有 `null` 不 `preventDefault`）；这条区分是 `handleKeyDown` 一层的判断，`runEditAction` 内部只处理非 `null` 的三态。

### 3.2 回车：有序列表整段重排

光标不在列表项 marker 之后（缩进/编号/gap 内部，或所在行根本不是列表项）→ `null` 放行原生换行；光标落在代码围栏 / front-matter 保护区内（`scanProtected`）同样 `null` 放行——这两类都是"看起来像列表操作但不该拦"。

命中列表项后：
- **附属行**（`assignBlocks`）：视觉列宽大于块内最近一项列宽的非列表行（续写段落、无序子项）随块移动、不参与编号计数、字节原样保留；不加这条，`"1. a\n   续写\n2. b"` 会在无序子项处断块，`"2. b"` 被孤立分块后拉直成 `"1. b"`。
- **单项块护栏**：块内只有 1 个列表项时不做整段拉直，退化为"当前号 + 1"；块内 ≥2 项才整段拉直（`straighten = block.items >= 2`）。不加这条，loose list（`"1. a\n\n2. b"`）里的 `"2. b"` 会被孤立分块后错误拉直成 `"1. b"`。
- **空列表项回车**：光标前无内容、行内光标后也无余文 → 清空该行（含缩进）而非续号。
- **光标落点**：不能用"旧光标 + 增量"算——编号位数变化（如 9→10）可能发生在光标上方；必须用 `blockStart + 新块内新行之前所有行长度和 + 新行重排后的 markerLen`。
- **最小编辑区间**：`trimEditSpan` 做前后缀字节级裁剪，编号本来就对时自然塌成插入点，上下文一个字节不动。

### 3.3 Tab / Shift+Tab：缩进出层

判定"这一行算不算列表行"看整行本身，与光标在行内哪一列无关（缩进区/marker 中间/行尾/空列表项都算）——这与回车不同，回车看的是"光标是否在 marker 之后"。

- **父行约束**（Tab 入层，`canIndentRows`）：目标行在同块内必须存在上方最近的列表项（块首行不可缩进）；且目标行原深度必须 ≤ 上方最近列表项的新深度，否则拒绝（防跳级）。附属行既不断链也不推进"最近列表项"深度。
- **出层不受父行约束**：Shift+Tab 只要该行还有缩进可拿即放行——`indent` 以 `\t` 开头拿掉 1 个 Tab 字符，否则视为空格缩进的老文件，最多拿掉 `TAB_COLUMNS`（4）个前导空格。
- **逃生口**：`targets` 为空即返回 `null`，把焦点交还浏览器——Tab/Shift+Tab 各自都有确定的出口，满足 WCAG 2.1.2 键盘陷阱要求存在出口。Tab 的前向出口：非列表行/围栏内（候选行过滤阶段就放行）、以及**块首行**（父行约束 `canIndentRows` 拒绝——块首行即任意列表的第一项，日记里最常见的位置）。Shift+Tab 的反向出口：**顶层列表行**（`removableIndentLen` 判定无缩进可拿）。**不要**因为"对称性"让 Shift+Tab 也在顶层被吃掉，那会把两个方向同时封死，构成键盘陷阱。
- **缩进不带子树**（已知行为，非 bug）：只动目标行的 `indent`，子项原样留在原深度；带子树要引入"子树"概念与额外用户预期，多行选中一起缩已经用行级操作覆盖了这个需求。
- **缩进字符固定 `\t`**（`INDENT` 常量），不做设置项；且是**前置** Tab（`INDENT + indent`）不是后置——保证 `visualCol("\t" + s) === visualCol(s) + TAB_COLUMNS` 恒成立，这个等式只在前置时成立，后置只在原列宽恰好是 4 的倍数时碰巧对，否则会漂移，还会让 Shift+Tab 的 `removableIndentLen` 认不出刚加的 Tab，Tab→Shift+Tab 就不再互逆。
- **替换区间是行级收窄**（改动首行到末行整行替换），不是回车用的字节级前后缀裁剪——Tab 是"这一整行往里/往外挪"的行级操作，回车是"在光标处拆一行"的插入点操作，两者口径不同是有意的。

### 3.4 Ctrl+K：补 markdown 链接

四态返回（含义同 §3.1；`null` 当前实现不会产出，签名保留只为兼容调用方 `if (!action)` 的判空写法），内部七 case（case① 是调用方的 IME 组合态守卫，不在函数内）：

1. **case②** 光标或选区任一端落在代码围栏 / front-matter 内 → `{ kind: "noop" }`——围栏内同样做不成链接，与"选区含换行"同一类，不像 Tab 顶层逃生口那样交还浏览器。
2. **case③** 选区 trim 后仍含换行 → `{ kind: "noop" }`；必须早于 case⑥ 的 URL 判定——WHATWG URL 解析器会先剥掉字符串里的 tab/LF/CR 再解析，跨行选区若先过 URL 判定会被误判成合法 URL，生成把两行硬粘起来的错链接，而且看起来"成功了"。
3. **case④** 光标/选区落在已有 `[文本](URL)` 上 → `{ kind: "select" }`，只挪光标到 URL 段，不改文本、不置 dirty。
4. **case⑤** 无选区 / 全空白选区 → 插入 `"[]()"`，光标落在方括号之间。
5. **case⑥** 选区 trim 后是 `http`/`https` URL → 把 URL 塞进圆括号，光标落进方括号等待填标题。
6. **case⑦** 其余情况 → 把选中文字包进方括号，光标落进圆括号等待填地址。

**mac 上 Ctrl+K 会被一并吃掉**（Emacs 风格 kill-to-end-of-line，是次要绑定）：判定用 `event.ctrlKey || event.metaKey` 一把抓，不做平台检测——本仓零平台嗅探代码，且平台嗅探在测试里的 stub 会命中测试分桶脚本的 `stubGlobal` 脏标记、把测试文件踢出快桶（测试成本）；判定同时要求 `!event.altKey`——AltGr 在部分键盘布局上等价 Ctrl+Alt，不排除会被误判成触发补链接（误触发风险）。已知代价（显式接受）：mac 上误伤 Emacs 绑定，代价是"一次编辑没发生"，不丢数据，可用 Shift+End 再删代替。

### 3.5 onChange 红线

`textarea` 的 `onChange` 绝不能对 `value` 做任何加工（trim / 行尾转换 / 任何归一化）。原因：React 受控 `textarea` 写回时，`react-dom` 内部带一条守卫 `value !== element.value && (element.value = value)`；只要 `onChange` 把与 DOM 当前值不同的字符串灌回 state，这条守卫就会触发整体赋值 `element.value = value`，浏览器原生撤销栈当场清空（Ctrl+Z 撤不回，甚至撤掉更早内容）。`applyEdit`（走 `execCommand`）改完 DOM 后原样把同一字符串灌回 `onChange`，守卫不成立、不触发整体写回，从 React 的视角这条路径与用户普通打字完全同构；一旦 `onChange` 加工了 value，这个前提就被破坏。

这种坏法**静默**：功能表现不会立刻出错，只有撤销栈会在用户下次按 Ctrl+Z 时表现异常。机检覆盖两层：`textareaEdit.test.tsx` 里的"React 零回写计数器"护栏守的是那个测试文件内部的等价 Probe 组件；`pages/DiaryPage.successPath.test.tsx`（jsdom 打桩出真实 `execCommand`，用同一套计数器手法）接的是 `DiaryPage.tsx` 本体的 `onChange`——生产组件的 `onChange` 一旦加工 value，这条测试当场变红（实测过：往 `onChange` 加一个 `.trimEnd()` 就红），不再只能靠 review 兜底。

### 3.6 撤销栈：已知缺口

`applyEdit` 探测 `document.execCommand` 是否存在（存在性探测，不是"调用后看返回值"）；不存在时（含**jsdom 全部测试环境**——jsdom 不实现 `execCommand`）走降级路径：`runEditAction` 调 `setValue`（即 React `setState`）整体回写，功能结果正确（最终文本与走 `execCommand` 一致），但**这一步没有进原生撤销栈**——用户按 Ctrl+Z 会跳过这次编辑。`execCommand` 调用失败（`rejected`，如浏览器拒绝该操作）同样走这条降级路径。

因此：**撤销行为本身零自动化覆盖**（jsdom 测不出真实的浏览器撤销栈行为，所有 DOM 测试天然只能验证降级路径的文本正确性），只能靠真机人工验收（Ctrl+Z 逐步撤销三个键位各自产生的编辑）。

### 3.7 dirty 记账四条路径

| 路径 | 触发点 | 说明 |
|---|---|---|
| replace + 成功 | `onChange` | `execCommand` 发出真实 `input` 事件，React `onChange` 自然触发，页面 `onChange` 里调 `markDirty()` |
| replace + 降级 | `runEditAction` 内显式 `markDirty()` | `setValue` 不经 `onChange`，漏了这一步保存按钮永远不亮 |
| select | 不置 | 用户一个字没改，不该变脏 |
| noop | 不置 | 同上 |

置脏的两个出口只有 `onChange` 与 `runEditAction` 的降级分支，二者都调 `markDirty()`（序号 +1 再 `setDirty(true)`），不许裸调 `setDirty(true)`；`select`/`noop` 两条路径刻意什么都不调。序号是"保存在途中有没有继续打字"的唯一判据（§2.8）。**清除**只有两个出口：保存成功且序号未变、加载/重载成功。

### 3.8 行尾保护

`detectEol`（`eol.ts`）在内容**进 textarea 之前**、对原始 `fetch` 结果探测主导行尾（CRLF 计数 > LF 计数判 CRLF，平局或无换行判 LF），存进 `eolRef`（`useRef`，不是 state——不参与渲染）；`handleSave` 保存时按 `eolRef.current` 把 `content`（textarea 值，HTML 规范保证已归一为 LF）里的 `\n` 换回 `\r\n` 再 PUT。第二个写入点在 `handleReload`（点"刷新重载"）：同样要在 `setContent` 之前重新探测，容易漏——`eolRef` 若还停在上一次的值，会把新加载的 LF 文件当成 CRLF 写回，或反过来。

已知行为（接受，不是 bug）：
- **混合行尾的原文件会被统一成主导行尾**，产生一次性全篇 diff——混合行尾文件本就异常，统一比"随机保留一半"更可预期，且只发生一次。
- **孤立 `\r`（老 Mac 行尾）不计入 CRLF/LF 计数**，这类文件本来就会被 textarea 的 HTML 规范归一行为转成 LF；已知不修，不在 `detectEol` 职责内处理。

## 4. 日期与跨零点

### 4.1 两种模式

`resolveDiaryDate({ param, liveToday, followAnchor })` 是唯一裁决点，返回 `{ date, following, rolledOver, clearParam }`：

- **显式模式**（URL 有合法且早于今天的 `?date=`）：`date` = 该日期，`rolledOver` **恒 false**。用户翻到 7/20 补写时头上不会一直挂着「切到今天」。
- **跟随模式**（无参 / 参数非法 / 未来 / 恰是今天）：`date` = `followAnchor`，`rolledOver` = 实时今天是否已越过锚点，`clearParam` 提示页面把冗余参数 `replace` 掉。

`followAnchor` 是 **state 不是 ref**：它参与渲染（`date` 与 `rolledOver` 都由它算出来），改了必须重渲染。它只在「（重新）进入跟随模式」时前进（点提示条、或用 DateNav 切回今天），**绝不随实时今天自动前进**——自动前进就是跨零点把用户正在写的正文换到新文件。

> 别写成「因为同 URL 的 `setSearchParams({})` 是 no-op、不触发渲染，所以锚必须是 state」——**这个机理是错的**，实测同 URL 的 `setSearchParams` 照样发起一次真导航并触发重渲染。理由就是上面那条朴素的「它参与渲染」。

### 4.2 跨天：只提示不自动切

过零点后正文与存盘日期都停在原处，只出一条提示条。自动切 = 正在写的那段被换到新文件；不点提示条就一直存到昨天那篇，这正是「补写昨天」的语义。提示条文案**必须带具体日期**——`useAppResumeRefresh` 让息屏几天后回前台立刻刷新，一次可能跨好几天。

**红线**：正文加载 effect 的依赖数组里**绝不能出现** `liveToday` / `now`。写进去就是每分钟重新 `fetchDiary` + `setContent`，直接覆盖用户正在编辑的正文，且静默。

### 4.3 切日期必须重置的五态，与真正兜底的那道闸

`loading` / `error` / `conflict` / `loadFailed` / `dirty` **没有任何地方会自动重置**（`loading` 全文只有置 false、`loadFailed` 只有置 true；`dirty` 只在加载**成功**路径才清），必须在日期 effect 开头显式重置：

| 态 | 不重置的后果 |
|---|---|
| `loading` | 旧正文原地留着直到新内容到达，用户对着上一天的内容打字然后被覆盖 |
| `error` | 上一天的错误提示条挂在新一天页面上，误导用户 |
| `conflict` | 上一天的冲突条挂到新一天头上，点「仍然覆盖」force 掉新一天的文件 |
| `loadFailed` | 一次加载失败之后，切到任何日期都永远是全屏「加载失败」 |
| `dirty` | 新一天**加载失败**时脏标记永久停在 true，把共享的 `useUnsavedChangesGuard`（含 `beforeunload` 那条腿）钉死在武装状态，对着一份用户已确认丢弃、屏幕上也不存在的内容反复弹「放弃未保存的修改？」——保护 vault 的最后一道人肉闸被喊成狼来了 |

`fetchDiaryConfig` 拆在独立的 `[]` effect 里：config 与日期无关，不拆则每切一天多一次往返，也多一次「config 失败 → 整页 loadFailed」的机会。

日期 effect 同时把 `baseMtime` 清成 `null`，但这**不是**一道有效防线：`handleSave` 现在 `loading || loadFailed` 两态都早退，已经覆盖了"`content` 还是上一天残留"的全部窗口，`baseMtime` 清不清都轮不到它起作用（删掉这行、跑 DiaryPage 全部测试验证过仍然全绿）。保留只是语义上仍然对、给将来改动留的防御性兜底，**不要为它单独凑测试**。

真正堵住这个窗口的是 `handleSave` 入口的 `if (loading || loadFailed) return;`。不加这道闸：切日期后新一天的正文还没加载出来（`loading` 期）或加载失败（`loadFailed` 期）时，`content` 里是上一天的残留正文，且 `baseMtime` 已被日期 effect 清成 `null`；此时若能保存，会把上一天的正文写进新一天的文件，且 `baseMtime === null` 会让服务端 mtime 并发守卫（§2 第 3 条）当成"文件不存在"直接放行——不报 409 冲突，静默写坏新一天的文件。**触发路径不需要 textarea 挂载**：这两态下主区域是全屏提示、textarea 未渲染，容易误以为"用户碰不到保存"，但 Ctrl+S 的快捷键监听挂在 `window` 上，不经过 textarea，且保存按钮本身在 `loadFailed` 态下也没有单独置灰——两条路都能触发 `handleSave`。这条早退是四态重置之外**必须另外补的一道闸**，不是四态重置能自然带出来的推论。

### 4.4 脏态确认由页面自己弹

`useUnsavedChangesGuard` 的 `shouldBlock` 只比 `pathname`，`?date=` 变化 pathname 不变 → **它一概拦不到**。所以切日期 / 点提示条时必须页面自己 `await confirm(...)`；不弹就是静默丢数据。反过来说也不会出现双弹层。文案单独写（并没有「离开」页面），不复用守卫默认的「离开后当前修改将丢失」。

### 4.5 在途响应的三道闸（正交，不可互相替代）

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

### 4.6 不用改的东西

- `lib/androidBackNavigation.ts` 的 `/diary` 分支恒返回 `{type:"back", fallbackTo:"/quick-notes"}`，不用改。它不需要像 `/` 分支那样显式判 `has("date")`——`/` 无 date 时的动作是 `exit`（退出 app），必须先把日期历史退完；而 `/diary` 的动作恒为 `back`，且切日期一律走 `replace`（§2.13），压根不产生日期历史。

**但 `location.key === "default"` 这个哨兵会被 `replace` 打破**：`handleBack` 拿它判断「书签 / PWA 快捷方式 / 硬刷新直接落地，没有 app 内历史」，而本页的 `setSearchParams(..., { replace: true })`（切日期两处 + `?date=` 归一一处）会把 `location.key` 从 `"default"` 换成随机 key。所以必须在**挂载那一刻**把这个判断定下来存进 ref，不能每次渲染现读——否则直接落地后切一次日期，返回按钮就从「兜底回速记页」退化成 `navigate(-1)` 空转。

> **已知缺口**：安卓返回键的执行层 `AndroidBackButtonHandler.tsx` 是 app 全局挂载的，在按键那一刻**现读** `location.key`，踩的是同一个坑。窄场景（直接落地 `/diary` + 切过日期 + 按安卓返回键）下它会 `navigate(-1)` 空转；页内返回按钮仍可用，所以不是死路。修它要动全局导航层，留待单独处理。
- `components/DateNav.tsx` **一个字节不动**：它有 3 条 `check:design` 精确豁免，匹配是「rule + 文件 + trim 后整行文本」三元组，改一个字符就失配。要调间距在外面包容器。它自己每次渲染现算 `today`，跨零点会自动跟上，无需传 prop。

## 5. 模块速查

| 入口 | 职责 |
|---|---|
| `pages/DiaryPage.tsx` | 编辑页：加载当天内容、`handleKeyDown` 分派三键位、脏态提示离开、mtime 冲突 UI（§3）、日期驱动与跨零点提示（§4） |
| `pages/settings/SettingsDiaryPage.tsx` | 设置页：显示 enabled 状态、编辑并保存路径模板、400 错误展示服务器中文 message |
| `lib/diary/diaryDate.ts` | `resolveDiaryDate`：显式/跟随两种日期模式的唯一裁决点（§4.1） |
| `lib/diary/diaryApi.ts` | 客户端 API 封装：`fetchDiaryConfig`/`saveDiaryTemplate`/`fetchDiary`/`saveDiary`，`DiaryConflictError` |
| `lib/diary/textareaEdit.ts` | 程序化编辑唯一出口：`applyEdit` 走 `execCommand` 保住原生撤销栈，`runEditAction` 统一落地 `EditAction`（§3.1/3.5/3.6/3.7） |
| `lib/diary/orderedList.ts` | 有序列表回车整段重排纯函数（§3.2） |
| `lib/diary/listModel.ts` | 共享行模型与有序列表重排原语（供回车重排 §3.2 / Tab 缩进 §3.3 复用） |
| `lib/diary/indent.ts` | Tab/Shift+Tab 缩进出层纯函数，带父行约束与顶层逃生口（§3.3） |
| `lib/diary/link.ts` | Ctrl+K 补 markdown 链接纯函数，四态返回（null/noop/select/replace）+ 围栏豁免，七 case（§3.4） |
| `lib/diary/eol.ts` | 行尾保护：探测原文件主导行尾（CRLF/LF），`DiaryPage` 保存时据此还原，避免打开 CRLF 文件后静默改写成 LF（§3.8） |
| `server/routes/diary.ts` | 四端点：`GET/PUT /config`、`GET/PUT /:date` |
| `server/lib/diary-path.ts` | 模板展开 + 路径安全校验纯函数 |

**client**：`pages/DiaryPage.test.tsx`、`pages/DiaryPage.successPath.test.tsx`、`pages/settings/SettingsDiaryPage.test.tsx`、`lib/diary/{diaryApi,diaryDate,orderedList,listModel,indent,link,eol}.test.ts`、`lib/diary/textareaEdit.test.tsx`
**server**：`routes/diary.test.ts`、`lib/diary-path.test.ts`
