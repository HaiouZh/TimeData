import { Capacitor } from "@capacitor/core";
import { Keyboard, type KeyboardInfo } from "@capacitor/keyboard";
import { useEffect, useState } from "react";

// 地址栏收合等无关抖动也会让 visualViewport 与 innerHeight 出现小差值；只有差值超过这个阈值
// 才当作键盘遮挡，避免误报。
const KEYBOARD_BOTTOM_GAP_THRESHOLD_PX = 80;

function readInnerHeight(): number {
  return typeof window === "undefined" ? 0 : window.innerHeight;
}

/**
 * 实测「布局视口底部被遮住多少」——正是 `position: fixed; bottom: 0` 的元素要额外抬起的量。
 * 壳无论用哪种方式让位（缩 webview / 整体上移视口 / 什么都不做），这个差值都如实反映剩余遮挡。
 */
function readViewportBottomGap(): number {
  if (typeof window === "undefined") return 0;
  const viewport = window.visualViewport;
  const innerHeight = readInnerHeight();
  if (!viewport || innerHeight <= 0) return 0;

  const bottomGap = innerHeight - viewport.height - viewport.offsetTop;
  return bottomGap > KEYBOARD_BOTTOM_GAP_THRESHOLD_PX ? bottomGap : 0;
}

/**
 * 键盘挡住页面底部多少（px）——**不是**键盘自身的高度，而是「JS 还需要额外让开多少」。
 * 键盘收起、或壳已经自己让过位时都是 0。
 *
 * 为什么不能直接用插件报的键盘高度：`@capacitor/keyboard` 的 `resize` 配置**只有 iOS 读**
 *（Android 端 `KeyboardPlugin.java` 只读 `resizeOnFullScreen`，`setResizeMode` 是 unimplemented），
 * 而 iOS 侧 `resize: none` 也只拦住插件自己 resize，拦不住 WebKit 因聚焦输入框而挪视口。
 * 也就是说「壳不会自己让位」这个前提在两个平台上都没人保证：壳一旦让过位，JS 再加一个
 * 键盘高就是双倍避让，输入条会冲到屏幕上半部分（安卓表现为飞到顶上，iOS 表现为钻进顶栏底下看不见）。
 *
 * 故口径改成实测优先、插件兜底：
 * 1. `visualViewport` 实测到底部仍被遮 → 用实测值。这一条自动涵盖「壳缩了 webview」（实测为 0）
 *    与「壳挪了视口」（实测已扣掉挪动量）两种让位方式，不需要事先知道壳会怎么做。
 * 2. 实测报不出遮挡（iOS `resize: none` 下 WebKit 可能既不缩视口也不更新 visualViewport）→
 *    回落到插件高度，再减去壳实际缩掉的高度（`innerHeight` 相对键盘收起时的基线）。
 *
 * web / PWA 没有插件桥接，插件高度恒 0，结果等于第 1 条的纯实测值——与本次改动前的 web 路径一字不差。
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // 键盘收起时的 innerHeight。壳缩 webview 时 innerHeight 会变小，差值就是壳已经让掉的量。
    let baselineInnerHeight = readInnerHeight();
    let rawKeyboardPx = 0;
    // 上一次实测到的壳缩量。壳的 reflow 晚于 keyboardWillShow，首帧无从判断；记住上次的结果，
    // 下次弹起就能立刻按同样的量预扣，避免「先冲高再落回」的抖动（首次弹起仍会收敛一次）。
    let lastShellShrinkPx = 0;

    const recompute = () => {
      // 实测**先于**「插件说键盘收起了」判断：web / PWA 没有插件桥接，rawKeyboardPx 恒 0，
      // 先判收起会把整条实测路径短路成 0（回归护栏用例「visualViewport 差值超过阈值出正值」守这里）。
      const measuredGap = readViewportBottomGap();
      if (measuredGap > 0) {
        setHeight(measuredGap);
        return;
      }

      if (rawKeyboardPx <= 0) {
        // 键盘收起且实测无遮挡：此刻 innerHeight 就是没有键盘时的真实值，顺手刷新基线
        //（壳缩过 webview 的话，它恢复全高时会再触发一次 resize，基线随之回到全高）。
        baselineInnerHeight = readInnerHeight();
        setHeight(0);
        return;
      }

      const shellShrinkPx = Math.max(0, baselineInnerHeight - readInnerHeight());
      if (shellShrinkPx > 0) lastShellShrinkPx = shellShrinkPx;
      setHeight(Math.max(0, rawKeyboardPx - (shellShrinkPx > 0 ? shellShrinkPx : lastShellShrinkPx)));
    };

    const viewport = window.visualViewport;
    const handleViewportChange = () => recompute();
    window.addEventListener("resize", handleViewportChange);
    viewport?.addEventListener("resize", handleViewportChange);
    viewport?.addEventListener("scroll", handleViewportChange);

    let removeNative = () => {};
    if (Capacitor.getPlatform() !== "web") {
      try {
        const showListener = Keyboard.addListener("keyboardWillShow", (info: KeyboardInfo) => {
          rawKeyboardPx = Number.isFinite(info.keyboardHeight) ? info.keyboardHeight : 0;
          recompute();
        });
        const hideListener = Keyboard.addListener("keyboardWillHide", () => {
          rawKeyboardPx = 0;
          recompute();
        });
        removeNative = () => {
          void showListener.then((handle) => handle.remove()).catch(() => {});
          void hideListener.then((handle) => handle.remove()).catch(() => {});
        };
      } catch {
        // 插件缺席（未装 / 未同步）时只剩实测路径，仍好过整条 effect 挂掉。
      }
    }

    recompute();

    return () => {
      window.removeEventListener("resize", handleViewportChange);
      viewport?.removeEventListener("resize", handleViewportChange);
      viewport?.removeEventListener("scroll", handleViewportChange);
      removeNative();
    };
  }, []);

  return height;
}
