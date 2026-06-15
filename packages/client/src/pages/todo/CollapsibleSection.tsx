import type { ReactNode } from "react";

export function CollapsibleSection({
  title, count, defaultOpen = false, children,
}: { title: string; count: number; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <details open={defaultOpen} className="rounded-xl">
      <summary className="flex cursor-pointer list-none items-center justify-between px-2 py-2 text-sm font-medium text-slate-300">
        <span>{title}</span>
        <span className="text-xs text-slate-500">{count}</span>
      </summary>
      <div className="mt-1">{children}</div>
    </details>
  );
}
