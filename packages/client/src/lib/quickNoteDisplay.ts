import type { QuickNote } from "@timedata/shared";
import { utcToLocalDateTime } from "@timedata/shared";
import { addDays, formatMonthDay, getDateString } from "./time.js";

export type QuickNoteDisplayItem =
  | { type: "date"; key: string; label: string; localDate: string }
  | { type: "note"; key: string; note: QuickNote };

export interface GroupQuickNotesOptions {
  /** 本地「今天」(YYYY-MM-DD)，用于生成今天/昨天标签；默认取当前本地日期。 */
  today?: string;
}

/** 把 YYYY-MM-DD 渲染成 今天/昨天/6月1日/2025年12月31日 这类人性化日期标签。 */
function formatDateLabel(noteDate: string, today: string): string {
  if (noteDate === today) return "今天";
  if (noteDate === addDays(today, -1)) return "昨天";
  if (noteDate.slice(0, 4) === today.slice(0, 4)) return formatMonthDay(noteDate);
  const [year, month, day] = noteDate.split("-");
  return `${Number(year)}年${Number(month)}月${Number(day)}日`;
}

function localDate(value: string): string {
  return utcToLocalDateTime(value).slice(0, 10);
}

/** UTC ISO -> 本地 "HH:mm"，供气泡时间小字使用。 */
export function formatLocalClock(occurredAt: string): string {
  return utcToLocalDateTime(occurredAt).slice(11, 16);
}

const ARIA_TEXT_MAX = 40;

/**
 * 气泡可访问名：短摘要（时间 + 前若干字，agent 带来源）而非整条正文。
 * 避免读屏把长笔记/Markdown 源码当一个不可分段的按钮名整段朗读。
 */
export function quickNoteAriaLabel(note: QuickNote): string {
  const time = formatLocalClock(note.occurredAt);
  const flattened = note.text.trim().replace(/\s+/g, " ");
  const summary = flattened.length > ARIA_TEXT_MAX ? `${flattened.slice(0, ARIA_TEXT_MAX)}…` : flattened;
  const who = note.source === "agent" ? `${note.sourceLabel ?? "助手"} · ` : "";
  return `速记 ${time}，${who}${summary}`;
}

export function groupQuickNotesForDisplay(
  notes: QuickNote[],
  options: GroupQuickNotesOptions = {},
): QuickNoteDisplayItem[] {
  const today = options.today ?? getDateString(new Date());
  const sorted = [...notes].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
  const items: QuickNoteDisplayItem[] = [];
  let previousDate: string | null = null;

  for (const note of sorted) {
    const noteDate = localDate(note.occurredAt);
    if (noteDate !== previousDate) {
      items.push({ type: "date", key: `date:${noteDate}`, label: formatDateLabel(noteDate, today), localDate: noteDate });
      previousDate = noteDate;
    }

    items.push({ type: "note", key: `note:${note.id}`, note });
  }

  return items;
}
