---
type: evergreen
title: 日记 · 编辑器语义
covers:
  - packages/client/src/lib/diary/textareaEdit.ts
  - packages/client/src/lib/diary/orderedList.ts
  - packages/client/src/lib/diary/listModel.ts
  - packages/client/src/lib/diary/indent.ts
  - packages/client/src/lib/diary/link.ts
  - packages/client/src/lib/diary/eol.ts
last-reviewed: 2026-07-27
---

# 日记 · 编辑器语义

> 讲什么：日记 textarea 的三个自定义键位（回车整段重排 / Tab 缩进出层 / Ctrl+K 补链接）的行为契约、写回适配器的四态返回值、`onChange` 红线与撤销栈约束、dirty 记账的四条路径、行尾保护。
> 不讲什么：日记的数据流与服务端契约、日期与跨零点、参考栏（见 [diary](../diary.md) 与 [diary/reference-panel](reference-panel.md)）。

## 承上启下

- **上游**：`DiaryPage.tsx` 的 textarea `onKeyDown` 分派到这里的纯函数。
- **下游**：纯函数返回编辑描述符，由 `textareaEdit.ts` 的 `applyEdit` 统一走 `execCommand` 写回（保住浏览器原生撤销栈）。
- **契约**：三个纯函数一律返回**编辑描述符或 `null`**，`null` = "我不管，交给浏览器默认"（§1）；`onChange` 不得对 `value` 做任何加工（§5）。
- **邻居**：[diary](../diary.md)（主文档，数据流与关键契约）、[diary/reference-panel](reference-panel.md)（同主题子文档）。

> 三个键位在 `DiaryPage.tsx` 的 `handleKeyDown` 里统一分派：先过 IME 组合态守卫（`event.nativeEvent.isComposing` 提前 return，三键位共用同一处判断，不在各自纯函数里重复判断），再按 `event.key` 依次尝试 `applyEnterInOrderedList` / `applyIndent` / `applyLinkShortcut`，命中的纯函数返回一个 `EditAction`，交给 `runEditAction`（`textareaEdit.ts`）统一落地。三个纯函数与 `listModel.ts` 共享同一份行模型（行定位 `splitLines`/`lineIndexAt`、保护位扫描 `scanProtected`、分块 `assignBlocks`、重排 `renumberBlock`）——这是本阶段唯一准用的一份实现，两处各写一套曾被判定为最大架构风险。

## 1 EditAction 四态契约

| 返回值 | 语义 | `handleKeyDown` 动作 | 是否置 dirty |
|---|---|---|---|
| `null` | 不处理这个按键 | **不** `preventDefault`，交还浏览器默认行为 | 不涉及 |
| `{ kind: "noop" }` | 吃掉按键但不改任何东西 | `preventDefault`，不碰 `setValue`/`markDirty` | 否 |
| `{ kind: "select" }` | 只挪光标 | `preventDefault`，只调 `field.setSelectionRange`，**不**走 `execCommand` | 否 |
| `{ kind: "replace" }` | 替换 `[start,end)` 为 `text`，落点 `[selStart,selEnd)` | `preventDefault`，走 `applyEdit`（execCommand） | 见 §7 |

`null` 与 `{ kind: "noop" }` 都不碰 `setValue`/`markDirty`，差别只在按键要不要交还浏览器继续处理（唯有 `null` 不 `preventDefault`）；这条区分是 `handleKeyDown` 一层的判断，`runEditAction` 内部只处理非 `null` 的三态。

## 2 回车：有序列表整段重排

光标不在列表项 marker 之后（缩进/编号/gap 内部，或所在行根本不是列表项）→ `null` 放行原生换行；光标落在代码围栏 / front-matter 保护区内（`scanProtected`）同样 `null` 放行——这两类都是"看起来像列表操作但不该拦"。

**识别口径 = Markdown 标准**：`ITEM_RE` 只认半角数字 + `.` + 至少一个半角空白。全角数字、中文句号/全角句点、全角空格、编号后无空格这类形近写法一律是普通文本——回车放行原生换行，编辑器不改写、不提示。这是有意设计，不当 bug 修（形近行"回车没续号"是预期行为）；被否决的放宽与提示路线见 [ADR 0022](../../adr/0022-diary-list-marker-strict-markdown.md)。

