/**
 * 在途懒加载登记（ios-instant-open 阶段1 design §2.4）。
 *
 * client 里能让渲染挂起的只有 `AppRoutes.tsx` 的路由 `React.lazy`。一个 chunk 的 import 在 iOS 挂起期间被掐断而永不
 * settle，会让它所在的 transition 永远挂起、并把之后所有 transition 一起拖住（design §0.2 第 1 条）。
 * 看门狗判定卡死时读这张表，直接点名是哪个页面在等。
 */

interface InFlightLoad {
  name: string;
  startedAt: number;
}

const inFlight = new Set<InFlightLoad>();

export const LAZY_SNAPSHOT_MAX = 3;

function defaultNow(): number {
  return performance.now();
}

/** 包一层 lazy 的 factory：调用时登记，settle（含 reject、同步抛错）时出册。对 `React.lazy` 语义零改动。 */
export function trackLazyLoad<T>(name: string, factory: () => Promise<T>, now: () => number = defaultNow): () => Promise<T> {
  return () => {
    const entry: InFlightLoad = { name, startedAt: now() };
    inFlight.add(entry);
    let promise: Promise<T>;
    try {
      promise = factory();
    } catch (error) {
      inFlight.delete(entry);
      throw error;
    }
    return promise.then(
      (value) => {
        inFlight.delete(entry);
        return value;
      },
      (error: unknown) => {
        inFlight.delete(entry);
        throw error;
      },
    );
  };
}

/** 在途条目按等待时长倒序，取前 {@link LAZY_SNAPSHOT_MAX} 条：`[页面名, 已等毫秒]`。 */
export function snapshotInFlightLazy(now: () => number = defaultNow): [string, number][] {
  const at = now();
  return [...inFlight]
    .map((entry): [string, number] => [entry.name, Math.max(0, Math.round(at - entry.startedAt))])
    .sort((a, b) => b[1] - a[1])
    .slice(0, LAZY_SNAPSHOT_MAX);
}

/** 仅供测试。 */
export function resetLazyRegistry(): void {
  inFlight.clear();
}
