import { CalendarBlank, X } from "@phosphor-icons/react";
import { useId, useState, type ReactNode } from "react";
import { Icon } from "../Icon.js";
import { MonthCalendar } from "./MonthCalendar.js";
import { Sheet } from "./Sheet.js";

export interface DateFieldProps {
  value: string | null;
  onChange: (value: string | null) => void;
  ariaLabel: string;
  min?: string;
  max?: string;
  disabled?: boolean;
  placeholder?: string;
  clearable?: boolean;
  className?: string;
  formatValue?: (value: string) => ReactNode;
  onOpenChange?: (open: boolean) => void;
  portal?: boolean;
}

export function DateField({
  value,
  onChange,
  ariaLabel,
  min,
  max,
  disabled = false,
  placeholder = "选择日期",
  clearable = false,
  className,
  formatValue,
  onOpenChange,
  portal = false,
}: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const valueDescriptionId = useId();
  const displayValue = value ? (formatValue ? formatValue(value) : value) : placeholder;
  const accessibleValue = value ? `当前日期 ${value}` : placeholder;

  function setOpenState(next: boolean) {
    setOpen(next);
    onOpenChange?.(next);
  }

  function openSheet() {
    if (disabled) return;
    setOpenState(true);
  }

  function closeWith(next: string | null) {
    if (next === value) {
      setOpenState(false);
      return;
    }
    onChange(next);
    setOpenState(false);
  }

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        aria-describedby={valueDescriptionId}
        disabled={disabled}
        onClick={openSheet}
        className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-row border border-border bg-surface-elevated px-3 td-text-body transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50 ${className ?? ""}`}
      >
        <span className={`flex min-w-0 items-center gap-2 ${value ? "text-ink" : "text-ink-3"}`}>
          <Icon icon={CalendarBlank} size={18} className="shrink-0" />
          <span className={`truncate ${value ? "td-time" : ""}`}>{displayValue}</span>
        </span>
        <span id={valueDescriptionId} className="sr-only">
          {accessibleValue}
        </span>
      </button>

      <Sheet open={open} onClose={() => setOpenState(false)} title={ariaLabel} portal={portal}>
        <div className="space-y-3 px-4 pb-4">
          <MonthCalendar
            value={value}
            min={min}
            max={max}
            ariaLabel={ariaLabel}
            onChange={(next) => closeWith(next)}
          />

          {clearable && value !== null && (
            <button
              type="button"
              aria-label="清除日期"
              onClick={() => closeWith(null)}
              className="flex min-h-11 items-center gap-1.5 rounded-ctl border border-border px-3 td-text-label text-ink-2 hover:bg-surface-hover"
            >
              <Icon icon={X} size={16} />
              <span>清除</span>
            </button>
          )}
        </div>
      </Sheet>
    </>
  );
}

export default DateField;
