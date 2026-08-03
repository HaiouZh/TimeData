import { Link } from "react-router";
import type { TaskTrackInfo } from "../../lib/taskTrackIndex.js";
import { BADGE_TONE_CLASSES } from "../../lib/trackBadgeTone.js";
import { META_CHIP_CLASS } from "./TaskRow.js";

// 看板信号标签用户可配到 64 字符（sanitizeTrackBoardSignals 上限），不是默认那种 2-5 字短词，
// 不封顶会把 meta 带整条撑开、挤掉同排的日期与项目 chip。
const SIGNAL_MAX_WIDTH = "max-w-32";
// 药丸本体只有 ~20px 高，远低于本仓触控约定（Checkbox 的 min-h-11=44px）。伪元素向外扩命中区，
// 视觉尺寸不变——不扩的话移动端指尖偏几像素就落到外层整行，点开的是任务详情而不是轨道。
// inset-3（12px×2）把命中区补到 ~44px，正好够上那条基准；inset-2 只到 ~36px，仍短一截。
const TOUCH_TARGET = "after:absolute after:-inset-3 after:content-['']";

/**
 * 任务行 meta 带上的轨道徽章：有信号显示 #信号文字（tone 与调度台同口径），
 * 无信号显示「轨道」中性微标；点击直达轨道详情。relative z-20 抬过行左拖拽层，
 * stopPropagation 不触发行点击（meta 胶囊约定：交互由内容自负）。
 */
export function TaskTrackChip({ info }: { info: TaskTrackInfo }) {
  const signal = info.signal;
  const className = signal
    ? `relative z-20 inline-flex items-center ${SIGNAL_MAX_WIDTH} truncate rounded-pill border px-1.5 py-px ${TOUCH_TARGET} ${BADGE_TONE_CLASSES[info.tone]}`
    : `relative z-20 ${META_CHIP_CLASS} ${TOUCH_TARGET} text-ink-2 hover:text-ink`;
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
