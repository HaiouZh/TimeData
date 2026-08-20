import type { TrackMilestone } from "@timedata/shared";
import { milestoneProgress, orderMilestones } from "@timedata/shared";

export interface SegmentProgressBarProps {
  milestones: readonly TrackMilestone[];
  size?: "full" | "mini";
}

export function SegmentProgressBar(props: SegmentProgressBarProps): React.JSX.Element {
  const { milestones, size = "full" } = props;
  const { done, total } = milestoneProgress(milestones);
  const isMini = size === "mini";

  if (total === 0) {
    return (
      <div data-testid="segment-progress-bar" className="flex items-center gap-2">
        <span
          data-testid="segment-empty-line"
          className={isMini ? "h-1 w-12 rounded-pill bg-border" : "h-1.5 w-16 rounded-pill bg-border"}
        />
        {!isMini && <span className="td-text-caption text-ink-3">未立骨架</span>}
      </div>
    );
  }

  const ordered = orderMilestones(milestones);
  const visible = ordered.filter((m) => m.status !== "dropped");

  return (
    <div data-testid="segment-progress-bar" className="flex items-center gap-2">
      <div className="flex flex-1 items-center gap-1">
        {visible.map((m) => {
          const isDone = m.status === "done";
          return (
            <span
              key={m.id}
              data-testid="segment"
              data-status={m.status}
              className={
                isDone
                  ? isMini
                    ? "h-1 flex-1 rounded-pill bg-accent"
                    : "h-2 flex-1 rounded-pill bg-accent"
                  : isMini
                    ? "h-1 flex-1 rounded-pill border border-accent bg-transparent"
                    : "h-2 flex-1 rounded-pill border border-accent bg-transparent"
              }
            />
          );
        })}
      </div>
      <span
        data-testid="segment-progress-text"
        className={isMini ? "td-text-caption text-xs text-ink-2" : "td-text-caption text-ink-2"}
      >
        {done}/{total}
      </span>
    </div>
  );
}
