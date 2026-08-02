import { CaretLeft } from "@phosphor-icons/react";
import { Link } from "react-router";
import { Icon } from "../Icon.js";

interface PageBackButtonProps {
  to?: string;
  onClick?: () => void;
  label?: string;
}

/**
 * 统一返回按钮：44px 热区（hotarea-lg = 触控下限）。
 * 传 to 渲染路由 Link（onClick 一并透传，可做导航前拦截），否则渲染 button。
 */
export function PageBackButton({ to, onClick, label = "返回" }: PageBackButtonProps) {
  const className =
    "grid hotarea-lg shrink-0 place-items-center rounded-pill border border-border bg-surface text-ink-2 transition hover:border-accent hover:text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent";
  const content = <Icon icon={CaretLeft} size={18} />;
  if (to !== undefined) {
    return (
      <Link to={to} aria-label={label} onClick={onClick} className={className}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" aria-label={label} onClick={onClick} className={className}>
      {content}
    </button>
  );
}
