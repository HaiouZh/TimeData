/**
 * React 根状态快照：看门狗判定卡死时读一眼 FiberRoot，分辨「调度器没被叫醒」与「transition 挂起毒化整批」
 * （ios-instant-open 阶段1 design §0.2 / §2.3）。
 *
 * 从 createRoot 的容器元素上找 `__reactContainer$<随机>` 属性拿 HostRoot fiber，其 `stateNode` 即 FiberRoot。
 * **不装 DevTools 全局钩子**：那会让每次提交多一次回调，还会和桌面浏览器的 DevTools 扩展抢钩子。
 * 读的全是内部字段，由测试里的 production 形态闸钉住；任何一步取不到都返回 null，绝不抛。
 */

/** React 19 的 transition lane 掩码：`getHighestPriorityLanes` 对任一 transition lane 返回 `lanes & 261888`。报告脚本有同名常量。 */
export const TRANSITION_LANES_MASK = 261888;

export interface ReactRootSnapshot {
  /** pendingLanes */
  p: number;
  /** suspendedLanes */
  s: number;
  /** pingedLanes */
  pg: number;
  /** callbackNode !== null：根上有排着的调度任务 */
  cb: boolean;
  /** cancelPendingCommit !== null：提交在等资源（样式表等） */
  cpc: boolean;
}

interface FiberRootLike {
  pendingLanes?: unknown;
  suspendedLanes?: unknown;
  pingedLanes?: unknown;
  callbackNode?: unknown;
  cancelPendingCommit?: unknown;
}

function defaultContainer(): Element | null {
  return typeof document === "undefined" ? null : document.getElementById("root");
}

export function snapshotReactRoot(container: Element | null = defaultContainer()): ReactRootSnapshot | null {
  try {
    if (!container) return null;
    const key = Object.keys(container).find((name) => name.startsWith("__reactContainer$"));
    if (!key) return null;
    const fiber = (container as unknown as Record<string, { stateNode?: FiberRootLike } | undefined>)[key];
    const root = fiber?.stateNode;
    if (!root) return null;
    const { pendingLanes, suspendedLanes, pingedLanes } = root;
    if (typeof pendingLanes !== "number" || typeof suspendedLanes !== "number" || typeof pingedLanes !== "number") {
      return null;
    }
    return {
      p: pendingLanes,
      s: suspendedLanes,
      pg: pingedLanes,
      cb: root.callbackNode != null,
      cpc: root.cancelPendingCommit != null,
    };
  } catch {
    return null;
  }
}