命中列表项后：
- **附属行**（`assignBlocks`）：视觉列宽大于块内最近一项列宽的非列表行（续写段落、无序子项）随块移动、不参与编号计数、字节原样保留；不加这条，`"1. a\n   续写\n2. b"` 会在无序子项处断块，`"2. b"` 被孤立分块后拉直成 `"1. b"`。
- **单项块护栏**：块内只有 1 个列表项时不做整段拉直，退化为"当前号 + 1"；块内 ≥2 项才整段拉直（`straighten = block.items >= 2`）。不加这条，loose list（`"1. a\n\n2. b"`）里的 `"2. b"` 会被孤立分块后错误拉直成 `"1. b"`。
- **空列表项回车 = 逐级出层**：光标前无内容、行内光标后也无余文时不续号。**还有缩进可拿就先退一层**（`removableIndentLen`，与 Shift+Tab 同一份判据），编号交给整块重排按新层级算；**退到顶层再按一次才清空该行**。三级项要连按三次才清行，每次退一层。与 Notion / Typora / Obsidian 行为一致。
  - 深层空项**不做**"一步清到空行"，是有意的：空行既不是列表项也没有缩进，清出来之后按 Tab 想救回，`applyIndent` 的候选行过滤直接放行、焦点跳去下一个可聚焦元素（宽屏正是分栏拖拽把手）——表现为"回车吐出没序号的行、Tab 还会乱跳"。
  - **顶层空项回车仍是清行**（边界表 C09/C39/C41），它是这条边界的另一半——顶层若也"再退一层"就没有出口了。
  - 出层后下方更深的项按 `expectedNumbers` 的单调栈重算层级（边界表 C55），出层行所在层级的后续项顺延（C42）——都是整段拉直的既定语义，不是出层额外引入的副作用。
- **两条回车分支共用一个块重排 helper**（`rebuildBlockAround`）：续号拆行与空项出层的唯一区别是"当前行被替换成哪几行"，其余（整块重排 → `trimEditSpan` 前后缀裁剪 → 光标公式 → 映射回 `value` 坐标系）逐字相同。别拆成两份各写一套——光标公式里"编号位数变化可能发生在光标上方"那半条极易漏抄（踩过：出层分支漏了它，块内 9→10 跨位数时光标落错）。
- **光标落点**：不能用"旧光标 + 增量"算——编号位数变化（如 9→10）可能发生在光标上方；必须用 `blockStart + 新块内新行之前所有行长度和 + 新行重排后的 markerLen`。
- **最小编辑区间**：`trimEditSpan` 做前后缀字节级裁剪，编号本来就对时自然塌成插入点，上下文一个字节不动。

## 3 Tab / Shift+Tab：缩进出层

判定"这一行算不算列表行"看整行本身，与光标在行内哪一列无关（缩进区/marker 中间/行尾/空列表项都算）——这与回车不同，回车看的是"光标是否在 marker 之后"。

