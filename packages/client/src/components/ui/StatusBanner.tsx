import type { ReactNode } from "react";

export type StatusTone = "info" | "warn" | "danger";

export interface StatusBannerProps {
  tone: StatusTone;
  children: ReactNode;
}

const TONE_CLASSES: Record<StatusTone, string> = {
  info: "border-border bg-surface/95 text-ink-2",
  warn: "border-warn/40 bg-warn/10 text-warn",
  danger: "border-danger/40 bg-danger/10 text-danger",
};

export function StatusBanner({ tone, children }: StatusBannerProps) {
  return <div className={`rounded-card border px-3 py-2 td-text-body ${TONE_CLASSES[tone]}`}>{children}</div>;
}
