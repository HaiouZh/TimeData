import { CalendarBlank, X } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
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
  /** 紧凑场景（如速记日期气泡）不渲染日历图标，只留文字。 */
  hideIcon?: boolean;
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
  hideIcon = false,
}: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const valueDescriptionId = useId();
  // 卸载补发 onOpenChange(false)：这个字段可能挂在会随数据变动重建的列表行上（速记页每条
  // 日期分隔条各一个）。用户开着月历时那一天的速记被另一台设备删光 → 整行连同本组件一起卸载
  // → onOpenChange(false) 永不触发 → 调用方的「日历开着」单闩永久停在 true，成了静默锁死
  // 整套机制的暗开关（速记页表现为日期条再不淡出、导出/清理永远打在冻结那天上，只能刷新恢复）。
  // 已卸载的字段其弹层必然也没了，补发对所有调用方都是正确语义。
  // 经 ref 读最新的 open/onOpenChange：cleanup 只在卸载时跑一次，闭包直接读会冻结首渲染的值。
  const openRef = useRef(open);
  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => {
    openRef.current = open;
    onOpenChangeRef.current = onOpenChange;
  });
  useEffect(
    () => () => {
      if (openRef.current) onOpenChangeRef.current?.(false);
    },
    [],
  );
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
          {!hideIcon && <Icon icon={CalendarBlank} size={18} className="shrink-0" />}
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
