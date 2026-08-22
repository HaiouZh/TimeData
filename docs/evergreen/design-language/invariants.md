---
type: evergreen
title: 设计语言 · 关键不变量与红线
covers:
contracts:
  - packages/client/src/index.css
  - packages/client/src/lib/bottomInset.ts
  - packages/client/src/hooks/useKeyboardHeight.ts
  - packages/client/src/lib/haptics.ts
  - packages/client/src/pages/stats/chartColors.ts
  - packages/client/src/lib/navigation/navRegistry.ts
last-reviewed: 2026-08-22
---

# 设计语言 · 关键不变量与红线

> [design-language](../design-language.md) 的**红线子文档**：写新 UI 之前该知道的全站不变量、坑与红线。
> 讲什么：token 使用红线、图表取色分工、主导航与设置壳形态、z-index 与安全区让位分工、底部避让量单一来源、触感语义层、状态表达与删除确认的收口判据，以及一条已知界限（存量触控热区）。
> 不讲什么：token 与排版角色的定义（见 [design-language](../design-language.md) §1–§2）、执行这些红线的机器闸（见 [ratchets](ratchets.md)）、自绘控件词汇表（见 [controls](controls.md)）。

## 承上启下

- **上游**：[design-language](../design-language.md) 的 token 与语义类；本文只讲怎么用、不重复定义。
- **下游**：所有功能主题的页面与组件；写新 UI 时这一份是"到了那儿也看不出来的事"。
- **契约**：多数红线有对应机器闸（见 [ratchets](ratchets.md)），带闸的以闸为准；无闸的（如第 6、11、13 条的真机行为）只能靠本文与真机验收。
- **邻居**：[design-language](../design-language.md)（主题）、[ratchets](ratchets.md)（执行闸）、[controls](controls.md)（控件库）。

<a id="design-language-invariants-s1"></a>

## 1. 不变量清单

