import type { ReactNode } from "react";

export interface CollapsibleSectionProps {
  title: string;
  count: number;
  defaultOpen?: boolean;
  onToggle?: (open: boolean) => void;
  children: ReactNode;
}

export function CollapsibleSection({ title, count, defaultOpen = false, onToggle, children }: CollapsibleSectionProps) {
  return (
    <details open={defaultOpen} onToggle={(event) => onToggle?.(event.currentTarget.open)} className="rounded-xl">
      <summary className="flex cursor-pointer list-none items-center justify-between px-2 py-2 text-sm font-medium text-slate-300">
        <span>{title}</span>
        <span className="text-xs text-slate-500">{count}</span>
      </summary>
      <div className="mt-1">{children}</div>
    </details>
  );
}
