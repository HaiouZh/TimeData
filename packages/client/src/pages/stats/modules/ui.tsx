import type { ReactNode } from "react";

export function metricToneClass(tone: "neutral" | "good" | "warn" | "danger" | "info" = "neutral"): string {
  return {
    neutral: "border-border bg-surface-elevated text-ink",
    good: "border-ok/30 bg-ok/10 text-ok",
    warn: "border-warn/40 bg-warn/10 text-warn",
    danger: "border-danger/40 bg-danger/10 text-danger",
    info: "border-accent/30 bg-accent/10 text-accent",
  }[tone];
}

export function SectionPanel({
  title,
  eyebrow,
  action,
  children,
}: {
  title: string;
  eyebrow?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-card border border-border bg-surface p-4 shadow-elev1">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          {eyebrow && (
            <div className="mb-1 td-eyebrow text-ink-3">{eyebrow}</div>
          )}
          <h3 className="td-text-body font-semibold text-ink">{title}</h3>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function MetricCard({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "neutral" | "good" | "warn" | "danger" | "info";
}) {
  return (
    <div className={`rounded-card border px-3.5 py-3 ${metricToneClass(tone)}`}>
      <div className="td-text-caption font-medium text-ink-2">{label}</div>
      <div className="td-num td-text-title mt-1 leading-tight">{value}</div>
      {hint && <div className="mt-1 td-text-caption leading-snug text-ink-3">{hint}</div>}
    </div>
  );
}
