import type { ReactNode } from "react";

export interface PageHeaderProps {
  title: string;
  back?: ReactNode;
  actions?: ReactNode;
  /** 背景色：page（默认，sticky 顶栏）或 surface。背景只走本 prop，别用 className 覆盖——两个 bg-* 并存时胜负由编译产物顺序决定。 */
  background?: "page" | "surface";
  /** 布局类覆盖（不承载背景色）。 */
  className?: string;
  /** header 内第二行内容（保持 sticky，如 DiaryReviewPage 的分段/日期工具行）。 */
  children?: ReactNode;
}

export function PageHeader({ title, back, actions, background = "page", className, children }: PageHeaderProps) {
  return (
    <header
      className={`sticky top-0 z-20 shrink-0 border-b border-border backdrop-blur ${
        background === "surface" ? "bg-surface/95" : "bg-page/95"
      } ${className ?? ""}`}
    >
      <div className="flex items-center gap-3 px-3 py-2 sm:px-4 sm:py-3">
        {back}
        <h1 className="min-w-0 flex-1 truncate td-text-title text-ink">{title}</h1>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  );
}
