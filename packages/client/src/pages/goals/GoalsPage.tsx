import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listAllGoalLayoutPins } from "../../lib/goalLayoutPins.js";
import { listGoals } from "../../lib/goals.js";
import { listAllTrackSteps, listTracks } from "../../lib/tracks.js";
import { useIsWideScreen } from "../../lib/useIsWideScreen.js";
import { GoalGalaxyCanvas } from "./GoalGalaxyCanvas.js";
import { listAllTasksForGoals } from "./goalPageData.js";
import GoalsListPage from "./GoalsListPage.js";

type GoalsViewMode = "galaxy" | "list";

export function GoalsPage() {
  const wide = useIsWideScreen();
  const navigate = useNavigate();
  const [mode, setMode] = useState<GoalsViewMode>(() => (wide ? "galaxy" : "list"));
  const goals = useLiveQuery(() => listGoals(), []);
  const tasks = useLiveQuery(() => listAllTasksForGoals(), []);
  const tracks = useLiveQuery(() => listTracks(), []);
  const steps = useLiveQuery(() => listAllTrackSteps(), []);
  const layoutPins = useLiveQuery(() => listAllGoalLayoutPins(), []);
  const galaxyReady =
    goals !== undefined &&
    tasks !== undefined &&
    tracks !== undefined &&
    steps !== undefined &&
    layoutPins !== undefined;

  useEffect(() => {
    setMode(wide ? "galaxy" : "list");
  }, [wide]);

  const showGalaxy = mode === "galaxy";

  return (
    <div className="flex h-full min-h-full flex-col bg-page text-ink">
      <div className="flex shrink-0 justify-end px-4 py-3">
        <div className="inline-flex rounded-pill border border-border bg-surface-elevated p-1 shadow-sm" role="tablist" aria-label="目标视图">
          <button
            type="button"
            role="tab"
            aria-label="切换到目标星图"
            aria-selected={showGalaxy}
            onClick={() => setMode("galaxy")}
            className={`min-h-8 rounded-pill px-3 text-sm ${showGalaxy ? "bg-accent text-page" : "text-ink-2 hover:bg-surface-hover"}`}
          >
            星图
          </button>
          <button
            type="button"
            role="tab"
            aria-label="切换到目标列表"
            aria-selected={!showGalaxy}
            onClick={() => setMode("list")}
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
            onNavigate={(to) => navigate(to)}
          />
        ) : showGalaxy ? (
          <div data-galaxy-loading className="h-full min-h-[520px] bg-page" />
        ) : (
          <GoalsListPage />
        )}
      </div>
    </div>
  );
}

export default GoalsPage;
