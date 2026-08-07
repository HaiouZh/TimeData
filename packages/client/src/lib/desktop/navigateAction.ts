import { isMainNavRoute } from "../navigation/navRegistry.js";
import type { DesktopHotkeyEvent } from "./api.js";

/**
 * navigate 热键该跳到哪，`null` = 不跳。
 *
 * **页面清单只在前端这一处**：Rust 侧把 target 当不透明字符串透传，只保证它非空。
 * 好处是不产生第二个跨语言重复点、不欠第二道闸；代价是无效 target 会一路注册成功
 * 到这里才被丢弃——那条路径上有回显（设置页红字），不是静默。
 *
 * **`currentPath` 必须是裸 pathname**（不带 query / hash）——同页判据是逐字相等。
 * 调用方传 `location.pathname + location.search` 会让 `/?date=…` 上的「跳时间轴」
 * 判成不同页，往 history 压一条重复条目。
 */
export function resolveNavigateTarget(event: DesktopHotkeyEvent, currentPath: string): string | null {
  if (event.action !== "navigate") return null;
  const target = event.target;
  if (!target || !isMainNavRoute(target)) return null;
  if (target === currentPath) return null;
  return target;
}
