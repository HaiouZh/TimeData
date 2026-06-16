import { useEffect, useState } from "react";
import type { Recurrence } from "@timedata/shared";
import MonthCalendar from "../../components/MonthCalendar.js";
import { getDateString } from "../../lib/time.js";
import {
  buildPresetRows,
  presetToRecurrence,
  type PresetActionKey,
  type RecurrenceChoice,
  type RecurrencePresetKey,
} from "../../lib/tasks/recurrencePresets.js";

interface RecurrencePresetSheetProps {
  current: Recurrence | null;
  scheduledAt: string | null;
  anchor: string;
  onChoose: (choice: RecurrenceChoice) => void;
  onCustom: () => void;
  onClose: () => void;
}

const presetKeys = new Set<PresetActionKey>(["daily", "weekdays", "weekly", "monthly", "monthEnd"]);

function scheduledDateInput(scheduledAt: string | null, anchor: string): string {
  return scheduledAt ? getDateString(new Date(scheduledAt)) : anchor;
}

function ariaLabelFor(key: PresetActionKey, label: string): string {
  if (key === "scheduled") return "仅某天…";
  if (key === "custom") return "自定义…";
  return label;
}

export function RecurrencePresetSheet({
  current,
  scheduledAt,
  anchor,
  onChoose,
  onCustom,
  onClose,
}: RecurrencePresetSheetProps) {
  const [calendarOpen, setCalendarOpen] = useState(false);
  const rows = buildPresetRows(anchor, current, scheduledAt);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function chooseRow(key: PresetActionKey): void {
    if (key === "none") {
      onChoose({ kind: "none" });
      return;
    }
    if (key === "scheduled") {
      setCalendarOpen((open) => !open);
      return;
    }
    if (key === "custom") {
      onCustom();
      return;
    }
    if (presetKeys.has(key)) {
      onChoose({
        kind: "recurrence",
        recurrence: presetToRecurrence(key as RecurrencePresetKey, anchor),
        startAt: null,
      });
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="重复预设"
      className="fixed inset-0 z-[65] flex items-end justify-center bg-black/50"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl rounded-t-2xl border border-slate-800 bg-slate-900 text-slate-100 shadow-2xl">
        <div className="flex justify-center py-3">
          <span className="block h-1 w-10 rounded-full bg-slate-600" />
        </div>
        <div className="px-4 pb-4">
          <div className="pb-2 text-xs font-medium text-slate-500">重复与时间</div>
          <div className="divide-y divide-slate-800/80">
            {rows.map((row) => (
              <div key={row.key}>
                <button
                  type="button"
                  aria-label={ariaLabelFor(row.key, row.label)}
                  onClick={() => chooseRow(row.key)}
                  className="flex min-h-12 w-full items-center justify-between gap-3 text-left text-sm text-slate-100 transition-colors hover:bg-slate-800/70"
                >
                  <span>{row.label}</span>
                  <span className="text-xs text-sky-200">{row.key === "custom" ? "›" : row.checked ? "✓" : ""}</span>
                </button>
                {row.key === "scheduled" && calendarOpen && (
                  <div className="pb-3">
                    <MonthCalendar
                      value={scheduledDateInput(scheduledAt, anchor)}
                      onChange={(date) => onChoose({ kind: "scheduled", date })}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
