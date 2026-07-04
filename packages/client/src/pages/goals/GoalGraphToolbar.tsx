import { ArrowCounterClockwise, ArrowLeft, CornersOut, DotsThree, Plus } from "@phosphor-icons/react";
import { Icon } from "../../components/Icon.js";
import { useIsCoarsePointer } from "../../lib/useIsCoarsePointer.js";

export interface GoalGraphToolbarSummary {
  ready: number;
  blocked: number;
  completed: number;
}

export interface GoalGraphToolbarProps {
  summary: GoalGraphToolbarSummary;
  onAddMember: () => void;
  onFitView: () => void;
  onBackToGalaxy: () => void;
  onOpenGoalMenu: () => void;
  onRestoreLayout?: () => void;
}

const buttonBaseClass =
  "flex shrink-0 items-center justify-center rounded-pill text-ink-2 transition-colors hover:bg-surface-hover hover:text-ink focus:outline-none focus:ring-1 focus:ring-accent";

export function GoalGraphToolbar({
  summary,
  onAddMember,
  onFitView,
  onBackToGalaxy,
  onOpenGoalMenu,
  onRestoreLayout,
}: GoalGraphToolbarProps) {
  const coarse = useIsCoarsePointer();
  const buttonClass = `${buttonBaseClass} ${coarse ? "h-11 w-11" : "h-8 w-8"}`;

  return (
    <div className="pointer-events-auto inline-flex max-w-full items-center gap-2 rounded-pill border border-border bg-surface-elevated px-2 py-1 text-ink shadow-elev1">
      <span className="whitespace-nowrap px-1 td-text-caption text-ink-2">
        {summary.ready} 能推 · {summary.blocked} 等前置 · {summary.completed} 完成
      </span>
      <div className={`flex shrink-0 items-center ${coarse ? "gap-2" : "gap-1"}`}>
        <button type="button" aria-label="添加成员" onClick={onAddMember} className={buttonClass}>
          <Icon icon={Plus} size={16} />
        </button>
        <button type="button" aria-label="回到全图" onClick={onFitView} className={buttonClass}>
          <Icon icon={CornersOut} size={16} />
        </button>
        <button type="button" aria-label="返回目标星图" onClick={onBackToGalaxy} className={buttonClass}>
          <Icon icon={ArrowLeft} size={16} />
        </button>
        {onRestoreLayout && (
          <button type="button" aria-label="恢复自动布局" onClick={onRestoreLayout} className={buttonClass}>
            <Icon icon={ArrowCounterClockwise} size={16} />
          </button>
        )}
        <button type="button" aria-label="目标菜单" onClick={onOpenGoalMenu} className={buttonClass}>
          <Icon icon={DotsThree} size={18} />
        </button>
      </div>
    </div>
  );
}
