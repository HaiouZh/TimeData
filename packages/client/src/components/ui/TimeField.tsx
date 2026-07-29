import { useId, useState } from "react";
import { Clock, X } from "@phosphor-icons/react";
import { Icon } from "../Icon.js";
import Wheel from "../Wheel.js";
import { Sheet } from "./Sheet.js";

export interface TimeFieldProps {
  value: string | null;
  onChange: (value: string | null) => void;
  ariaLabel: string;
  minuteStep?: number;
  disabled?: boolean;
  placeholder?: string;
  clearable?: boolean;
  className?: string;
  portal?: boolean;
}

interface TimeParts {
  hour: string;
  minute: string;
}

const HOURS = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0"));
const DEFAULT_TIME: TimeParts = { hour: "00", minute: "00" };
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function buildMinuteOptions(step: number): string[] {
  const safeStep = Number.isInteger(step) && step > 0 && step <= 60 ? step : 1;
  const options: string[] = [];

  for (let minute = 0; minute < 60; minute += safeStep) {
    options.push(String(minute).padStart(2, "0"));
  }

  return options;
}

function splitTime(value: string | null): TimeParts {
  if (!value || !TIME_PATTERN.test(value)) return DEFAULT_TIME;
  const [hour, minute] = value.split(":");
  return { hour, minute };
}

export function TimeField({
  value,
  onChange,
  ariaLabel,
  minuteStep = 1,
  disabled = false,
  placeholder = "请选择时间",
  clearable = false,
  className,
  portal = false,
}: TimeFieldProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<TimeParts>(() => splitTime(value));
  const [draftTouched, setDraftTouched] = useState(false);
  const valueDescriptionId = useId();
  const minuteOptions = buildMinuteOptions(minuteStep);
  const displayValue = value ?? placeholder;
  const accessibleValue = value ? `当前时间 ${value}` : placeholder;

  function openSheet() {
    if (disabled) return;
    setDraft(splitTime(value));
    setDraftTouched(false);
    setOpen(true);
  }

  function confirmDraft() {
    if (value === null && !draftTouched) {
      setOpen(false);
      return;
    }
    onChange(`${draft.hour}:${draft.minute}`);
    setOpen(false);
  }

  function clearValue() {
    onChange(null);
    setOpen(false);
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
          <Icon icon={Clock} size={18} className="shrink-0" />
          <span className={`truncate ${value ? "td-time" : ""}`}>{displayValue}</span>
        </span>
        <span id={valueDescriptionId} className="sr-only">
          {accessibleValue}
        </span>
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title={ariaLabel} portal={portal}>
        <div className="space-y-4 px-4 pb-4">
          <div className="rounded-card bg-page px-3 py-2 text-center">
            <div className="td-text-label text-ink-3">当前选择</div>
            <div className="td-time td-text-title text-ink">
              {draft.hour}:{draft.minute}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="text-center td-text-label font-medium text-ink-2">小时</div>
              <Wheel
                ariaLabel="小时"
                value={draft.hour}
                options={HOURS}
                onChange={(hour) => {
                  setDraftTouched(true);
                  setDraft((current) => ({ ...current, hour }));
                }}
              />
            </div>
            <span className="td-time td-text-title text-ink-3">:</span>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="text-center td-text-label font-medium text-ink-2">分钟</div>
              <Wheel
                ariaLabel="分钟"
                value={draft.minute}
                options={minuteOptions}
                onChange={(minute) => {
                  setDraftTouched(true);
                  setDraft((current) => ({ ...current, minute }));
                }}
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            {clearable && value ? (
              <button
                type="button"
                aria-label="清除时间"
                onClick={clearValue}
                className="flex min-h-11 items-center gap-1.5 rounded-ctl border border-border px-3 td-text-label text-ink-2 hover:bg-surface-hover"
              >
                <Icon icon={X} size={16} />
                <span>清除</span>
              </button>
            ) : (
              <span aria-hidden="true" />
            )}
            <button
              type="button"
              aria-label="确认时间"
              onClick={confirmDraft}
              className="min-h-11 rounded-ctl bg-accent-strong px-4 td-text-label font-medium text-page"
            >
              确认
            </button>
          </div>
        </div>
      </Sheet>
    </>
  );
}

export default TimeField;
