import type { Track, TrackStep } from "@timedata/shared";
import { useState } from "react";
import { Link } from "react-router";
import { formatRelativeTime } from "../../lib/time.js";
import { BADGE_TONE_CLASSES, type TrackBadgeTone } from "../../lib/trackBadgeTone.js";
import { lastActivityAt, latestStep, stepSourceText, type TrackBoardSignal } from "../../lib/tracksView.js";
import { StepComposer, type StepDraft } from "./StepComposer.js";

const STATUS_DOT: Record<string, string> = { active: "bg-accent", concluded: "bg-ink-3", parked: "bg-ink-3" };

export type { TrackBadgeTone } from "../../lib/trackBadgeTone.js";

export interface TrackListItemProps {
  track: Track;
  steps: TrackStep[];
  now?: Date;
  signal?: TrackBoardSignal | null;
  badgeTone?: TrackBadgeTone;
  stalledDays?: number | null;
  selected?: boolean;
  statusTags?: readonly string[];
  onSubmitStep?: (draft: StepDraft) => Promise<void> | void;
  /** 归档区降噪：收成单行，隐去来源 chip/summary/信号徽章/写一步 footer（TK 归档卡去噪）。 */
  compact?: boolean;
}

// 状态卡：主体 = 当前帧（最新步内容）。计时弱化——只显示最后动静，不显示历时/步数。
export function TrackListItem({
  track,
  steps,
  now = new Date(),
  signal,
  badgeTone = "default",
  stalledDays = null,
  selected = false,
  statusTags = [],
  onSubmitStep,
  compact = false,
}: TrackListItemProps) {
  const [expanded, setExpanded] = useState(false);
  const latest = latestStep(steps);
  const activityAt = lastActivityAt(steps);

  if (compact) {
    return (
      <article
        className={`rounded-card border bg-surface transition hover:bg-surface-hover ${
          selected ? "border-accent" : "border-border"
        }`}
      >
        <Link
          to={`/tracks/${track.id}`}
          className="flex items-center gap-2 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          <span
            aria-hidden="true"
            className={`content-dot rounded-pill ${STATUS_DOT[track.status] ?? "bg-ink-3"}`}
          />
          <span className="w-2/5 shrink-0 truncate td-text-body text-ink">{track.title}</span>
          <span data-testid="track-current-frame" className="min-w-0 flex-1 truncate td-text-caption text-ink-3">
            {latest ? latest.content || "无内容步骤" : "尚无步骤"}
          </span>
          {activityAt !== null || stalledDays !== null ? (
            <span data-testid="track-last-activity" className="shrink-0 td-text-caption text-ink-3">
              {stalledDays !== null
                ? `${stalledDays} 天没动静`
                : activityAt !== null
                  ? formatRelativeTime(activityAt, now)
                  : ""}
            </span>
          ) : null}
        </Link>
      </article>
    );
  }

  return (
    <article
      className={`group rounded-card border bg-surface transition hover:bg-surface-hover ${
        selected ? "border-accent" : "border-border"
      }`}
    >
      <Link to={`/tracks/${track.id}`} className="block px-4 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface">
        <span className="flex items-start gap-4">
          <span
            aria-hidden="true"
            className={`mt-2 content-dot rounded-pill ${STATUS_DOT[track.status] ?? "bg-ink-3"}`}
          />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 truncate td-text-body font-medium text-ink">{track.title}</span>
              {signal && (
                <span
                  data-testid="track-signal-badge"
                  className={`inline-flex shrink-0 items-center rounded-pill border px-2 py-1 td-text-caption ${BADGE_TONE_CLASSES[badgeTone]}`}
                >
                  #{signal.tag}
                </span>
              )}
              {activityAt !== null || stalledDays !== null ? (
                <span
                  data-testid="track-last-activity"
                  className={`shrink-0 td-text-caption ${stalledDays !== null ? "text-warn" : "text-ink-3"}`}
                >
                  {stalledDays !== null
                    ? `${stalledDays} 天没动静`
                    : activityAt !== null
                      ? formatRelativeTime(activityAt, now)
                      : ""}
                </span>
              ) : null}
            </span>
            {latest ? (
              <span className="mt-2 flex items-start gap-2">
                {latest.source !== "user" && (
                  <span
                    data-source={latest.source}
                    className="shrink-0 rounded-pill bg-surface-elevated px-2 py-1 td-text-caption text-ink-3"
                  >
                    {stepSourceText(latest)}
                  </span>
                )}
                <span data-testid="track-current-frame" className="line-clamp-2 min-w-0 td-text-caption text-ink-2">
                  {latest.content || "无内容步骤"}
                </span>
              </span>
            ) : (
              <span data-testid="track-current-frame" className="mt-2 block td-text-caption text-ink-3">
                尚无步骤
              </span>
            )}
          </span>
        </span>
      </Link>
      {track.status === "active" && onSubmitStep && (
        <div>
          <div className="flex justify-end px-4 pb-2">
            <button
              type="button"
              aria-label="写一步"
              onClick={() => setExpanded((current) => !current)}
              className={`td-text-label text-ink-3 transition hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 md:focus-visible:opacity-100 ${
                expanded ? "md:opacity-100" : ""
              }`}
            >
              写一步
            </button>
          </div>
          {expanded && (
            <StepComposer
              surface="inline"
              submitLabel="写入这一步"
              statusTags={statusTags}
              onSubmit={async (draft) => {
                // 把 promise 交回 StepComposer 等待：成功才收起，失败保持展开并由内部 inline 报错（TK-01）。
                await onSubmitStep?.(draft);
                setExpanded(false);
              }}
            />
          )}
        </div>
      )}
    </article>
  );
}
