import { ArrowSquareOut, GitBranch, LinkSimple } from "@phosphor-icons/react";
import type { Ref } from "@timedata/shared";
import { Icon } from "../../components/Icon.js";
import { isLinkRef } from "../../lib/tracksView.js";

const CHIP_CLASS =
  "inline-flex max-w-[12rem] items-center gap-1 rounded-pill bg-surface-hover px-2 py-0.5 td-text-caption text-ink-2";

function refIcon(kind: string) {
  if (kind === "url") return ArrowSquareOut;
  if (kind === "commit") return GitBranch;
  return LinkSimple;
}

export function RefChip({ refItem }: { refItem: Ref }) {
  const text = refItem.label ?? refItem.id;
  if (isLinkRef(refItem)) {
    return (
      <a
        href={refItem.id}
        target="_blank"
        rel="noreferrer"
        data-testid="ref-chip"
        className={`${CHIP_CLASS} hover:bg-surface-elevated hover:text-accent`}
      >
        <Icon icon={refIcon(refItem.kind)} size={12} />
        <span className="truncate">{text}</span>
      </a>
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
