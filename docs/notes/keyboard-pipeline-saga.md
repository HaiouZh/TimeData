# 键盘管线修复战记（2026-08-22 ~ 08-23）

> 给下一个碰输入框的人（包括未来的自己）：先读完这页再动手。本页是流水与结论的汇总；
> 现行口径的权威在 `docs/evergreen/design-language/invariants.md` 第 12 条，
> 对抗验证与 TG 源码采掘的原始报告在 `.dispatch/20260822-{ios-flash,kbd-statemachine,tg-reference}/REPORT.md`。

## 一、已钉死的根因（5 个，全部有真机证据或穷举证明）

| # | 症状 | 根因 | 修复 commit |
|---|---|---|---|
| 1 | iOS 点输入框键盘闪现即收回 | fastFocus 在 pointerdown 里 `preventDefault()+focus()`，WKWebView 把触摸序列判成 cancelled、touchend 时 resign firstResponder | f9fd63b3（iOS 早退） |
| 2 | 唤起/收起卡顿、上蹿下跳 | focusin 预测抬升的「先按记忆值动一段、willShow 再校正」两段运动；输入条挂 backdrop-blur 做位移动画 | 75362684（删预测、实心底） |
| 3 | 收起悬空 / 概率性飞半空（多源竞态族） | 预测值 / visualViewport 实测 / 插件值三源互相校正 + 450ms 压制窗 + 跨次缩量记忆的组合竞态 | 75362684（native 单源化） |
| 4 | 输入框飞到屏幕中间、**tab 栏也上移**（删预测后必现） | **Chromium reveal-pan**：聚焦框将被键盘遮挡时引擎平移 visualViewport 露出它，所有 fixed 元素视觉整体上移一个键盘高。预测抬升此前一直在无意间掩盖它——聚焦瞬间输入框已被抬走、引擎无从介入；这是历年「概率性飞半空」的总根 | 7e89dd37（`interactive-widget=overlays-content` + offsetTop 几何扣除兜底） |
| 5 | 速记页比 ToDo 页多飞 49px | 速记页 navOffset 缺 ToDo 页的 `!keyboardVisible` 守卫，键盘在场首帧 nav 双计 | 75362684（补守卫） |

真机读数（2026-08-22，安卓）：`innerHeight` 恒 834（壳不动，overlay 成立）、旧版 vv 缩到 532（gap=302
与插件报的 302 同值）、focusin 到 willShow 相隔 213ms。这组读数杀掉了「壳在动 / 单位错配 /
缓存污染」三族假设，钉死了单源方向。

## 二、为什么速记页和 ToDo 页每次表现都不一致（2026-08-23 仍存的问题）

**发动机已经统一（useKeyboardHeight/Visible 单源 + `.td-kbd-motion`），但车身仍是两套手工装配**：

- 速记页：`composerFocused` state → `inputInteractionActive` → 聚焦瞬间就收底栏；composer 常驻挂载，
  只动 transform。
- ToDo 页：无 composerFocused，底栏收起靠 `navHiddenByKeyboardRef` effect **等 keyboardVisible
  （即 willShow）才动**；composer 还有 `hiddenByScroll`（滚动收起 translateY(100%)）与多选态
  条件卸载（TodoSelectionBar 顶替）两条额外状态线。

同一个键盘事件进来，两页的 state 提交序不同、附加状态线不同，时序表现就不同——**这不是还有
一个没找到的 bug，是同一套时序逻辑存在两份手工副本的结构性后果**。再打补丁只会继续「修这个、
另一个又出现」。

## 三、Telegram 是怎么做的（源码采掘结论，引用见 tg-reference 报告）

1. **全应用只有一个输入条实现**：Android = `ChatActivityEnterView`，iOS = `ChatInputPanelNode`，
   所有会话界面复用同一个组件——**TG 不存在「两个页面不一致」这个问题类别，因为没有第二份实现**。
2. **单一信源、不预测**：Android 等真实窗口 Resize（等不到就每 100ms 轮询 `showKeyboard` 重试）；
   iOS 只听 `keyboardWillChangeFrame`（willHide 观察者是空操作），收起 = 高度 0 分支走同一条管线。
   聚焦到键盘出现之间，输入条**原地不动**。
3. **动画与系统同参**：iOS 从通知的 userInfo 拿系统给的 duration/curve 原样animate（完美同步）；
   Android 90Hz+ 用 `WindowInsetsAnimation.onProgress` 逐帧跟 IME，低刷新率回退 250ms +
   DEFAULT_INTERPOLATOR（cubic-bezier(0.25,0.1,0.25,1)）。
4. kbd_height 缓存只用于表情面板估高，**从不驱动输入条位移**。

Web/Capacitor 与 TG 的差距（客观约束）：插件事件不带系统动画的 duration/curve（iOS 拿不到
userInfo，Android 的逐帧 onProgress 被插件 DISPATCH_MODE_STOP 拦死），所以只能用固定 250ms+
同参曲线近似——**方向上无法比 TG 更同步，除非改壳层自己发逐帧事件（候选后续项）**。

## 四、下一步（治本，不再打补丁）

**把「车身」也统一成一份**：抽共享的底部驻坞组件（работ名 `BottomDockBar`），一个组件负责
fixed 定位、安全区、`.td-kbd-motion` 抬升、navOffset 守卫、滚动收起协议；速记页与 ToDo 页只往里
放内容。此后修一处两页同好、测一页等于测两页——与 TG「只有一个输入条」同构。收起跟随的
剩余差距（IME 收起动画比 250ms ease 快半拍）在统一组件里配收起专用曲线一次调平。

## 五、过程教训（与 dispatch-incidents.md 互补）

- 「参考 TG」若只抄机制不抄**结构**（单一组件），机制修得再对也会在两份副本里各自腐坏。
- 预测/兜底类机制可能在无意间掩盖引擎行为；删它之前先问「它还顺带压着谁」。
- 真机读数浮层是唯一能在 WebView 里钉死「壳动没动 / 引擎平移没平移」的手段，比任何静态推理值钱。
