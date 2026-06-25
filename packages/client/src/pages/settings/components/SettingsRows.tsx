import { CaretRight } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../../../components/Icon.js";

export type SettingsRowAccent = "note" | "timeline" | "todo" | "health" | "settings" | "track" | "goal" | "time";

const ACCENT_BADGE: Record<SettingsRowAccent, string> = {
  note: "bg-surface-hover text-mod-note",
  timeline: "bg-surface-hover text-mod-timeline",
  todo: "bg-surface-hover text-mod-todo",
  health: "bg-surface-hover text-mod-health",
  settings: "bg-surface-hover text-mod-settings",
  track: "bg-surface-hover text-mod-track",
  goal: "bg-surface-hover text-mod-goal",
  time: "bg-surface-hover text-mod-time",
};

function RowBody({
  icon,
  accent,
  title,
  subtitle,
  accessory,
}: {
  icon: ReactNode;
  accent: SettingsRowAccent;
  title: string;
  subtitle?: string;
  accessory?: string;
}) {
  return (
    <>
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-row ${ACCENT_BADGE[accent]}`}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-ink">{title}</div>
        {subtitle && <div className="mt-0.5 truncate text-xs text-ink-3">{subtitle}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {accessory && (
          <span className="rounded-pill bg-surface-elevated px-2 py-0.5 text-[11px] font-medium text-ink-2">
            {accessory}
          </span>
        )}
        <Icon icon={CaretRight} size={16} className="text-ink-3" />
      </div>
    </>
  );
}

export function SettingsSection({
  title,
  description,
  children,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      {(title || description) && (
        <div className="px-1">
          {title && <h3 className="text-xs font-medium uppercase tracking-wider text-ink-3">{title}</h3>}
          {description && <p className="mt-1 text-xs text-ink-3">{description}</p>}
        </div>
      )}
      <div className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
        {children}
      </div>
    </section>
  );
}

export function SettingsRow({
  to,
  icon,
  accent,
  title,
  subtitle,
  accessory,
  disabled,
  onClick,
}: {
  to?: string;
  icon: ReactNode;
  accent: SettingsRowAccent;
  title: string;
  subtitle?: string;
  accessory?: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const className =
    "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-hover active:bg-surface-elevated disabled:opacity-60";
  const body = <RowBody icon={icon} accent={accent} title={title} subtitle={subtitle} accessory={accessory} />;

  if (to) {
    return (
      <Link to={to} className={className}>
        {body}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} disabled={disabled} className={className}>
      {body}
    </button>
  );
}

export function SettingsToggleRow({
  title,
  subtitle,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  subtitle?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-hover active:bg-surface-elevated disabled:opacity-60"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-ink">{title}</span>
        {subtitle && <span className="mt-0.5 block text-xs text-ink-3">{subtitle}</span>}
      </span>
      <span className={`relative h-6 w-11 rounded-pill transition-colors ${checked ? "bg-accent" : "bg-surface-elevated"}`}>
        <span
          className={`absolute top-1 h-4 w-4 rounded-full bg-page transition-[left] ${
            checked ? "left-6" : "left-1"
          }`}
        />
      </span>
    </button>
  );
}
