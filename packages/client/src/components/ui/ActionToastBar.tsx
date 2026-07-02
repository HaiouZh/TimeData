import type { ActionToastData } from "../../hooks/useActionToast.js";

export function ActionToastBar({
  toast,
  onDismiss,
  ariaLabel,
  className = "",
}: {
  toast: ActionToastData | null;
  onDismiss: () => void;
  ariaLabel: string;
  className?: string;
}) {
  if (!toast) return null;
  return (
    <div
      role="status"
      aria-label={ariaLabel}
      className={`flex items-center gap-3 rounded-card border border-border-strong bg-surface/95 px-3 py-2 td-text-body text-ink shadow-elev1 ${className}`}
    >
      <span className="min-w-0 flex-1 truncate">{toast.message}</span>
      {toast.actions?.map((action) => (
        <button
          key={action.label}
          type="button"
          onClick={() => {
            onDismiss();
            action.onClick();
          }}
          className="shrink-0 font-semibold text-accent transition hover:text-accent-ink"
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
