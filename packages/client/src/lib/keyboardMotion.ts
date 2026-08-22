import { Capacitor } from "@capacitor/core";
import { type RefObject, useEffect } from "react";

// 与底部固定条的 transition-transform duration-200 ease-out 对齐：抬升过渡与跳变补偿同曲线同时长，
// 两种运动叠加/衔接时不出现速度断层。
export const KEYBOARD_MOTION_DURATION_MS = 200;
export const KEYBOARD_MOTION_EASING = "ease-out";
// 键盘量级门槛，与 useKeyboardHeight 的 KEYBOARD_BOTTOM_GAP_THRESHOLD_PX 同源同值：
// 地址栏收合等小抖动不值得补偿动画。
const JUMP_THRESHOLD_PX = 80;

/**
 * 壳缩/恢复 webview（安卓 adjustResize + ime inset）是**单帧跳变**：bottom 锚定的固定条会瞬移一个
 * 键盘高——真机观感即「先向上动、等键盘就位再画出来」。本 hook 把跳变抹成滑动（Telegram Android
 * 用 ValueAnimator 平移 parent 的 Web 等价物）：innerHeight 每变化一个键盘量级，就给元素叠一段
 * 「从跳变量滑回 0」的**附加**动画——首帧视觉位置不变，随后 200ms 滑到新位置。
 *
 * - `composite: "add"`：基础 transform（键盘抬升 / 滚动隐藏）另有其主，覆盖式动画会打断它们；
 *   附加合成叠在其上，互不干扰。目标平台唯一会走到这里的是安卓 WebView（Chromium，支持 add）；
 *   iOS resize:none 下 innerHeight 恒定、本 hook 天然不触发。
 * - 平台闸：web（桌面拖窗 / 移动浏览器地址栏）不补偿——桌面改窗口大小不该看到内容滑动。
 * - 旋转屏也会触发一次补偿滑动：旋转本身是全屏重排，200ms 的附加位移淹没在其中，不另设防。
 * - `el.animate` 缺席（旧 WebView / jsdom）时静默跳过，元素仍瞬移——行为退回本 hook 之前。
 */
export function useShellResizeGlide(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (Capacitor.getPlatform() === "web") return;
    let prevInnerHeight = window.innerHeight;
    const onResize = () => {
      const delta = prevInnerHeight - window.innerHeight;
      prevInnerHeight = window.innerHeight;
      if (Math.abs(delta) < JUMP_THRESHOLD_PX) return;
      const el = ref.current;
      if (!el || typeof el.animate !== "function") return;
      el.animate(
        [{ transform: `translateY(${delta}px)` }, { transform: "translateY(0px)" }],
        { duration: KEYBOARD_MOTION_DURATION_MS, easing: KEYBOARD_MOTION_EASING, composite: "add" },
      );
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, [ref]);
}
