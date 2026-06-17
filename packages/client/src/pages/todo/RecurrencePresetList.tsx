import { CaretRight, Check } from "@phosphor-icons/react";
import type { Recurrence } from "@timedata/shared";
import { useState } from "react";
import { Icon } from "../../components/Icon.js";
import MonthCalendar from "../../components/MonthCalendar.js";
import {
  buildPresetRows,
  type PresetActionKey,
  presetToRecurrence,
  type RecurrenceChoice,
  type RecurrencePresetKey,
} from "../../lib/tasks/recurrencePresets.js";
import { getDateString } from "../../lib/time.js";

interface RecurrencePresetListProps {
  current: Recurrence | null;
  scheduledAt: string | null;
  anchor: string;
  onChoose: (choice: RecurrenceChoice) => void;
  onCustom: () => void;
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

export function RecurrencePresetList({ current, scheduledAt, anchor, onChoose, onCustom }: RecurrencePresetListProps) {
  const [calendarOpen, setCalendarOpen] = useState(false);
  const rows = buildPresetRows(anchor, current, scheduledAt);

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
    <div className="px-2 pb-2">
      <div className="divide-y divide-border-hairline">
        {rows.map((row) => (
          <div key={row.key}>
            <button
              type="button"
              aria-label={ariaLabelFor(row.key, row.label)}
              onClick={() => chooseRow(row.key)}
              className="flex min-h-11 w-full items-center justify-between gap-3 px-2 text-left text-sm text-ink transition-colors hover:bg-surface-hover"
            >
              <span>{row.label}</span>
              {row.key === "custom" ? (
                <Icon icon={CaretRight} size={16} className="text-ink-3" />
              ) : row.checked ? (
                <Icon icon={Check} size={18} className="text-accent" />
              ) : null}
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
  );
}
