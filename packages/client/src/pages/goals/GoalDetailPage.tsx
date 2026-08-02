import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate, useParams } from "react-router";
import { listGoalLayoutPins } from "../../lib/goalLayoutPins.js";
import { getGoal } from "../../lib/goals.js";
import { listAllTrackSteps, listTracks } from "../../lib/tracks.js";
import { LoadingState } from "../../components/ui/LoadingState.js";
import { GoalGraphEditor } from "./GoalGraphEditor.js";
import { listAllTasksForGoals } from "./goalPageData.js";

export default function GoalDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const goal = useLiveQuery(async () => (await getGoal(id)) ?? null, [id]);
  const tasks = useLiveQuery(() => listAllTasksForGoals(), []);
  const tracks = useLiveQuery(() => listTracks(), []);
  const steps = useLiveQuery(() => listAllTrackSteps(), []);
  const layoutPins = useLiveQuery(() => listGoalLayoutPins(id), [id]);

  // 与 GoalsPage 的 galaxyReady 同口径：五个 live query 全部返回才挂编辑器。
  // 用 [] 兜底会让 buildGoalOverview 把全部成员判成失效引用、首帧渲染成 ghost 再跳位。
  if (
    goal === undefined ||
    tasks === undefined ||
    tracks === undefined ||
    steps === undefined ||
    layoutPins === undefined
  ) {
    return <LoadingState label="正在加载..." className="min-h-full bg-page px-4 py-6" />;
  }

  if (goal === null) {
    return <div className="min-h-full bg-page px-4 py-6 td-text-body text-ink-3">目标不存在</div>;
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
