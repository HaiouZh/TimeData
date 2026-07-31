import { arrayMove } from "@dnd-kit/sortable";
import { CONFIGURABLE_TABS, type ConfigurableTab } from "./settings/navVisibleTabsSetting.js";

export function reorderById<T>(
  items: readonly T[],
  activeId: string,
  overId: string,
  idOf: (item: T) => string,
): T[] {
  const oldIndex = items.findIndex((item) => idOf(item) === activeId);
  const newIndex = items.findIndex((item) => idOf(item) === overId);
  if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return [...items];
  return arrayMove(items, oldIndex, newIndex);
}

export function reorderTabs(
  tabs: readonly ConfigurableTab[],
  activeId: string,
  overId: string,
): ConfigurableTab[] {
  return reorderById(tabs, activeId, overId, (tab) => tab);
}

/** 把 tab 按 CONFIGURABLE_TABS 的规范位置插回可见列表，保持列表顺序稳定。 */
export function insertTabAtCanonicalPosition(
  visible: readonly ConfigurableTab[],
  tab: ConfigurableTab,
): ConfigurableTab[] {
  if (visible.includes(tab)) return [...visible];
  const canonicalIndex = CONFIGURABLE_TABS.indexOf(tab);
  const insertAt = visible.findIndex((item) => CONFIGURABLE_TABS.indexOf(item) > canonicalIndex);
  const next = [...visible];
  if (insertAt === -1) next.push(tab);
  else next.splice(insertAt, 0, tab);
  return next;
}