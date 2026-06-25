import { TaskSchema } from "@timedata/shared";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate, useParams } from "react-router-dom";
import { db } from "../../db/index.js";
import { listGoalLayoutPins } from "../../lib/goalLayoutPins.js";
import { getGoal } from "../../lib/goals.js";
import { listAllTrackSteps, listTracks } from "../../lib/tracks.js";
import { GoalGraphEditor } from "./GoalGraphEditor.js";

async function listAllTasks() {
  const rows = await db.tasks.toArray();
  return rows.flatMap((row) => {
    const parsed = TaskSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

export default function GoalDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const goal = useLiveQuery(async () => (await getGoal(id)) ?? null, [id]);
  const tasks = useLiveQuery(() => listAllTasks(), [], []);
  const tracks = useLiveQuery(() => listTracks(), [], []);
  const steps = useLiveQuery(() => listAllTrackSteps(), [], []);
  const layoutPins = useLiveQuery(() => listGoalLayoutPins(id), [id]);

  if (goal === undefined || layoutPins === undefined) {
    return <div className="min-h-full bg-page px-4 py-6 text-sm text-ink-3">正在加载...</div>;
  }

  if (goal === null) {
    return <div className="min-h-full bg-page px-4 py-6 text-sm text-ink-3">目标不存在</div>;
  }

  return (
    <div className="h-full min-h-full bg-page text-ink">
      <GoalGraphEditor
        goal={goal}
        tasks={tasks}
        tracks={tracks}
        steps={steps}
        layoutPins={layoutPins}
        onNavigate={(to) => navigate(to)}
        onDeletedGoal={() => navigate("/goals")}
      />
    </div>
  );
}