1. **新 UI 一律用 token，不写裸 hex/rgba**；统计、设置、Todo、Entry、Track、Goal 等页面的 UI chrome 都消费语义颜色、圆角、排版和几何类；用户内容分类预设色是业务数据例外。裸任意尺寸/间距、裸字号、裸圆角均由 [棘轮](ratchets.md) 直接拦截。
2. **图表不维护独立 data palette**：图表序列走用户分类色；用户内容色只代表分类、项目、标签、用户自定义标记。Track agent tone 只表达该调度信号。
3. **无原生表单控件**：`<select>`/`type=checkbox`/`type=radio`/`window.confirm`/`window.alert` 一律用自绘控件——**CI 棘轮 `check:ui` 强制**（见 [controls](controls.md)）。
4. **图标统一 Phosphor**，经 `components/Icon.tsx` 包装（见 [controls](controls.md)）；不用 emoji 或文字字符伪装图标。
5. **recharts 不解析 CSS `var()`**：图表 chrome（axis/grid/tooltip 背景边框文字/legend/cursor）须把中性 token 镜像成 JS 常量，统一出自 `pages/stats/chartColors.ts`（只导出 `CHART_CHROME`），唯一消费方是 TimeStats 的 `InsightCharts`（健康图表随健康子系统退役，见 [ADR 0024](../../adr/0024-retire-health-subsystem.md)）；该文件在 `check:design` 整文件豁免 `bare-raw-color`（见 [棘轮](ratchets.md)），对应的中性颜色事实源是 `index.css` token。数据序列不由本文件取色，走用户分类色（`item.color`，无色回退 `UNCATEGORIZED_COLOR`，见 [stats-insights](../stats-insights.md#stats-insights-s1-2)）；状态色只留给真状态，不上数据序列。
6. **横向溢出从组件源头收口**：全站 `<main>` 负责纵向滚动，交互组件若会产生临时横向位移（如 Todo 拖拽 / swipe 行），应在组件行容器或本主题全局规则里裁掉横向溢出，避免把页面撑出横向滚动面；纵向拖拽让位可单独放开。**推论：swipe 行内的装饰必须画在内侧**——`ring-*` 与任何向外画的 `box-shadow` 会被祖先 `.swipeable-list-item { overflow:hidden }` 整圈裁掉，真机不可见，而 jsdom / happy-dom 不算裁剪，只断言 className 的单测照样全绿（"已归目标任务绿外圈"就这么 ship 成过隐形功能）。用绝对定位子元素（`pointer-events-none`，避开圆角与拖拽命中区）或 `ring-inset`，并靠真机 / 截图验收——单测在这件事上给不出结论。
7. **主导航：移动纯图标 / 桌面图标+文字**：移动底栏主导航用 Phosphor 纯图标（仅 `aria-label`），只渲染 `nav.visibleTabs.v1` 选中的入口并固定保留设置，不提供三点菜单；未选入口由设置的"更多功能"子页承接。桌面侧栏主导航图标下方配 `td-text-caption` 文字标签（aside `w-20`，"更多"按钮同款），这是设计审查 C1 的可读性收口——**仅桌面，移动底栏维持纯图标不变**。图标来自 `navRegistry`，用户配置只保存 route/placement，不保存 icon 名或颜色；主导航按钮必须有 `aria-label`。active 用 `accent-soft` 背景、`accent` 图标色和 `accent` ring，hover/focus 只消费现有 `page/surface/border/ink/accent` token，不为主导航单独引入裸色。轨道回手计数以 `NavBadge`（`bg-accent`/`text-page` 圆点，`td-text-caption`，>9 显「9+」）叠在 `/tracks` 图标右上角，计数为 0 时不渲染；两端复用同一 `NavBadge`，不引裸色。
8. **设置壳与设置行复用 token 组件**：设置详情页外壳 `SettingsDetailPage` 使用 `page/surface/border/ink` token；设置首页的 `SettingsSection` / `SettingsRow` / `SettingsToggleRow` / `SettingsNumberRow` 使用 `surface/border/ink/accent` 语义 tone，避免各设置入口重新引入旧 `slate-*` / 模块色 / 大圆角样式。`SettingsNumberRow` 的步进按钮是 Phosphor `Minus` / `Plus` 图标钮（经 `Icon`，不是文字加减号），与 `input[type=number]` 一起消费 `surface-hover`/`border`/`ink`/`accent` token，不引入裸色。
9. **z-index 走层级 token**：跨局部内容的下拉 / 日期气泡、遮罩、弹层与全屏接管用 `z-[var(--z-*)]`，内联 `style.zIndex` 用 `lib/zLayers.ts` 的 `Z`；普通粘顶头、画布 HUD/notice 等局部 stacking 使用 `z-10`/`z-20`，不升全局 token。新全局浮层选层级按语义对号入座，不另造数值。
10. **单一暗色主题 + 单一动作色**：不搭换肤机制、不引 `[data-theme]`、不出亮色主题；动作色只有品牌蓝一支。motion 走标准 utility/局部 keyframe 值，z-index 与任意值按各自语义治理并由棘轮守。视觉一致性靠单测 + `/dev/styleguide` 预览页人工验收，**不做像素快照**。
11. **安全区让位分工**：顶部与左右在 AppShell 根容器一处解决（根 div 挂 `td-safe-top td-safe-x`，类语义见 [design-language](../design-language.md#design-language-s1)）；底部由**实际占位者自己让**，统一走 `calc(<px> + var(--safe-bottom))` 组成式——px 项是常规偏移，安全区值经 `:root` 的 `--safe-*` 变量流入（机制见 [design-language](../design-language.md#design-language-s1)）。**`--safe-bottom` 固定为 `0px`**：底栏与内容刻意延伸到 home 横条 / 手势条之下、横条浮在其上，这是产品取向不是疏漏；组成式接口照旧保留，要整体恢复让位只改 `:root` 一处、消费点一律不动。按 `<html data-platform="android">` 清零的是顶部与左右（WebView 里原生 padding 与 `env()` 会叠成双倍留白）。消费点：底栏可见态总高与内边距（隐藏态两者一起归零，只归零高度会留下 inset 高空带）、贴底浮层（TodoComposer / TodoSelectionBar / 速记页 / 更新提示 / GoalGraphUndoToast）的 `bottom`、滚动内容与 sticky 收起位的 `paddingBottom` / `scrollPaddingBottom` / `bottom`。**组件里新写底部让位一律走 calc 组成式，不散写裸 `env()`**；底部弹层是让位的唯一例外——`components/ui/Sheet.tsx` 与 `pages/todo/TaskDetailSheet.tsx` 的操作按钮就在面板最下沿，压到横条下会点不到，故走独立的 `--safe-bottom-sheet`（`env(safe-area-inset-bottom)`，两平台同源），本就贴屏幕底边、没有 px 偏移项，直接消费变量。
12. **底部避让量单一来源**：速记页（QuickNotesPage）与待办页（TodoPage）喂进上一条 `calc()` 组成式的 px 项，由 `lib/bottomInset.ts` 的 `composeBottomInset({ barHeightPx, navOffsetPx, keyboardHeightPx })` = `Math.ceil(三者之和)` 单一合成，是两页共用的唯一入口。各页私有的"此刻底部站着谁"（QuickNotes 的 selectionMode/searchOpen 分支、Todo 的多选/滚动收起分支）仍留在各页自己算，只把结果当 `barHeightPx` 喂给合成函数——合成函数本身不判断"底部站着谁"。`keyboardHeightPx` 由 `hooks/useKeyboardHeight.ts` 的 `useKeyboardHeight()` 给出，语义是**「键盘还挡着页面底部多少」**（= JS 还需要额外让开的量），**不是键盘自身的高度**：壳自己已经让过位时它就是 0。口径是**实测优先、插件兜底**，两步：

    1. `visualViewport` 与 `innerHeight` 的差值（`innerHeight - viewport.height - viewport.offsetTop`）实测布局视口底部被遮多少，差值 > 80px 才算数（避免地址栏收合等抖动误报）。这一步自动涵盖壳的两种让位方式——壳缩了 webview 则实测为 0，壳整体上移视口则实测已扣掉挪动量——不需要事先知道壳会怎么做。
    2. 实测报不出遮挡时，回落到 `@capacitor/keyboard` 的 `keyboardWillShow` 高度，再减去壳实际缩掉的高度（`innerHeight` 相对「键盘收起时基线」的落差）。壳的 reflow 晚于 `keyboardWillShow`，首帧无从判断，故记住上一次实测到的缩量、下次弹起直接预扣，避免"先冲高再落回"（**首次**弹起仍会收敛一次，是已知界限）。

    **收起走插件事件优先**：`keyboardWillHide` 一到立即归零，并在 450ms 窗口内压制实测路径——iOS 的 `visualViewport` 要等键盘收起动画结束才恢复，动画期间实测仍报遮挡，不压会把高度顶住不落，输入条比键盘晚落一拍（用户实测「收起输入法后输入框有个下滑动作」）。窗口只压「实测优先」分支：重新弹起（`keyboardWillShow`）立即清窗，web / PWA 没有插件事件、窗口恒不生效，实测路径行为不变。

    **「还挡着多少」与「在不在场」是两个信号，不可混用**：同文件另导出 `useKeyboardVisible()`——native 平台三路信源按快慢叠加：**focusin 预测（最快）**、壳缩实测（与 IME 动画同步）、插件事件（安卓键盘显示完毕才发，壳让位后仍照发）；web 实测兜底。focusin 预测是 Telegram 式「预测先行、实测校正」：可编辑元素聚焦那一刻即在场，消费方（收底栏 / composer 定位）首帧到位，不等滞后信号——安卓真机此前的「输入条上蹿下跳、键盘弹完才吸附」正是等信号等出来的。focusout 到非可编辑目标即离场（换输入框不闪落；也是插件缺席 / 外接键盘时收回信号的唯一自愈出口），并与 `keyboardWillHide` 同款竖起缩量压制，防壳恢复途中的中间帧把在场顶回。桌面浏览器（platform=web）不挂 focus 监听，敲字不收底栏。「键盘弹起时收起底栏」「composer 的隐藏是不是键盘引起的」这类**在场判断**必须用它：拿 `keyboardHeightPx > 0` 判在场，在安卓壳层让位后恒假——底栏不收、缩短的视口里输入条与键盘之间杵一条 tab 行，composer 还会被 navHidden 联动误藏。消费点：Todo 页的收底栏 effect / `navOffsetPx` 守卫 / `composerHiddenByScroll` 守卫，速记页的 `inputInteractionActive`。避让量合成（`composeBottomInset` 的 `keyboardHeightPx`）仍走 `useKeyboardHeight`，两者各管各的。插件的 `addListener` 在插件缺席时**返回 rejected promise 而非同步抛**，两个 hook 都在返回处同步 `.catch` 接住（否则 AppShell 挂 `KeyboardAvoidanceBridge` 后，凡 mock 平台为 native 又没 mock 插件的测试整文件炸 unhandled rejection）。

    **为什么不能直接信 `Keyboard.resize: none`**：该配置**只有 iOS 读**——Android 端 `KeyboardPlugin.java` 只读 `resizeOnFullScreen`，`setResizeMode` 是 `unimplemented()`；而 iOS 侧 `none` 也只拦住插件自己 resize，拦不住 WebKit 因聚焦输入框而挪视口。即"壳不会自己让位"这个前提两个平台都没人保证，直接加键盘高会双倍避让（安卓表现为输入条飞到屏幕顶上，iOS 表现为钻进顶栏底下看不见）。配置本身仍保留并由 `check-android-config.mjs` 棘轮住（对 iOS 有效），但它不再是避让正确性的依据，见 [ios](../ios.md#ios-s3-3)。**Android 侧现走壳层让位**：manifest `adjustResize` + `MainActivity` 消费 `ime()` inset（两条同被 `check-android-config.mjs` 棘轮住，机制见 [android](../android.md#android-s2)），键盘弹起时 webview 整体变矮、本条实测口径自动归零，JS 不再叠加——双倍避让从根上拆除，实测口径退居防漂移兜底。

    **文档流表单与弹层的避让底座（`KeyboardAvoidanceBridge`，挂在 `AppShell`）**：没有 fixed 输入条那套 JS 合成的页面不接 `composeBottomInset`，走全局 CSS 变量 + JS 显式差值滚动--Bridge 把 `useKeyboardHeight()` 写成 `--keyboard-inset`（纯遮挡量）与 `--keyboard-scroll-padding`（遮挡量 + 96px 保存按钮预留），键盘收起时移除变量。聚焦滚动**不委托引擎**：`scrollIntoView({block:"nearest"})` 在 iOS resize:none 下对已在布局视口内的框判「可见」直接 no-op（备注框被键盘整个盖住），CSS scroll-padding 又会在安卓壳让位的窗口期把过期键盘量喂给 Blink 原生聚焦滚动、叠成双倍让位（真机「滑太高」）--由 JS 按 `getBoundingClientRect().bottom + 96 - 键盘上沿` 算差值，只补不足不回滚（重复触发幂等），触发两路：遮挡量每变一次（iOS 主路径，含键盘动画中间值 / 拼音候选条加高的正->正补足）+ 键盘在场边沿与在场期间的 window/visualViewport resize（Android 主路径：壳让位后遮挡量恒 0、高度永不变化，只有事件知道该动了）。两个易踩坑：短表单整页放得下时滚动容器无溢出、`scrollTop` 被 clamp 在 0，滚动空间靠 `.keyboard-scroll-pad`（EntryForm 根容器一类）拿 `--keyboard-scroll-padding` 当 padding-bottom 制造；差值底线实时读 `visualViewport`（iOS 报不出遮挡时回落 `innerHeight - 插件高度`，Android/web 恒信 vv--壳缩 WebView 瞬间 resize 事件先于 React 提交，回落 state 会多滚一个键盘高）。fixed 输入条（速记/待办 composer）内的焦点跳过，避让走各页自己的 bottom 合成。其余消费点：`.keyboard-inset-pad`（日记页编辑器容器、任务详情 overlay）与 `.sheet-overlay` 拿 `--keyboard-inset` 让底，`.sheet-panel` / `.task-detail-sheet(-expanded)` 的限高同步扣掉遮挡量（overlay 抬底后不扣会冲出屏幕顶）。变量语义与 hook 一致（「还挡着多少」）：安卓壳已让位 / 桌面浏览器下不落地，整套底座自动歇业、零双算。

    同一底座还管**键盘落下时释放输入焦点**：`useKeyboardVisible()` 由真转假的那一跳，`document.activeElement` 仍是 `input / textarea / [contenteditable]` 时 `blur()` 它。iOS 上按输入法自带的收起键只收键盘、不摘网页焦点，输入框仍是 `activeElement`、WKWebView 的内容视图仍是 first responder——此后触摸屏上任何元素，WebKit 都把键盘重新弹起（真机表现为「点什么都先弹一次输入法」）。切 tab 时这一弹紧接着被保留层的 `inert` 打断（规范要求 blur 掉 inert 子树内的焦点元素），键盘随即又落下，叠上目标页 `React.lazy` 的 chunk 加载延迟，表现为「输入法唤起收起走一遍才换页」。判据是**那一跳**而非「不在场即 blur」：桌面浏览器该信号恒假，后者会在 Bridge 挂载时把光标从用户正敲的输入框里踢出去（该边沿守卫的真闸是「挂载时不碰已聚焦输入框」那条用例——写成「挂载后聚焦再重渲染」时依赖没变、effect 不重跑，守卫拆了也不红）。焦点停在按钮上时不动它，免得白丢键盘用户的焦点环。同一跳上还有 **iOS 收起归零**：resize:none 下 WebKit 为露出聚焦框会平移/滚动窗口，收起后可能残留 `window.scrollY`，`h-dvh` 布局整体被顶上去（真机「收起键盘后底栏整体上移」）——在场转不在场时若 `scrollY !== 0` 即 `window.scrollTo(0, 0)`。只 iOS 生效；窗口滚动在本应用没有合法来源（滚动全在内层容器），归零无副作用。

    **键盘运动（位移全走动画，Telegram 式）**：底部固定条（Todo composer / Todo 多选栏 / 速记 composer）的载体分工——`bottom` 只装安全区、恒定不动，动态抬升（navOffset / 键盘高的合成值）走 `transform: translateY(-抬升量)` 吃 `transition-transform duration-200 ease-out` 的过渡（合成器线程、无重排；等效终点位置与迁移前逐值相等），iOS 键盘弹起/收起的位移因此是滑动而非瞬跳。安卓壳缩/恢复 webview 是单帧跳变、transform 过渡管不到，由 `lib/keyboardMotion.ts` 的 `useShellResizeGlide` 抹平：`innerHeight` 每变化一个键盘量级（≥80px，与实测阈值同源同值）就给固定条叠一段「从跳变量滑回 0」的**附加**动画（`composite: "add"`，不打断基础 transform 的抬升/滚动隐藏；即 Telegram Android 用 ValueAnimator 平移 parent 的 Web 等价物）——首帧视觉位置不变、随后 200ms 滑到新位置。web 平台不补偿（桌面拖窗不该看到内容滑动），`el.animate` 缺席（旧 WebView / jsdom）时静默退回瞬跳。

    闸：`indexCssTokens.test.ts`（CSS 规则）、`KeyboardAvoidanceBridge.test.tsx`（变量写入、聚焦滚动、焦点释放）、`App.keyboardInset.test.tsx`（AppShell 接线）、`keyboardMotion.test.tsx`（跳变补偿）、`TodoPage.keyboard.test.tsx` / `QuickNotesPage.keyboard.test.tsx` / `TodoComposer.test.tsx`（载体分工：bottom 恒装安全区、抬升在 transform）。

    回归护栏：web / PWA 没有插件桥接、插件高度恒 0，结果等于纯实测值，与引入实测口径前的 web 路径逐值相等；`keyboardHeightPx = 0`（桌面浏览器 / 键盘收起）时合成结果与合成前逐值相等，见 `bottomInset.test.ts`。安全区值不参与本次合成，仍按上一条经 CSS 变量单独叠加。

    两页的 `navOffsetPx` 归零时机不同，如实记差异，不假装一致：Todo 页的 `navOffsetPx` 在计算式里带 `keyboardHeightPx === 0` 同步守卫（`!wide && !navHidden && keyboardHeightPx === 0 ? BOTTOM_NAV_HEIGHT_PX : 0`），键盘一弹起就在同一次渲染里归零，不依赖任何 effect。QuickNotes 页的 `navOffsetPx` 只看 `navHidden`（`!isWideScreen && !navHidden ? BOTTOM_NAV_HEIGHT_PX : 0`），而 `navHidden` 由 `inputInteractionActive`（`composerFocused || searchOpen || keyboardHeight > 0`）驱动的 `useEffect` 异步 `setNavHidden` 得来——键盘收起（`keyboardHeight` 归 0）与 `navHidden` 变回 `false` 隔了一次 effect，即隔一帧。这意味着键盘收起的瞬间可能有一帧 `keyboardHeightPx=0` 且 `navOffsetPx` 还未回填（nav 让位比键盘高晚一帧），composer 输入条会先冲到更低位置再弹回原位（"收起抖"/下冲）。这一帧级别的抖动 jsdom 测不出，是**真机验收项**。

13. **触感只经语义层**：页面调的是 `lib/haptics.ts` 的四个语义函数——`hapticToggle`（勾选 / 取消勾选）、`hapticDestructive`（删除 / 清空）、`hapticGrab`（拖拽拿起）、`hapticDrop`（拖拽吸附落位，取消或原地放下不调）。**「什么动作配什么强度」的映射只写在这一个文件**（`@capacitor/haptics` 的 `ImpactStyle`：destructive 一档重，其余三个最轻档），调用点不出现强度常量，整体调轻重或加全局开关只改这一处。调用接在页面的事件处理处，不下沉进 `lib/` 数据函数——否则跑数据层单测也会震。批量动作**整批只震一次**，不逐条震。iOS 与 Android 原生壳都接；Web / PWA / 桌面经 `Capacitor.isNativePlatform()` 判否后**整层空转**，且不回退 `navigator.vibrate`（浏览器那种整机震与原生轻触感不是同一种反馈）。插件缺失 / 系统关闭 / 硬件不支持一律吞掉，业务动作照常完成：除了接 promise 的 reject，还得防住 `impact` 同步抛与返回非 thenable（插件未注册 / 旧桥 shim）——那两种是**同步** TypeError，`hapticGrab` 在 dnd-kit 的同步 `onDragStart` 里抛出去整个拖拽都起不来。投递坠的「抓到手头」同样是吸附落位，写入成功后要震（投递失败与 invalid 拒绝不震）。
14. **页面样式不写死 `visibility: visible`**：iOS 分层壳 `KeptRouteStack` 靠给整层挂 `visibility: hidden` 隐藏保留层（两层恒 `absolute inset-0` 相互重叠，换 `display:none` 会清掉滚动容器 scrollTop，机制见 [ios/page-stack](../ios/page-stack.md)）。`visibility` 是可继承属性，后代给绝对值 `visible` 即反向击穿祖先的 hidden，该元素连同自身 z-index 一起浮到当前页之上——上一页的浮起元素会挂在下一页画面里，且只在 iOS 壳出现（其余平台上一页直接卸载）。需要「默认可见、可被某个类隐身」的元素写 `visibility: inherit`：常规层级下父级本就是 visible，两者等价；进了保留层才跟着一起藏。棘轮：`indexCssTokens.test.ts` 禁 `index.css` 出现写死的 `visibility: visible`。
15. **状态表达三分工**：需要用户注意或处理的状态（出错、冲突、警告、成功）→ `StatusBanner`；普通信息行（不需要用户做什么，只是告知）→ 普通文字，不套框；一次性操作反馈**且随手给一个动作**（「已删除」+「撤销」、「已打点」+「改时间」这类）→ `ActionToastBar`。分界线是**用户需不需要对它做点什么**，不是「这条信息重不重要」——重要性是主观量、人人排序不同，用户是否要行动是可判定的事实。

    **「会不会自己消失」不是判据，别拿它分桶。** 自动消失是呈现选择，两个组件都可以做：速记页的 `status` 通道（`QuickNotesPage` 的 `showStatus`）是一条**自动消失的浮动 `StatusBanner`**，装的既有「已复制」这种无动作的一次性反馈，也有「请先在设置 · 记录偏好选择打点分类」这种要用户去处理的提示——同一条通道混装两类，而它们都不带动作按钮，所以都不该进 `ActionToastBar`。真正把两者分开的是**这条提示有没有随手挂一个动作**。手写散装三件套由 [棘轮](ratchets.md) 的 `handwritten-status-banner` 拦着。
16. **删除确认两档**：判据是**频次 × 后果**，不是「重要程度」。删掉一个**完整对象**（轨道 / 分类 / 目标 / 一批速记）→ `ConfirmSheet` 弹层确认——低频、误触后果重、连带删掉下属内容；删掉对象**内部的一条**（轨道里的一个步骤）→ `ConfirmDeleteButton` 就地二次确认——高频、后果轻、弹层会打断编辑节奏。重要程度是连续量、人人排序不同，频次和后果是能看出来的事实。

    **待办的删除任务按同一判据收口，但第一档带一个量的门槛**：`deleteTaskCascade` 单事务删 root + 全部直接子任务，重复模板还连清名下活跃 pending occurrence 与镜像子任务（级联范围见 [todo](../todo.md)），故**有子任务或有活跃发次**的走 `ConfirmSheet`，且确认文案带上会被连带删除的条数；**叶子任务直接删不弹**——它没有连带范围，弹层只剩打断。删子任务（`SortableChildRow` 行内的删除钮）属「对象内部的一条」，走 `ConfirmDeleteButton`。这里没有撤销：撤销要按原 id 重建全部记录并处理已推送的 tombstone，是同步层的活，与 `GoalGraphUndoToast` 撤一条连线不是一回事。

<a id="design-language-invariants-s2"></a>

## 2. 已知界限：存量触控热区低于 44px

新写的可点区域一律给到 44px（`min-h-11`；页头返回钮走 `hotarea-lg`）。**存量约 170 处低于这个值**——`packages/client/src/pages/**` 下 237 个 `<button>` 逐处判过，独立按钮已补齐，剩下的改不动，原因分两类：

- **共享 className 变量**（约 60 处）：设置页三处的 `primary` / `secondary` / `danger` / `warnButtonClassName`（数据页、两步验证、后台洞察，≈34px）、速记页的 `MENU_ITEM_CLASS`（42px）、目标页与待办的 `CONTROL_PILL_CLASS` / `CONTROL_CLASS` / `tabButtonClass` / `TOGGLE_BTN` / `segmentedClass`（36px 分段控件）。一个变量供多处调用，改它就同时改掉全部调用方。
- **紧凑行与绝对定位**（约 110 处）：速记页多选工具条（7 个元素排一行）、日记页的状态条、目标图节点角外的 pin、子任务行的删除钮与拖柄。补到 44px 会顶开所在行，或盖住它标注的那个对象。

这批里**唯一不牵动布局的是设置页那 23 处**——低频页、独立按钮、周围有空间；其余各处要达标都得连着改所在行的排布，属版式重做而非加一个类。

**静态扫描每跑一次都会重新报出这批**（`packages/client/src/pages/**` 全量扫 `<button>` 即可复现），判据记在这里是为了不必每次重新评估一遍。
