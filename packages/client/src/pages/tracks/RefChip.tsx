import { ArrowSquareOut, GitBranch, LinkSimple } from "@phosphor-icons/react";
import type { Ref } from "@timedata/shared";
import { Link } from "react-router-dom";
import { Icon } from "../../components/Icon.js";
import { isLinkRef } from "../../lib/tracksView.js";

const CHIP_CLASS =
  "inline-flex max-w-[12rem] items-center gap-1 rounded-pill bg-surface-hover px-2 py-0.5 td-text-caption text-ink-2";
const CLICKABLE_CLASS = `${CHIP_CLASS} hover:bg-surface-elevated hover:text-accent`;

function refIcon(kind: string) {
  if (kind === "url") return ArrowSquareOut;
  if (kind === "commit") return GitBranch;
  return LinkSimple;
}

// 内部实体 ref → 应用内路由（kind 白名单）。task 走 todo 深链、goal/track 走各自详情。
// 未知 kind 返回 null，保持 inert span；外链仍由 isLinkRef 的 http(s) 协议白名单单独放行（TK-13）。
function routeForRef(refItem: Ref): string | null {
  switch (refItem.kind) {
    case "task":
      return `/todo?taskId=${encodeURIComponent(refItem.id)}`;
    case "goal":
      return `/goals/${encodeURIComponent(refItem.id)}`;
    case "track":
      return `/tracks/${encodeURIComponent(refItem.id)}`;
    default:
      return null;
  }
}

export function RefChip({ refItem }: { refItem: Ref }) {
  const text = refItem.label ?? refItem.id;
  if (isLinkRef(refItem)) {
    return (
      <a href={refItem.id} target="_blank" rel="noreferrer" data-testid="ref-chip" className={CLICKABLE_CLASS}>
        <Icon icon={refIcon(refItem.kind)} size={12} />
        <span className="truncate">{text}</span>
      </a>
    );
  }
  const route = routeForRef(refItem);
  if (route) {
    return (
      <Link to={route} data-testid="ref-chip" className={CLICKABLE_CLASS}>
        <Icon icon={refIcon(refItem.kind)} size={12} />
        <span className="truncate">{text}</span>
      </Link>
    );
  }
  return (
    <span data-testid="ref-chip" className={CHIP_CLASS}>
      <Icon icon={refIcon(refItem.kind)} size={12} />
      <span className="text-ink-3">{refItem.kind}</span>
      <span className="truncate">{text}</span>
    </span>
  );
}
