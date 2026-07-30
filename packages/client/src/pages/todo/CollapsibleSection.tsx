import { CaretRight } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Icon } from "../../components/Icon.js";

export interface CollapsibleSectionProps {
  title: string;
  count: number;
  defaultOpen?: boolean;
  onToggle?: (open: boolean) => void;
  /**
   * summary 右侧的动作插槽（收件箱的「圈成项目」）。点它不会折叠本区块。
   *
   * 拦截用的是 `preventDefault` 而不是 `stopPropagation`：`<summary>` 的折叠是浏览器对 `details`
   * 的**默认行为**（activation behavior），在事件派发结束后才执行，不经 React 冒泡——
   * `stopPropagation` 对它完全无效（design 初稿写错，P2 实测确认）。
   *
   * 代价是这层包裹会吃掉内部所有点击的默认动作，因此 **action 里只放按钮，不要放 `<a>`**。
   */
  action?: ReactNode;
  children: ReactNode;
}

export function CollapsibleSection({
  title,
  count,
  defaultOpen = false,
  onToggle,
  action,
  children,
}: CollapsibleSectionProps) {
  return (
    <details open={defaultOpen} onToggle={(event) => onToggle?.(event.currentTarget.open)} className="rounded-xl">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-2 td-text-label font-medium text-ink-2">
        <span className="ts-collapse-caret inline-flex text-ink-3 transition-transform duration-150">
          <Icon icon={CaretRight} size={14} />
        </span>
        <span className="flex-1">{title}</span>
        <span className="td-text-caption text-ink-3">{count}</span>
        {action && (
          <span data-section-action className="shrink-0" onClick={(event) => event.preventDefault()}>
            {action}
          </span>
        )}
      </summary>
      <div className="mt-1">{children}</div>
    </details>
  );
}
