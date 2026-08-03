import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle } from "@capacitor/haptics";

/**
 * 触感语义层：调用方只声明「发生了什么」，强度映射只写在本文件——
 * 日后要整体调轻重或加全局开关，改这一处即可。
 *
 * Web / PWA / 桌面没有原生触感能力，整层空转。刻意不回退到 navigator.vibrate：
 * 桌面无意义，安卓浏览器里那种"整机震"与原生轻触感手感完全不同，比不震更糟。
 */
function impact(style: ImpactStyle): void {
  if (!Capacitor.isNativePlatform()) return;
  // 触感是纯锦上添花：插件缺失 / 系统关闭 / 硬件不支持都不该让业务动作炸掉。
  // 要防的是**两种**炸法，只挂 .catch 只挡得住第一种：
  // ① 返回的 promise reject（系统关了触感、硬件不支持）；
  // ② impact 同步抛，或返回个非 thenable（插件未注册、旧桥 / shim 返回 undefined）——
  //    这时 `.catch` 本身就是同步 TypeError，直接炸在调用点：hapticGrab 是在 dnd-kit 的
  //    同步 onDragStart 里调的，抛出去整个拖拽都起不来；hapticToggle 抛则勾选没反应。
  // 故：先探 thenable 再挂拒绝兜底，外层再包一层 try 兜住同步抛。
  try {
    const result = Haptics.impact({ style }) as unknown;
    // 只有确实是 thenable 才挂兜底：直接 `.catch` 挂在返回值上，遇到非 thenable 就是**同步 TypeError**。
    if (typeof (result as PromiseLike<void> | undefined)?.then === "function") {
      void (result as PromiseLike<void>).then(undefined, () => {});
    }
  } catch {
    // impact 自己同步抛（插件未实现）：同上，整层空转好过炸掉业务动作。
  }
}

/** 勾选 / 取消勾选待办。高频动作，用最轻一档。 */
export function hapticToggle(): void {
  impact(ImpactStyle.Light);
}

/** 删除、清空。重一档，相当于「真的删了」的确认。 */
export function hapticDestructive(): void {
  impact(ImpactStyle.Medium);
}

/** 拖拽拿起。 */
export function hapticGrab(): void {
  impact(ImpactStyle.Light);
}

/** 拖拽吸附落位（取消落位不调）。 */
export function hapticDrop(): void {
  impact(ImpactStyle.Light);
}
