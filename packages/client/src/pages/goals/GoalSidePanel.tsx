import { X } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Icon } from "../../components/Icon.js";

export interface GoalSidePanelProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function GoalSidePanel({ open, title, onClose, children }: GoalSidePanelProps) {
  if (!open) return null;

  return (
    <aside
      aria-label={title}
      className="flex h-full min-h-0 w-[420px] max-w-[40vw] shrink-0 flex-col border-l border-border bg-surface-elevated text-ink shadow-elev2"
    >
      <div className="flex min-h-14 items-center justify-between border-b border-border-hairline px-4">
        <h2 className="text-base text-ink">{title}</h2>
        <button type="button" aria-label={`关闭${title}`} onClick={onClose} className="text-ink-3 hover:text-ink">
          <Icon icon={X} size={20} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </aside>
  );
}
