import { Capacitor } from "@capacitor/core";
import type { PointerEvent } from "react";

/**
 * 指按即聚焦：Web 的默认聚焦发生在手指抬起（touchend → click 合成链）之后，比原生应用晚一拍——
 * 真机观感即「点输入框到键盘唤起有点卡」（Telegram 全原生按下即响应）。移动端 pointerdown 时
 * 直接 `focus()`，键盘提前一拍动身；`preventDefault` 掐掉后续的默认聚焦路径避免二次聚焦。
 *
 * 两个不拦：鼠标（桌面走原生，保留拖选起点语义）；已聚焦的元素（保留原生 caret 点位/拖选，
 * `preventDefault` 会把「点到字中间」变成「光标不动」）。
 */
export function focusOnPointerDown(event: PointerEvent<HTMLElement>): void {
  if (event.pointerType === "mouse") return;
  // iOS 不抢跑：pointerdown 里 preventDefault + focus() 会让 WKWebView 的 WebKit 把整条触摸序列判成
  // cancelled，touchend 的手势仲裁随即 resign firstResponder——键盘闪现即收回、无法唤出
  //（2026-08-22 真机一致复现；根因对抗验证见 .dispatch/20260822-ios-flash）。iOS 交还原生
  // touchend 聚焦路径，快聚焦只在安卓等平台生效。
  if (Capacitor.getPlatform() === "ios") return;
  const el = event.currentTarget;
  if (document.activeElement === el) return;
  event.preventDefault();
  el.focus();
}
