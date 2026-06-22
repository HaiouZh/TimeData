import { TaskSchema } from "@timedata/shared";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../db/index.js";
import { addGoal, listGoals } from "../../lib/goals.js";
import { buildGoalOverview } from "../../lib/goalsView.js";
import { listAllTrackSteps, listTracks } from "../../lib/tracks.js";
import { useSyncContext } from "../../contexts/SyncContext.js";
import { CollapsibleSection } from "../todo/CollapsibleSection.js";
import { GoalListItem } from "./GoalListItem.js";
import { NewGoalComposer } from "./NewGoalComposer.js";

export default function GoalsListPage() {
  const goals = useLiveQuery(() => listGoals(), [], []);
  const tasks = useLiveQuery(async () => {
    const rows = await db.tasks.toArray();
    return rows.flatMap((row) => {
      const parsed = TaskSchema.safeParse(row);
      return parsed.success ? [parsed.data] : [];
    });
  }, [], []);
  const tracks = useLiveQuery(() => listTracks(), [], []);
  const steps = useLiveQuery(() => listAllTrackSteps(), [], []);
  const { syncAfterWrite } = useSyncContext();

  const overviews = goals.map((goal) => buildGoalOverview(goal, tasks, tracks, steps));
  const active = overviews.filter((overview) => overview.goal.status === "active");
  const archived = overviews.filter((overview) => overview.goal.status === "archived");

  async function create(input: { title: string; kind: "project" | "theme" }): Promise<void> {
    await addGoal(input);
    syncAfterWrite();
  }

  return (
    <div className="min-h-full bg-page text-ink">
      <div className="mx-auto w-full max-w-2xl px-4 py-4 pb-24">
        <NewGoalComposer onCreate={(input) => void create(input)} />
        {active.length === 0 ? (
          <p className="rounded-card bg-surface px-3 py-6 text-center text-sm text-ink-3">还没有进行中的目标</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {active.map((overview) => (
              <li key={overview.goal.id}>
                <GoalListItem overview={overview} />
              </li>
            ))}
          </ul>
        )}
        {archived.length > 0 && (
          <div className="mt-4">
            <CollapsibleSection title="已归档" count={archived.length}>
              <ul className="flex flex-col gap-2">
                {archived.map((overview) => (
                  <li key={overview.goal.id}>
                    <GoalListItem overview={overview} />
                  </li>
                ))}
              </ul>
            </CollapsibleSection>
          </div>
        )}
      </div>
    </div>
  );
}
