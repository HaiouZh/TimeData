export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
}

export function Switch({ checked, onChange, ariaLabel, disabled, className }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-pill border transition-colors motion-reduce:transition-none disabled:opacity-40 ${
        checked ? "border-accent bg-accent" : "border-border-strong bg-surface"
      } ${className ?? ""}`}
    >
      <span
        aria-hidden="true"
        className={`inline-block h-4 w-4 rounded-pill bg-page transition-transform motion-reduce:transition-none ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}
