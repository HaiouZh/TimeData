import type { ReactNode } from "react";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  variant?: "card" | "inline";
  className?: string;
}

export function EmptyState({ icon, title, description, action, variant = "card", className }: EmptyStateProps) {
  if (variant === "inline") {
    return (
      <div className={`td-text-body text-ink-2 ${className ?? ""}`}>
        {icon && <span className="mr-1.5 inline-flex align-middle">{icon}</span>}
        {title}
        {description && <div className="mt-1 td-text-caption text-ink-3">{description}</div>}
        {action && <div className="mt-3">{action}</div>}
      </div>
    );
  }

  return (
    <div className={`rounded-card bg-surface px-5 py-10 text-center ${className ?? ""}`}>
      {icon && <div className="mb-2 flex justify-center">{icon}</div>}
      <p className="td-text-body font-medium text-ink-2">{title}</p>
      {description && <p className="mt-1 td-text-caption text-ink-3">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
