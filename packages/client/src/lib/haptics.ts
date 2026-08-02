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
  void Haptics.impact({ style }).catch(() => {});
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
