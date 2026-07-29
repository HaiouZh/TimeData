import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { useNavigate } from "react-router";
import { listAllGoalLayoutPins } from "../../lib/goalLayoutPins.js";
import { listGoals } from "../../lib/goals.js";
import { getActiveSession } from "../../lib/sessions.js";
import { listAllTrackSteps, listTracks } from "../../lib/tracks.js";
import { useIsWideScreen } from "../../lib/useIsWideScreen.js";
import { GoalGalaxyCanvas } from "./GoalGalaxyCanvas.js";
import { listAllTasksForGoals } from "./goalPageData.js";
import { type GoalsViewMode, readGoalsViewMode, resolveGoalsViewMode, writeGoalsViewMode } from "./goalsViewPrefs.js";
import GoalsListPage from "./GoalsListPage.js";

export function GoalsPage() {
  const wide = useIsWideScreen();
  const navigate = useNavigate();
  // state 只存「手选偏好」；实际模式是派生值，未手选时天然跟随宽窄，手选后宽窄不再覆盖。
  const [storedMode, setStoredMode] = useState<GoalsViewMode | null>(() => readGoalsViewMode());
  const mode = resolveGoalsViewMode(wide, storedMode);

  function chooseMode(next: GoalsViewMode): void {
    writeGoalsViewMode(next);
    setStoredMode(next);
  }

  const goals = useLiveQuery(() => listGoals(), []);
  const tasks = useLiveQuery(() => listAllTasksForGoals(), []);
  const tracks = useLiveQuery(() => listTracks(), []);
  const steps = useLiveQuery(() => listAllTrackSteps(), []);
  const layoutPins = useLiveQuery(() => listAllGoalLayoutPins(), []);
  const activeSession = useLiveQuery(() => getActiveSession(), []);
  const galaxyReady =
    goals !== undefined &&
    tasks !== undefined &&
    tracks !== undefined &&
    steps !== undefined &&
    layoutPins !== undefined &&
    activeSession !== undefined;

  const showGalaxy = mode === "galaxy";

  return (
    <div className="flex h-full min-h-full flex-col bg-page text-ink">
      <div className="flex shrink-0 justify-end px-4 py-3">
        <div
          className="inline-flex rounded-pill border border-border bg-surface-elevated p-1 shadow-sm"
          role="tablist"
          aria-label="目标视图"
        >
          <button
            type="button"
            role="tab"
            aria-label="切换到目标星图"
            aria-selected={showGalaxy}
            onClick={() => chooseMode("galaxy")}
            className={`min-h-8 rounded-pill px-3 text-sm ${showGalaxy ? "bg-accent text-page" : "text-ink-2 hover:bg-surface-hover"}`}
          >
            星图
          </button>
          <button
            type="button"
            role="tab"
            aria-label="切换到目标列表"
            aria-selected={!showGalaxy}
            onClick={() => chooseMode("list")}
            className={`min-h-8 rounded-pill px-3 text-sm ${showGalaxy ? "text-ink-2 hover:bg-surface-hover" : "bg-accent text-page"}`}
          >
            列表
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {showGalaxy && galaxyReady ? (
          <GoalGalaxyCanvas
            goals={goals}
            tasks={tasks}
            tracks={tracks}
            steps={steps}
            layoutPins={layoutPins}
            activeSessionId={activeSession?.id ?? null}
            onNavigate={(to) => navigate(to)}
          />
        ) : showGalaxy ? (
          <div data-galaxy-loading className="galaxy-canvas h-full bg-page" />
        ) : (
          <GoalsListPage />
        )}
      </div>
    </div>
  );
}

export default GoalsPage;
