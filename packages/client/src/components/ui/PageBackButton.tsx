import { CaretLeft } from "@phosphor-icons/react";
import { Link } from "react-router";
import { Icon } from "../Icon.js";

interface PageBackButtonProps {
  to?: string;
  onClick?: () => void;
  label?: string;
}

/**
 * 统一返回按钮：44px 热区（size-11 = 触控下限）。
 * 传 to 渲染路由 Link，否则渲染 button；onClick 仅在 button 形态生效语义。
 */
export function PageBackButton({ to, onClick, label = "返回" }: PageBackButtonProps) {
  const className =
    "grid size-11 shrink-0 place-items-center rounded-pill border border-border bg-surface text-ink-2 transition hover:border-accent hover:text-ink";
  const content = <Icon icon={CaretLeft} size={18} />;
  if (to !== undefined) {
    return (
      <Link to={to} aria-label={label} className={className}>
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
