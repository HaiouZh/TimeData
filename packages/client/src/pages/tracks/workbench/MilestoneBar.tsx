import { milestoneProgress, type TrackMilestone } from "@timedata/shared";
import { SegmentProgressBar } from "./SegmentProgressBar.js";

/**
 * 详情页顶部工具带里的阶段骨架条：一行装下进度 + 展开入口。
 *
 * 段明细（列表 / 立骨架 textarea）不在带内——带的高度不能被段列表撑爆，
 * 明细由 MilestonePanel 在带下方展开。
 */
export function MilestoneBar({
  milestones,
  expanded,
  onToggle,
  readOnly,
}: {
  milestones: readonly TrackMilestone[];
  expanded: boolean;
  onToggle: () => void;
  readOnly?: boolean;
}): React.JSX.Element {
  const { total } = milestoneProgress(milestones);
  // 只读 + 无段才彻底藏掉入口：只读但有段时仍要能展开查看（归档轨道的骨架不该消失）。
  const showToggle = !(readOnly && total === 0);
  return (
    <div className="flex flex-1 items-center gap-2">
      <SegmentProgressBar milestones={milestones} size="full" />
      {showToggle && (
        <button
          type="button"
          data-testid="milestone-bar-toggle"
          aria-expanded={expanded}
          onClick={onToggle}
          className="ml-auto shrink-0 rounded-ctl border border-border px-4 py-1 td-text-label text-ink-2 hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-page"
        >
          {total === 0 ? "立骨架" : "阶段"}
        </button>
      )}
    </div>
  );
}
