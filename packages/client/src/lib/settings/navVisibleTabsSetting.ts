import { useMemo } from "react";
import { getSetting, setSetting, useSetting } from "./index.js";

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

export function useTabOrder(): NavTabConfig[] {
  const raw = useSetting(NAV_VISIBLE_TABS_KEY);
  return useMemo(() => parseTabOrder(raw), [raw]);
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