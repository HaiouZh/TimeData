import type { ReactNode } from "react";

export function metricToneClass(tone: "neutral" | "good" | "warn" | "danger" | "info" = "neutral"): string {
  return {
    neutral: "border-slate-800/80 bg-slate-900/70 text-slate-100",
    good: "border-emerald-400/20 bg-emerald-400/10 text-emerald-100",
    warn: "border-amber-400/20 bg-amber-400/10 text-amber-100",
    danger: "border-rose-400/20 bg-rose-400/10 text-rose-100",
    info: "border-sky-400/20 bg-sky-400/10 text-sky-100",
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
    <section className="rounded-[1.35rem] border border-slate-800/80 bg-slate-950/70 p-4 shadow-[0_18px_48px_rgba(2,6,23,0.28)] ring-1 ring-white/[0.03]">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          {eyebrow && (
            <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">{eyebrow}</div>
          )}
          <h3 className="text-base font-semibold text-slate-100">{title}</h3>
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
    <div className={`rounded-2xl border px-3.5 py-3 ${metricToneClass(tone)}`}>
      <div className="text-[11px] font-medium text-slate-400">{label}</div>
      <div className="mt-1 text-xl font-semibold leading-tight tracking-normal">{value}</div>
      {hint && <div className="mt-1 text-[11px] leading-snug text-slate-500">{hint}</div>}
    </div>
  );
}
