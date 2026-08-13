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
  /** 出错红字的目标控件 id（供 aria-describedby 引用），仅在出错时由调用方传入。 */
  ariaDescribedby?: string;
  /** 出错时标 true，读屏据此宣告当前选择无效。 */
  ariaInvalid?: boolean;
}

export function SelectSheet<T extends string>({
  options,
  value,
  onChange,
  label,
  placeholder = "请选择",
  className,
  ariaDescribedby,
  ariaInvalid,
}: SelectSheetProps<T>) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);

  // aria-label 会盖掉按钮的 text content，写死 label 的话读出来永远是「目标页，有弹出对话框」——
  // 当前选了哪项、是不是占位态一概听不出来（与 ShortcutInput 同一个坑）。把当前值拼进去。
  const accessibleLabel = current ? `${label}：${current.label}` : `${label}：${placeholder}`;

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={accessibleLabel}
        aria-describedby={ariaDescribedby}
        aria-invalid={ariaInvalid}
        onClick={() => setOpen(true)}
        className={`flex min-h-11 w-full items-center justify-between rounded-row border border-border bg-surface-elevated px-3 td-text-label ${className ?? ""}`}
      >
        <span className={current ? "text-ink" : "text-ink-3"}>{current ? current.label : placeholder}</span>
        <Icon icon={CaretDown} size={18} className="text-ink-3" />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={label}>
        {options.length === 0 ? (
          <div className="m-4 rounded-row border border-dashed border-border-hairline p-6 text-center td-text-body text-ink-3">
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
                  className="flex min-h-11 w-full items-center justify-between px-4 td-text-label text-ink hover:bg-surface-hover"
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
