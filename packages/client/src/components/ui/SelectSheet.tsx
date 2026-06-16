import { useState } from "react";
import { CaretDown, Check } from "@phosphor-icons/react";
import { Icon } from "../Icon.js";
import { Sheet } from "./Sheet.js";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

export interface SelectSheetProps<T extends string> {
  options: SelectOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  label: string;
  placeholder?: string;
  className?: string;
}

export function SelectSheet<T extends string>({
  options,
  value,
  onChange,
  label,
  placeholder = "请选择",
  className,
}: SelectSheetProps<T>) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen(true)}
        className={`flex min-h-11 w-full items-center justify-between rounded-row border border-border bg-surface-elevated px-3 text-sm ${className ?? ""}`}
      >
        <span className={current ? "text-ink" : "text-ink-3"}>{current ? current.label : placeholder}</span>
        <Icon icon={CaretDown} size={18} className="text-ink-3" />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={label}>
        {options.length === 0 ? (
          <div className="m-4 rounded-row border border-dashed border-border-hairline p-6 text-center text-sm text-ink-3">
            暂无选项
          </div>
        ) : (
          <ul className="divide-y divide-border-hairline overflow-y-auto pb-2">
            {options.map((o) => (
              <li key={o.value}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  className="flex min-h-11 w-full items-center justify-between px-4 text-sm text-ink hover:bg-surface-hover"
                >
                  <span>{o.label}</span>
                  {o.value === value && <Icon icon={Check} size={18} className="text-accent" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Sheet>
    </>
  );
}
