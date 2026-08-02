import type { ReactNode } from "react";

export interface PageHeaderProps {
  title: string;
  back?: ReactNode;
  actions?: ReactNode;
  /** 覆盖容器类（如 SearchPage 的 surface 底色），默认 sticky 顶栏形态。 */
  className?: string;
  /** header 内第二行内容（保持 sticky，如 DiaryReviewPage 的分段/日期工具行）。 */
  children?: ReactNode;
}

export function PageHeader({ title, back, actions, className, children }: PageHeaderProps) {
  return (
    <header
      className={`sticky top-0 z-20 shrink-0 border-b border-border bg-page/95 backdrop-blur ${
        className ?? ""
      }`}
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
