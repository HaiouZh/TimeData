import { Link } from "react-router";
import type { TaskTrackInfo } from "../../lib/taskTrackIndex.js";
import { BADGE_TONE_CLASSES } from "../../lib/trackBadgeTone.js";
import { META_CHIP_CLASS } from "./TaskRow.js";

/**
 * 任务行 meta 带上的轨道徽章：有信号显示 #信号文字（tone 与调度台同口径），
 * 无信号显示「轨道」中性微标；点击直达轨道详情。relative z-20 抬过行左拖拽层，
 * stopPropagation 不触发行点击（meta 胶囊约定：交互由内容自负）。
 */
export function TaskTrackChip({ info }: { info: TaskTrackInfo }) {
  const signal = info.signal;
  const className = signal
    ? `relative z-20 inline-flex items-center rounded-pill border px-1.5 py-px ${BADGE_TONE_CLASSES[info.tone]}`
    : `relative z-20 ${META_CHIP_CLASS} text-ink-2 hover:text-ink`;
  return (
    <Link
      to={`/tracks/${encodeURIComponent(info.track.id)}`}
      data-testid="task-track-chip"
      data-tone={signal ? info.tone : "none"}
      aria-label={`查看轨道 ${info.track.title}`}
      onClick={(event) => event.stopPropagation()}
      className={className}
    >
      {signal ? `#${signal.tag}` : "轨道"}
    </Link>
  );
}
