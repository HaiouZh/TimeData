interface GoalStarCoreProps {
  pct?: number;
  label: string;
  size?: "sm" | "md" | "lg";
}

const SIZE_CLASS = {
  sm: {
    shell: "h-12 w-12",
    ring: "inset-[-5px]",
    center: "h-10 w-10 text-[11px]",
  },
  md: {
    shell: "h-16 w-16",
    ring: "inset-[-6px]",
    center: "h-12 w-12 text-xs",
  },
  lg: {
    shell: "h-20 w-20",
    ring: "inset-[-7px]",
    center: "h-14 w-14 text-sm",
  },
} as const;

export function GoalStarCore({ pct, label, size = "md" }: GoalStarCoreProps) {
  const classes = SIZE_CLASS[size];
  const progressDeg = pct === undefined ? 360 : pct * 3.6;

  return (
    <span
      data-goal-star-core="true"
      className={`relative inline-flex items-center justify-center rounded-pill border border-[var(--galaxy-star-core)] bg-accent-soft text-ink shadow-[0_0_26px_rgba(155,188,255,0.32)] ${classes.shell}`}
    >
      <span
        data-goal-star-progress-ring="true"
        aria-hidden="true"
        className={`absolute rounded-pill border border-[var(--galaxy-edge)] opacity-75 ${classes.ring}`}
        style={{ background: `conic-gradient(var(--galaxy-edge) ${progressDeg}deg, transparent 0deg)` }}
      />
      <span className="absolute inset-[-3px] rounded-pill bg-surface-elevated" aria-hidden="true" />
      <span
        data-progress={pct}
        className={`relative z-10 inline-flex items-center justify-center rounded-pill border border-[var(--galaxy-star-core)] bg-surface font-semibold text-[var(--galaxy-star-core)] ${classes.center}`}
      >
        {label}
      </span>
    </span>
  );
}
