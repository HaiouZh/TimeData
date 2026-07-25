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
last-reviewed: 2026-07-25
---

<!-- 复核 2026-07-25（diary-workbench 阶段二 · 编辑器语义收口）：补三键位（回车整段重排/Tab缩进出层/Ctrl+K补链接）契约、EditAction 四态、onChange 红线、撤销栈已知缺口、dirty 记账四条路径、行尾保护 §3.8；不新增 covers（lib/diary/** 通配已覆盖全部新文件）。 -->

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
8. **vault 写权限**：生产镜像 entrypoint 在降权到 UID/GID 1000 前，只创建并递归校正固定挂载根 `/app/vault` 的所有权；`DIARY_VAULT_DIR` 子目录由应用按需创建，误配到挂载根外或含 `.` / `..` 路径段时只告警。文件系统拒绝改权时启动继续但输出 warning，日记写接口把 `EACCES` / `EPERM` / `EROFS` 收敛为 503 `diary-vault-not-writable`，不再暴露通用 500。

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
| replace + 成功 | `onChange` | `execCommand` 发出真实 `input` 事件，React `onChange` 自然触发，页面 `onChange` 里 `setDirty(true)` |
| replace + 降级 | `runEditAction` 内显式 `markDirty()` | `setValue` 不经 `onChange`，漏了这一步保存按钮永远不亮 |
| select | 不置 | 用户一个字没改，不该变脏 |
| noop | 不置 | 同上 |

### 3.8 行尾保护

`detectEol`（`eol.ts`）在内容**进 textarea 之前**、对原始 `fetch` 结果探测主导行尾（CRLF 计数 > LF 计数判 CRLF，平局或无换行判 LF），存进 `eolRef`（`useRef`，不是 state——不参与渲染）；`handleSave` 保存时按 `eolRef.current` 把 `content`（textarea 值，HTML 规范保证已归一为 LF）里的 `\n` 换回 `\r\n` 再 PUT。第二个写入点在 `handleReload`（点"刷新重载"）：同样要在 `setContent` 之前重新探测，容易漏——`eolRef` 若还停在上一次的值，会把新加载的 LF 文件当成 CRLF 写回，或反过来。

已知行为（接受，不是 bug）：
- **混合行尾的原文件会被统一成主导行尾**，产生一次性全篇 diff——混合行尾文件本就异常，统一比"随机保留一半"更可预期，且只发生一次。
- **孤立 `\r`（老 Mac 行尾）不计入 CRLF/LF 计数**，这类文件本来就会被 textarea 的 HTML 规范归一行为转成 LF；已知不修，不在 `detectEol` 职责内处理。

## 4. 模块速查

| 入口 | 职责 |
|---|---|
| `pages/DiaryPage.tsx` | 编辑页：加载当天内容、`handleKeyDown` 分派三键位、脏态提示离开、mtime 冲突 UI（§3） |
| `pages/settings/SettingsDiaryPage.tsx` | 设置页：显示 enabled 状态、编辑并保存路径模板、400 错误展示服务器中文 message |
| `lib/diary/diaryApi.ts` | 客户端 API 封装：`fetchDiaryConfig`/`saveDiaryTemplate`/`fetchDiary`/`saveDiary`，`DiaryConflictError` |
| `lib/diary/textareaEdit.ts` | 程序化编辑唯一出口：`applyEdit` 走 `execCommand` 保住原生撤销栈，`runEditAction` 统一落地 `EditAction`（§3.1/3.5/3.6/3.7） |
| `lib/diary/orderedList.ts` | 有序列表回车整段重排纯函数（§3.2） |
| `lib/diary/listModel.ts` | 共享行模型与有序列表重排原语（供回车重排 §3.2 / Tab 缩进 §3.3 复用） |
| `lib/diary/indent.ts` | Tab/Shift+Tab 缩进出层纯函数，带父行约束与顶层逃生口（§3.3） |
| `lib/diary/link.ts` | Ctrl+K 补 markdown 链接纯函数，四态返回（null/noop/select/replace）+ 围栏豁免，七 case（§3.4） |
| `lib/diary/eol.ts` | 行尾保护：探测原文件主导行尾（CRLF/LF），`DiaryPage` 保存时据此还原，避免打开 CRLF 文件后静默改写成 LF（§3.8） |
| `server/routes/diary.ts` | 四端点：`GET/PUT /config`、`GET/PUT /:date` |
| `server/lib/diary-path.ts` | 模板展开 + 路径安全校验纯函数 |

**client**：`pages/DiaryPage.test.tsx`、`pages/settings/SettingsDiaryPage.test.tsx`、`lib/diary/{diaryApi,orderedList,listModel,indent,link,eol}.test.ts`、`lib/diary/textareaEdit.test.tsx`
**server**：`routes/diary.test.ts`、`lib/diary-path.test.ts`
