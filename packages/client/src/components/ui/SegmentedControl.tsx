export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
  /** 尺寸档：md 默认（label 等宽）；lg 大热区（body 等宽）；sm 紧凑（caption 非等宽）。 */
  size?: "sm" | "md" | "lg";
}

const OPTION_SIZE_CLASSES = {
  sm: "min-h-9 rounded-pill px-3 td-text-caption font-medium",
  md: "min-h-9 flex-1 rounded-pill px-3 td-text-label",
  lg: "min-h-11 flex-1 rounded-pill px-3 td-text-body font-medium",
} as const;

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
  size = "md",
}: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={`flex gap-1 rounded-pill border border-border bg-surface-elevated p-1 ${className ?? ""}`}
    >
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={opt.disabled}
            onClick={() => !opt.disabled && onChange(opt.value)}
            className={`${OPTION_SIZE_CLASSES[size]} transition-colors motion-reduce:transition-none disabled:opacity-40 ${
              selected ? "bg-accent text-page" : "text-ink-2 hover:text-ink"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
