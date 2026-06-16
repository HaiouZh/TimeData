import type { ReactNode } from "react";
import { Check } from "@phosphor-icons/react";
import { Icon } from "../Icon.js";

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
}

export function Checkbox({ checked, onChange, label, ariaLabel, disabled, className }: CheckboxProps) {
  return (
    <label className={`inline-flex min-h-11 cursor-pointer items-center gap-2 ${disabled ? "opacity-40" : ""} ${className ?? ""}`}>
      <input
        type="checkbox"
        aria-label={label ? undefined : ariaLabel}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
      <span
        aria-hidden="true"
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-ctl border transition-colors motion-reduce:transition-none ${
          checked ? "border-accent bg-accent text-page" : "border-border-strong"
        }`}
      >
        {checked && <Icon icon={Check} size={14} weight="bold" />}
      </span>
      {label && <span className="text-sm text-ink">{label}</span>}
    </label>
  );
}
