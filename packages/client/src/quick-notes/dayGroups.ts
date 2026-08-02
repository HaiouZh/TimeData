import type { QuickNote } from "@timedata/shared";
import type { QuickNoteDisplayItem } from "../lib/quickNoteDisplay.js";

export interface QuickNoteDayGroupNote {
  key: string;
  note: QuickNote;
}

export interface QuickNoteDayGroup {
  /** React key；有日期条时复用日期项的 key，防御档（无日期条）时派生自首条速记。 */
  key: string;
  /** 这一天的日期条数据；防御档（速记出现在任何日期项之前）为 null，那一组不渲染日期条。 */
  date: { label: string; localDate: string } | null;
  notes: QuickNoteDayGroupNote[];
}

/**
 * 把 `groupQuickNotesForDisplay` 的扁平数组折成「每天一组」。
 *
 * 这不是排版偏好，是 `position: sticky` 的**语义前提**：sticky 的约束框是元素的父级内容盒，
 * 同一父级下的 sticky 兄弟互不推挤——拍平渲染时滚过去的每条日期条都会一直钉在 top 上、
 * 层层相叠，`findStuckDivider` 会把窗口里最早那天误判成「眼前这天」。每天各自成一个包裹
 * div 后，下一天的包裹上来时才会真的把上一天的日期条顶出视口（Telegram Web-A 的
 * `.message-date-group` / Web-K 的 `.bubbles-date-group` 同款）。
 *
 * 刻意不改 `groupQuickNotesForDisplay` 本身：它有独立测试与两个调用方，改它会外溢。
 */
export function groupDisplayItemsByDay(items: QuickNoteDisplayItem[]): QuickNoteDayGroup[] {
  const groups: QuickNoteDayGroup[] = [];
  let current: QuickNoteDayGroup | null = null;

  for (const item of items) {
    if (item.type === "date") {
      current = { key: item.key, date: { label: item.label, localDate: item.localDate }, notes: [] };
      groups.push(current);
      continue;
    }

    // 防御档：速记出现在任何日期项之前（`groupQuickNotesForDisplay` 不会产出这种序列，但这里
    // 不能把它吞掉——丢速记比少一条日期条严重得多）。开一个无日期条的组把它们照常渲染出来。
    if (!current) {
      current = { key: `orphan:${item.key}`, date: null, notes: [] };
      groups.push(current);
    }

    current.notes.push({ key: item.key, note: item.note });
  }

  return groups;
}
