import { useEffect, useMemo } from "react";
import { getSetting, setSetting, useSettingLoad } from "./index.js";

export const NAV_VISIBLE_TABS_KEY = "nav.visibleTabs.v1";
// 顺序 = 底栏与设置页勾选列表的展示顺序，须与 navRegistry 的 MAIN_NAV_ITEMS 一致
// （/settings 不可隐藏，故不在此列）。漏一条 = 该模块在手机底栏与「导航」设置里彻底消失。
export const CONFIGURABLE_TABS = ["/quick-notes", "/diary", "/", "/todo", "/tracks", "/goals", "/stats/time"] as const;

export type ConfigurableTab = (typeof CONFIGURABLE_TABS)[number];

// 全量有序 + 每项显隐标记：排序与显隐解耦（关掉留在原位，重开回原位）。
// 旧数据是 string[]（仅可见项），读时自动迁移：缺失项按规范位补入并标 hidden。
export interface NavTabConfig {
  to: ConfigurableTab;
  hidden: boolean;
}

function normalizeTab(value: string): ConfigurableTab | null {
  if (value === "/stats") return "/stats/time";
  return (CONFIGURABLE_TABS as readonly string[]).includes(value) ? (value as ConfigurableTab) : null;
}

function defaultTabOrder(): NavTabConfig[] {
  return CONFIGURABLE_TABS.map((to) => ({ to, hidden: false }));
}

/**
 * 兼容两种输入：
 * - 新格式 `{to, hidden}[]`：全量有序，保序、去重；
 * - 旧格式 `string[]`：仅可见项（hidden: false）。
 * 两者都缺项补齐：按 CONFIGURABLE_TABS 规范位插入、标 hidden: true（旧数据被隐藏的 tab / 残缺数据）。
 * 空数组 = 全部隐藏（旧语义保留）；非数组 / 坏值 = 全量默认可见。
 */
export function sanitizeTabOrder(values: unknown): NavTabConfig[] {
  if (!Array.isArray(values)) return defaultTabOrder();

  const seen = new Set<ConfigurableTab>();
  const result: NavTabConfig[] = [];
  for (const value of values) {
    if (typeof value === "string") {
      const normalized = normalizeTab(value);
      if (normalized && !seen.has(normalized)) {
        seen.add(normalized);
        result.push({ to: normalized, hidden: false });
      }
    } else if (value && typeof value === "object") {
      const normalized = normalizeTab((value as { to?: unknown }).to as string);
      if (normalized && !seen.has(normalized)) {
        seen.add(normalized);
        result.push({ to: normalized, hidden: (value as { hidden?: unknown }).hidden === true });
      }
    }
  }

  // 缺失项按规范位补入（插在第一个规范位更大的已存在项之前），用户相对顺序不动。
  for (const tab of CONFIGURABLE_TABS) {
    if (seen.has(tab)) continue;
    const canonicalIndex = CONFIGURABLE_TABS.indexOf(tab);
    const insertAt = result.findIndex((item) => CONFIGURABLE_TABS.indexOf(item.to) > canonicalIndex);
    const entry = { to: tab, hidden: true };
    if (insertAt === -1) result.push(entry);
    else result.splice(insertAt, 0, entry);
  }
  return result;
}

function parseTabOrder(raw: string | null): NavTabConfig[] {
  if (!raw) return defaultTabOrder();
  try {
    return sanitizeTabOrder(JSON.parse(raw));
  } catch {
    return defaultTabOrder();
  }
}

export async function readTabOrder(): Promise<NavTabConfig[]> {
  return parseTabOrder(await getSetting(NAV_VISIBLE_TABS_KEY));
}

export function setTabOrder(tabs: readonly NavTabConfig[]): Promise<void> {
  return setSetting(NAV_VISIBLE_TABS_KEY, JSON.stringify(sanitizeTabOrder([...tabs])));
}

/**
 * 三态到顺序的纯映射。`undefined`（liveQuery 还没回流）必须落到上次已知值，**不能**跟 `null`
 * 一样落到全量默认——那正是底栏闪出已隐藏 tab 的成因，见 {@link useNavBarTabOrder}。
 */
export function resolveTabOrder(raw: string | null | undefined, lastKnown: NavTabConfig[] | null): NavTabConfig[] {
  if (raw === undefined) return lastKnown ?? defaultTabOrder();
  return parseTabOrder(raw);
}

/**
 * 上一次**真正读到**的 tab 顺序（进程内）。
 *
 * 底栏渲染在 iOS 保留路由栈的**每一层内部**（见 `KeptRouteStack`），切 tab 会新挂载一层、
 * 也就新挂载一份底栏。那一份的 liveQuery 首帧必然还没回流，而未回流的回退是全量可见——
 * 于是新底栏先闪出用户已隐藏的 tab，回流后才收回去。安卓只有一份常驻底栏、从不重挂，
 * 所以没这个症状。拿上次已知值当首帧值即可消掉这一帧。
 *
 * 边界一：库里的值被外部清空（重置数据 / 恢复备份）后本缓存仍是旧值，直到下一次回流纠正——
 * 那些路径都会重载页面，故不额外处理。
 * 边界二：**测试里清了 db 就要一并 {@link resetTabOrderCache}**，否则上个用例的配置会在下个
 * 用例的首帧复活（曾令 SettingsNavPage 的开关测试因初始态反了而超时）。
 */
let lastKnownOrder: NavTabConfig[] | null = null;

/** 清掉进程内缓存。测试在清 db 时必须一并调用，见 {@link lastKnownOrder} 的边界二。 */
export function resetTabOrderCache(): void {
  lastKnownOrder = null;
}

export function useTabOrder(): NavTabConfig[] {
  const raw = useSettingLoad(NAV_VISIBLE_TABS_KEY);
  const order = useMemo(() => resolveTabOrder(raw, lastKnownOrder), [raw]);
  useEffect(() => {
    if (raw !== undefined) lastKnownOrder = order;
  }, [raw, order]);
  return order;
}

// —— 派生便捷 API：语义与旧版一致（底栏 / 更多页消费）——

export async function readVisibleTabs(): Promise<ConfigurableTab[]> {
  return (await readTabOrder())
    .filter((item) => !item.hidden)
    .map((item) => item.to);
}

export function useVisibleTabs(): ConfigurableTab[] {
  const order = useTabOrder();
  return useMemo(() => order.filter((item) => !item.hidden).map((item) => item.to), [order]);
}