import { currentMilestone, milestoneProgress, type TrackMilestone, type TrackStep } from "@timedata/shared";
import {
  type ReactElement,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useState,
} from "react";
import { Link, useNavigate } from "react-router";
import { Checkbox } from "../../components/ui/Checkbox.js";
import { grabTrackToHand, releaseTrackFromHand } from "../../lib/sessions.js";
import { rowClickZone } from "../../lib/tasks/taskRowZone.js";
import { BADGE_TONE_CLASSES, type TrackBadgeTone } from "../../lib/trackBadgeTone.js";
import { setMilestoneStatus } from "../../lib/trackMilestones.js";
import { appendUserStep } from "../../lib/tracks.js";
import { DISPATCH_GROUP_LABELS, type DispatchItem } from "../../lib/tracksDispatch.js";
import { latestStep } from "../../lib/tracksView.js";
import { SegmentProgressBar } from "../tracks/workbench/SegmentProgressBar.js";
import { SignalSwitcher } from "../tracks/workbench/SignalSwitcher.js";
import { META_CHIP_CLASS } from "./TaskRow.js";

const GROUP_BADGE_TONES: Record<DispatchItem["group"], TrackBadgeTone> = {
  "awaiting-me": "warn",
  "agent-running": "agent",
  "wait-external": "default",
  "in-progress": "default",
};

export function TrackBucketRow(props: {
  item: DispatchItem;
  steps: readonly TrackStep[];
  milestones: readonly TrackMilestone[];
  project: { goalId: string; name: string } | null;
  expanded: boolean;
  onToggleExpand: (trackId: string) => void;
  inHand?: boolean;
  onError: (message: string) => void;
}): ReactElement {
  const { item, steps, milestones, project, expanded, onToggleExpand, inHand = false, onError } = props;
  const navigate = useNavigate();
  const href = `/tracks/${encodeURIComponent(item.track.id)}`;

  const latest = latestStep([...steps] as TrackStep[]) ?? item.latest ?? null;
  const latestText = latest?.content ?? null;

  const showProgress = milestoneProgress(milestones).total > 0;
  const current = currentMilestone(milestones);
  const groupLabel = DISPATCH_GROUP_LABELS[item.group];
  const tone = GROUP_BADGE_TONES[item.group];
  const badgeClass = BADGE_TONE_CLASSES[tone];

  const [draft, setDraft] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isMilestonePending, setIsMilestonePending] = useState(false);
  const [isHandPending, setIsHandPending] = useState(false);

  function handleRowClick(event: ReactMouseEvent<HTMLDivElement>): void {
    if (window.getSelection()?.toString()) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rowClickZone(event.clientX - rect.left, rect.width) === "expand") {
      onToggleExpand(item.track.id);
      return;
    }
    void navigate(href);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter") return;
    event.preventDefault();
    void navigate(href);
  }

  async function handleMilestoneChange(checked: boolean): Promise<void> {
    if (!checked) return;
    if (current === null) return;
    if (isMilestonePending) return;
    setIsMilestonePending(true);
    try {
      await setMilestoneStatus(current.id, "done");
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsMilestonePending(false);
    }
  }

  async function handleSubmit(): Promise<void> {
    const content = draft.trim();
    if (!content) return;
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await appendUserStep({ trackId: item.track.id, content, mode: "instant" });
      setDraft("");
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleHand(): Promise<void> {
    if (isHandPending) return;
    setIsHandPending(true);
    try {
      if (inHand) {
        await releaseTrackFromHand(item.track.id);
      } else {
        await grabTrackToHand(item.track.id);
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsHandPending(false);
    }
  }

  return (
    <div className="w-full rounded-row transition-colors duration-150 hover:bg-surface-hover">
      <div
        data-testid="track-bucket-row"
        role="link"
        tabIndex={0}
        aria-label={`查看轨道 ${item.track.title}`}
        aria-expanded={expanded}
        onClick={handleRowClick}
        onKeyDown={handleKeyDown}
        className="flex items-center gap-2 rounded-row px-2 py-2 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
      >
        <span
          data-testid="track-bucket-badge"
          className={`inline-flex shrink-0 items-center rounded-pill border px-2 py-0.5 td-text-caption ${badgeClass}`}
        >
          {groupLabel}
        </span>
        <span className="min-w-0 flex-1 truncate td-text-body text-ink">{item.track.title}</span>
        {project !== null && (
          <Link
            to={`/goals/${encodeURIComponent(project.goalId)}`}
            data-testid="track-project-chip"
            aria-label={`查看项目 ${project.name}`}
            onClick={(event) => event.stopPropagation()}
            className={`relative z-20 ${META_CHIP_CLASS} text-ink-2 hover:text-ink`}
          >
            {project.name}
          </Link>
        )}
        {showProgress && (
          <span data-testid="track-bucket-progress" className="shrink-0">
            <SegmentProgressBar milestones={milestones} size="mini" />
          </span>
        )}
        <span
          data-testid="track-bucket-latest"
          className="min-w-0 flex-1 line-clamp-1 td-text-caption text-ink-2"
          title={latestText ?? undefined}
        >
          {latestText ? latestText : <span className="td-text-caption text-ink-3">尚无步骤</span>}
        </span>
        {item.stalledDays !== null && (
          <span data-testid="track-stalled" className="shrink-0 td-text-caption text-ink-3">
            {item.stalledDays} 天没动静
          </span>
        )}
        <Link
          to={href}
          data-testid="track-bucket-link"
          aria-label={`查看轨道 ${item.track.title}`}
          onClick={(event) => event.stopPropagation()}
          className="sr-only"
        >
          查看轨道
        </Link>
      </div>

      {expanded && (
        <div className="ml-2 space-y-2 pb-2 pr-2">
          {current !== null && (
            <div data-testid="track-bucket-current-milestone" className="flex items-center gap-2">
              <span className="td-text-caption text-ink-2">当前阶段：{current.title}</span>
              <Checkbox
                checked={false}
                onChange={(checked) => void handleMilestoneChange(checked)}
                ariaLabel={`完成阶段 ${current.title}`}
                disabled={isMilestonePending}
              />
            </div>
          )}
          <SignalSwitcher track={item.track} steps={steps} onError={onError} />
          <div className="flex items-center gap-2">
            <input
              aria-label="新步骤内容"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing &&
                  event.nativeEvent.keyCode !== 229
                ) {
                  event.preventDefault();
                  void handleSubmit();
                }
              }}
              disabled={isSubmitting}
              placeholder="记一步..."
              className="min-w-0 flex-1 rounded-ctl border border-border bg-surface px-2 py-1 text-ink outline-none disabled:opacity-40"
            />
            <button
              type="button"
              aria-label="提交新步骤"
              onClick={() => void handleSubmit()}
              disabled={isSubmitting}
              className="rounded-ctl bg-accent px-3 py-1 td-text-caption text-accent-contrast disabled:opacity-40"
            >
              提交
            </button>
          </div>
          <button
            type="button"
            aria-label={inHand ? "移出手头" : "抓到手头"}
            onClick={() => void handleHand()}
            disabled={isHandPending}
            className="rounded-ctl border border-border px-3 py-1 td-text-caption text-ink-2 hover:text-ink disabled:opacity-40"
          >
            {inHand ? "移出手头" : "抓到手头"}
          </button>
        </div>
      )}
    </div>
  );
}
