import type { Track, TrackStep } from "@timedata/shared";
import { useState } from "react";
import { Link } from "react-router-dom";
import { formatRelativeTime } from "../../lib/time.js";
import { lastActivityAt, latestStep, stepSourceText, type TrackBoardSignal } from "../../lib/tracksView.js";
import { StepComposer, type StepDraft } from "./StepComposer.js";

const STATUS_DOT: Record<string, string> = { active: "bg-accent", concluded: "bg-ink-3", parked: "bg-ink-3" };

export interface TrackListItemProps {
  track: Track;
  steps: TrackStep[];
  now?: Date;
  signal?: TrackBoardSignal | null;
  stalledDays?: number | null;
  selected?: boolean;
  statusTags?: readonly string[];
  onSubmitStep?: (draft: StepDraft) => Promise<void> | void;
}

// 状态卡：主体 = 当前帧（最新步内容）。计时弱化——只显示最后动静，不显示历时/步数。
export function TrackListItem({
  track,
  steps,
  now = new Date(),
  signal,
  stalledDays = null,
  selected = false,
  statusTags = [],
  onSubmitStep,
}: TrackListItemProps) {
  const [expanded, setExpanded] = useState(false);
  const latest = latestStep(steps);
  const activityAt = lastActivityAt(steps);

  return (
    <article
      className={`rounded-card border bg-surface transition hover:bg-surface-hover ${
        selected ? "border-accent" : "border-border"
      }`}
    >
      <Link to={`/tracks/${track.id}`} className="block px-3 py-3 focus:outline-none focus:ring-1 focus:ring-accent">
        <span className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className={`mt-1.5 h-2 w-2 shrink-0 rounded-pill ${STATUS_DOT[track.status] ?? "bg-ink-3"}`}
          />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 truncate td-text-body text-ink">{track.title}</span>
              {signal && (
                <span className="inline-flex shrink-0 items-center rounded-pill border border-accent/30 bg-accent-soft px-2 py-0.5 td-text-caption text-accent">
                  #{signal.tag}
                </span>
              )}
              {activityAt !== null || stalledDays !== null ? (
                <span data-testid="track-last-activity" className="shrink-0 td-text-caption text-ink-3">
                  {stalledDays !== null
                    ? `${stalledDays} 天没动静`
                    : activityAt !== null
                      ? formatRelativeTime(activityAt, now)
                      : ""}
                </span>
              ) : null}
            </span>
            {latest ? (
              <span className="mt-1.5 flex items-start gap-1.5">
                <span
                  data-source={latest.source}
                  className="shrink-0 rounded-pill bg-surface-elevated px-1.5 py-0.5 td-text-caption text-ink-3"
                >
                  {stepSourceText(latest)}
                </span>
                <span data-testid="track-current-frame" className="line-clamp-3 min-w-0 td-text-caption text-ink-2">
                  {latest.content || "无内容步骤"}
                </span>
              </span>
            ) : (
              <span data-testid="track-current-frame" className="mt-1.5 block td-text-caption text-ink-3">
                尚无步骤
              </span>
            )}
            {track.summary && <span className="mt-1 block truncate td-text-caption text-ink-3">{track.summary}</span>}
          </span>
        </span>
      </Link>
      {track.status === "active" && onSubmitStep && (
        <div>
          <div className="flex justify-end border-t border-border px-3 py-2">
            <button
              type="button"
              aria-label="写一步"
              onClick={() => setExpanded((current) => !current)}
              className="rounded-ctl border border-border px-3 py-1.5 td-text-label text-ink-2 transition hover:border-accent hover:text-accent"
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