- **父行约束**（Tab 入层，`canIndentRows`）：目标行在同块内必须存在上方最近的列表项（块首行不可缩进）；且目标行原深度必须 ≤ 上方最近列表项的新深度，否则拒绝（防跳级）。附属行既不断链也不推进"最近列表项"深度。
- **出层不受父行约束**：Shift+Tab 只要该行还有缩进可拿即放行——`indent` 以 `\t` 开头拿掉 1 个 Tab 字符，否则视为空格缩进的老文件，最多拿掉 `TAB_COLUMNS`（4）个前导空格。这条判据（`removableIndentLen`）住在共享行模型 `listModel.ts`、**不在 `indent.ts`**：空列表项回车的逐级出层（§2）要用同一份判据，两处各写一套会分叉成"Shift+Tab 认为还能出层、回车认为已经到顶"。
- **逃生口**：`targets` 为空即返回 `null`，把焦点交还浏览器——Tab/Shift+Tab 各自都有确定的出口，满足 WCAG 2.1.2 键盘陷阱要求存在出口。Tab 的前向出口：非列表行/围栏内（候选行过滤阶段就放行）、以及**块首行**（父行约束 `canIndentRows` 拒绝——块首行即任意列表的第一项，日记里最常见的位置）。Shift+Tab 的反向出口：**顶层列表行**（`removableIndentLen` 判定无缩进可拿）。Shift+Tab 在顶层**不**被吃掉：为"对称性"让它也被吃掉会把两个方向同时封死，构成键盘陷阱。
- **缩进不带子树**（已知行为，非 bug）：只动目标行的 `indent`，子项原样留在原深度；带子树要引入"子树"概念与额外用户预期，多行选中一起缩已经用行级操作覆盖了这个需求。
- **缩进字符固定 `\t`**（`INDENT` 常量），不做设置项；且是**前置** Tab（`INDENT + indent`）不是后置——保证 `visualCol("\t" + s) === visualCol(s) + TAB_COLUMNS` 恒成立，这个等式只在前置时成立，后置只在原列宽恰好是 4 的倍数时碰巧对，否则会漂移，还会让 Shift+Tab 的 `removableIndentLen` 认不出刚加的 Tab，Tab→Shift+Tab 就不再互逆。
- **替换区间是行级收窄**（改动首行到末行整行替换），不是回车用的字节级前后缀裁剪——Tab 是"这一整行往里/往外挪"的行级操作，回车是"在光标处拆一行"的插入点操作，两者口径不同是有意的。

## 4 Ctrl+K：补 markdown 链接

四态返回（含义同 §1；`null` 当前实现不会产出，签名保留只为兼容调用方 `if (!action)` 的判空写法），内部七 case（case① 是调用方的 IME 组合态守卫，不在函数内）：

1. **case②** 光标或选区任一端落在代码围栏 / front-matter 内 → `{ kind: "noop" }`——围栏内同样做不成链接，与"选区含换行"同一类，不像 Tab 顶层逃生口那样交还浏览器。
2. **case③** 选区 trim 后仍含换行 → `{ kind: "noop" }`；必须早于 case⑥ 的 URL 判定——WHATWG URL 解析器会先剥掉字符串里的 tab/LF/CR 再解析，跨行选区若先过 URL 判定会被误判成合法 URL，生成把两行硬粘起来的错链接，而且看起来"成功了"。
3. **case④** 光标/选区落在已有 `[文本](URL)` 上 → `{ kind: "select" }`，只挪光标到 URL 段，不改文本、不置 dirty。
4. **case⑤** 无选区 / 全空白选区 → 插入 `"[]()"`，光标落在方括号之间。
5. **case⑥** 选区 trim 后是 `http`/`https` URL → 把 URL 塞进圆括号，光标落进方括号等待填标题。
6. **case⑦** 其余情况 → 把选中文字包进方括号，光标落进圆括号等待填地址。

**mac 上 Ctrl+K 会被一并吃掉**（Emacs 风格 kill-to-end-of-line，是次要绑定）：判定用 `event.ctrlKey || event.metaKey` 一把抓，不做平台检测——本仓零平台嗅探代码，且平台嗅探在测试里的 stub 会命中测试分桶脚本的 `stubGlobal` 脏标记、把测试文件踢出快桶（测试成本）；判定同时要求 `!event.altKey`——AltGr 在部分键盘布局上等价 Ctrl+Alt，不排除会被误判成触发补链接（误触发风险）。已知代价（显式接受）：mac 上误伤 Emacs 绑定，代价是"一次编辑没发生"，不丢数据，可用 Shift+End 再删代替。

## 5 onChange 红线

