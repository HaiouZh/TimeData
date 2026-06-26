import { ArrowsClockwise, Sparkle } from "@phosphor-icons/react";
import { Icon } from "../../components/Icon.js";
import type { GalaxyEngineMode } from "../../lib/galaxyEngineMode.js";

const CONTROL_CLASS =
  "pointer-events-auto inline-flex h-9 items-center gap-1.5 rounded-pill border border-border bg-surface-elevated px-3 text-xs text-ink-2 shadow-sm transition-colors hover:bg-surface-hover hover:text-ink focus:outline-none focus:ring-1 focus:ring-accent";

export function GoalGalaxyEngineToggle({
  live,
  mode,
  onModeChange,
  onLiveChange,
}: {
  live: boolean;
  mode: GalaxyEngineMode;
  onModeChange: (mode: GalaxyEngineMode) => void;
  onLiveChange: (live: boolean) => void;
}) {
  const settle = mode === "settle";
  return (
    <>
      <button
        type="button"
        aria-label="切换星图引擎"
        aria-pressed={settle}
        onClick={() => onModeChange(settle ? "deterministic" : "settle")}
        className={CONTROL_CLASS}
      >
        <Icon icon={Sparkle} size={16} weight={settle ? "fill" : "regular"} />
        <span className="whitespace-nowrap">{settle ? "灵动" : "静态"}</span>
      </button>
      {settle && (
        <button
          type="button"
          aria-label={live ? "暂停持续整理" : "继续持续整理"}
          aria-pressed={live}
          onClick={() => onLiveChange(!live)}
          className={CONTROL_CLASS}
        >
          <Icon icon={ArrowsClockwise} size={16} weight={live ? "bold" : "regular"} />
          <span className="whitespace-nowrap">{live ? "整理中" : "已暂停"}</span>
        </button>
      )}
    </>
  );
}
