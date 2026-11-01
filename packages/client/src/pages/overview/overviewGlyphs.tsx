import type { OverviewClusterStatus, OverviewStarKind } from "@timedata/shared";

/** 星种类到图例文案的映射。 */
export const STAR_KIND_LABELS: Record<OverviewStarKind, string> = {
  input: "你丢的",
  done: "做完的",
  progress: "项目进度",
  recurring: "固定重复",
};

/** 状态章上显示的文案。 */
export function statusChipText(status: OverviewClusterStatus | null, quietDays: number | null): string {
  switch (status) {
    case "moving":
      return "在推进";
    case "saving":
      return "在攒";
    case "shelved":
      return `搁着 · ${quietDays ?? 0} 天`;
    case "fixed":
      return "固定";
    case "empty":
      return "还空着";
    default:
      return "散着";
  }
}

const STAR_GLYPH_CLASSES: Record<OverviewStarKind, string> = {
  input: "inline-block size-2.5 shrink-0 rounded-pill border border-[var(--sky-star-input)]",
  done: "inline-block size-2.5 shrink-0 rounded-pill bg-[var(--sky-star-done)] shadow-[var(--shadow-sky-done)]",
  progress: "inline-block size-2 shrink-0 rotate-45 rounded-sm bg-[var(--sky-star-progress)]",
  recurring: "inline-block size-2.5 shrink-0 rounded-pill border border-dashed border-[var(--sky-recurring)]",
};

const STATUS_CHIP_COLOR_CLASSES: Record<string, string> = {
  moving: "text-[var(--sky-status-moving)]",
  saving: "text-[var(--sky-status-saving)]",
  fixed: "text-[var(--sky-recurring)]",
};

const LEGEND_ORDER: readonly OverviewStarKind[] = ["input", "done", "progress", "recurring"];

/** 全貌星形装饰，不可聚焦、无文字。 */
export function StarGlyph(props: { kind: OverviewStarKind; dimmed?: boolean }): React.JSX.Element {
  const { kind, dimmed = false } = props;
  return <span aria-hidden="true" className={dimmed ? `${STAR_GLYPH_CLASSES[kind]} opacity-40` : STAR_GLYPH_CLASSES[kind]} />;
}

/** 全貌状态章。 */
export function StatusChip(props: {
  status: OverviewClusterStatus | null;
  quietDays: number | null;
}): React.JSX.Element {
  const { status, quietDays } = props;
  const colorClass = status === null ? "text-ink-3" : (STATUS_CHIP_COLOR_CLASSES[status] ?? "text-ink-3");
  return (
    <span className={`inline-flex shrink-0 items-center rounded-pill border border-current px-1.5 td-text-caption ${colorClass}`}>
      {statusChipText(status, quietDays)}
    </span>
  );
}

/** 全貌星图例。 */
export function OverviewLegend(): React.JSX.Element {
  return (
    <ul aria-label="星的图例" className="flex flex-wrap items-center gap-3 td-text-caption text-ink-2">
      {LEGEND_ORDER.map((kind) => (
        <li key={kind} className="inline-flex items-center gap-1.5">
          <StarGlyph kind={kind} />
          {STAR_KIND_LABELS[kind]}
        </li>
      ))}
    </ul>
  );
}
