import type { QuickNote } from "@timedata/shared";
import { utcToLocalDateTime } from "@timedata/shared";
import { addDays, formatMonthDay, getDateString } from "./time.js";

export type QuickNoteDisplayItem =
  | { type: "date"; key: string; label: string }
  | { type: "time"; key: string; label: string }
  | { type: "note"; key: string; note: QuickNote };

export interface GroupQuickNotesOptions {
  gapMinutes?: number;
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

function localMinute(value: string): string {
  return utcToLocalDateTime(value).slice(0, 16);
}

function localDate(value: string): string {
  return utcToLocalDateTime(value).slice(0, 10);
}

function localClock(value: string): string {
  return utcToLocalDateTime(value).slice(11, 16);
}

export function groupQuickNotesForDisplay(
  notes: QuickNote[],
  options: GroupQuickNotesOptions = {},
): QuickNoteDisplayItem[] {
  const gapMs = (options.gapMinutes ?? 5) * 60 * 1000;
  const today = options.today ?? getDateString(new Date());
  const sorted = [...notes].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
  const items: QuickNoteDisplayItem[] = [];
  let previousNote: QuickNote | null = null;
  let previousDate: string | null = null;
  let previousMinute: string | null = null;

  for (const note of sorted) {
    const noteDate = localDate(note.occurredAt);
    const noteMinute = localMinute(note.occurredAt);
    const isNewDate = noteDate !== previousDate;

    if (isNewDate) {
      items.push({ type: "date", key: `date:${noteDate}`, label: formatDateLabel(noteDate, today) });
      previousDate = noteDate;
      previousMinute = null;
    }

    const gapFromPrevious = previousNote ? Date.parse(note.occurredAt) - Date.parse(previousNote.occurredAt) : 0;
    if (!previousNote || isNewDate || (noteMinute !== previousMinute && gapFromPrevious > gapMs)) {
      items.push({ type: "time", key: `time:${note.id}`, label: localClock(note.occurredAt) });
    }

    items.push({ type: "note", key: `note:${note.id}`, note });
    previousNote = note;
    previousMinute = noteMinute;
  }

  return items;
}
