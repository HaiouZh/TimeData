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
  const el = event.currentTarget;
  if (document.activeElement === el) return;
  event.preventDefault();
  el.focus();
}