`textarea` 的 `onChange` 绝不能对 `value` 做任何加工（trim / 行尾转换 / 任何归一化）。原因：React 受控 `textarea` 写回时，`react-dom` 内部带一条守卫 `value !== element.value && (element.value = value)`；只要 `onChange` 把与 DOM 当前值不同的字符串灌回 state，这条守卫就会触发整体赋值 `element.value = value`，浏览器原生撤销栈当场清空（Ctrl+Z 撤不回，甚至撤掉更早内容）。`applyEdit`（走 `execCommand`）改完 DOM 后原样把同一字符串灌回 `onChange`，守卫不成立、不触发整体写回，从 React 的视角这条路径与用户普通打字完全同构；一旦 `onChange` 加工了 value，这个前提就被破坏。

这种坏法**静默**：功能表现不会立刻出错，只有撤销栈会在用户下次按 Ctrl+Z 时表现异常。机检覆盖两层：`textareaEdit.test.tsx` 里的"React 零回写计数器"护栏守的是那个测试文件内部的等价 Probe 组件；`pages/DiaryPage.successPath.test.tsx`（jsdom 打桩出真实 `execCommand`，用同一套计数器手法）接的是 `DiaryPage.tsx` 本体的 `onChange`——生产组件的 `onChange` 一旦加工 value，这条测试当场变红（实测过：往 `onChange` 加一个 `.trimEnd()` 就红），不再只能靠 review 兜底。

## 6 撤销栈：已知缺口

`applyEdit` 探测 `document.execCommand` 是否存在（存在性探测，不是"调用后看返回值"）；不存在时（含**jsdom 全部测试环境**——jsdom 不实现 `execCommand`）走降级路径：`runEditAction` 调 `setValue`（即 React `setState`）整体回写，功能结果正确（最终文本与走 `execCommand` 一致），但**这一步没有进原生撤销栈**——用户按 Ctrl+Z 会跳过这次编辑。`execCommand` 调用失败（`rejected`，如浏览器拒绝该操作）同样走这条降级路径。

因此：**撤销行为本身零自动化覆盖**（jsdom 测不出真实的浏览器撤销栈行为，所有 DOM 测试天然只能验证降级路径的文本正确性），只能靠真机人工验收（Ctrl+Z 逐步撤销三个键位各自产生的编辑）。

## 7 dirty 记账四条路径

| 路径 | 触发点 | 说明 |
|---|---|---|
| replace + 成功 | `onChange` | `execCommand` 发出真实 `input` 事件，React `onChange` 自然触发，页面 `onChange` 里调 `markDirty()` |
| replace + 降级 | `runEditAction` 内显式 `markDirty()` | `setValue` 不经 `onChange`，漏了这一步保存按钮永远不亮 |
| select | 不置 | 用户一个字没改，不该变脏 |
| noop | 不置 | 同上 |

置脏的两个出口只有 `onChange` 与 `runEditAction` 的降级分支，二者都调 `markDirty()`（序号 +1 再 `setDirty(true)`），不许裸调 `setDirty(true)`；`select`/`noop` 两条路径刻意什么都不调。序号是"保存在途中有没有继续打字"的唯一判据（[diary](../diary.md#diary-save-revision)）。**清除**只有两个出口：保存成功且序号未变、加载/重载成功。

## 8 行尾保护

`detectEol`（`eol.ts`）在内容**进 textarea 之前**、对原始 `fetch` 结果探测主导行尾（CRLF 计数 > LF 计数判 CRLF，平局或无换行判 LF），存进 `eolRef`（`useRef`，不是 state——不参与渲染）；`handleSave` 保存时按 `eolRef.current` 把 `content`（textarea 值，HTML 规范保证已归一为 LF）里的 `\n` 换回 `\r\n` 再 PUT。第二个写入点在 `handleReload`（点"刷新重载"）：同样要在 `setContent` 之前重新探测，容易漏——`eolRef` 若还停在上一次的值，会把新加载的 LF 文件当成 CRLF 写回，或反过来。

已知行为（接受，不是 bug）：
- **混合行尾的原文件会被统一成主导行尾**，产生一次性全篇 diff——混合行尾文件本就异常，统一比"随机保留一半"更可预期，且只发生一次。
- **孤立 `\r`（老 Mac 行尾）不计入 CRLF/LF 计数**，这类文件本来就会被 textarea 的 HTML 规范归一行为转成 LF；已知不修，不在 `detectEol` 职责内处理。
