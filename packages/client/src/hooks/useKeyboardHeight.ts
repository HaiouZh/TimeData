import { Capacitor } from "@capacitor/core";
import { Keyboard, type KeyboardInfo } from "@capacitor/keyboard";
import { useEffect, useState } from "react";

// 地址栏收合等无关抖动也会让 visualViewport 与 innerHeight 出现小差值；只有差值超过这个阈值
// 才当作键盘弹起，避免误报。仅 web 兜底路径使用——native 路径读插件给的真实 keyboardHeight。
const KEYBOARD_BOTTOM_GAP_THRESHOLD_PX = 80;

function readWebKeyboardHeight(): number {
  if (typeof window === "undefined") return 0;
  const viewport = window.visualViewport;
  if (!viewport || window.innerHeight <= 0) return 0;

  const bottomGap = window.innerHeight - viewport.height - viewport.offsetTop;
  return bottomGap > KEYBOARD_BOTTOM_GAP_THRESHOLD_PX ? bottomGap : 0;
}

/**
 * 软键盘高度单一来源：Capacitor native（iOS/Android 壳）走 @capacitor/keyboard 的真实事件，
 * PWA/桌面浏览器没有该插件桥接，降级到 visualViewport 差值估算。收起统一为 0。
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (Capacitor.getPlatform() !== "web") {
      try {
        const showListener = Keyboard.addListener("keyboardWillShow", (info: KeyboardInfo) => {
          setHeight(Number.isFinite(info.keyboardHeight) ? info.keyboardHeight : 0);
        });
        const hideListener = Keyboard.addListener("keyboardWillHide", () => {
          setHeight(0);
        });

        return () => {
          void showListener.then((handle) => handle.remove()).catch(() => {});
          void hideListener.then((handle) => handle.remove()).catch(() => {});
        };
      } catch {
        return undefined;
      }
    }

    const viewport = typeof window === "undefined" ? undefined : window.visualViewport;
    if (!viewport) return;

    const handleViewportChange = () => setHeight(readWebKeyboardHeight());
    handleViewportChange();
    viewport.addEventListener("resize", handleViewportChange);
    viewport.addEventListener("scroll", handleViewportChange);

    return () => {
      viewport.removeEventListener("resize", handleViewportChange);
      viewport.removeEventListener("scroll", handleViewportChange);
    };
  }, []);

  return height;
}
