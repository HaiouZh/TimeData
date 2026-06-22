import { ArrowLeft, Check, Trash, X } from "@phosphor-icons/react";
import { TaskSchema, type Goal, type Task } from "@timedata/shared";
import { useLiveQuery } from "dexie-react-hooks";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Icon } from "../../components/Icon.js";
import { ConfirmSheet } from "../../components/ui/ConfirmSheet.js";
import { SegmentedControl } from "../../components/ui/SegmentedControl.js";
import { useSyncContext } from "../../contexts/SyncContext.js";
import { db } from "../../db/index.js";
import {
  assignTaskToGoal,
  assignTrackToGoal,
  deleteGoal,
  getGoal,
  listGoalTasks,
  listGoalTracks,
  updateGoal,
  updateGoalPrerequisites,
} from "../../lib/goals.js";
import { buildGoalOverview, type BlockedGoalMember, type GoalMember, type GoalMemberKind } from "../../lib/goalsView.js";
import { listAllTrackSteps, listTracks } from "../../lib/tracks.js";
import { GoalMemberPicker } from "./GoalMemberPicker.js";
import { GoalPrerequisiteEditor } from "./GoalPrerequisiteEditor.js";

const KIND_OPTIONS: Array<{ value: Goal["kind"]; label: string }> = [
  { value: "project", label: "项目" },
  { value: "theme", label: "主题" },
];

const STATUS_OPTIONS: Array<{ value: Goal["status"]; label: string }> = [
  { value: "active", label: "进行中" },
  { value: "archived", label: "归档" },
];

function progressText(goal: Goal, overview: ReturnType<typeof buildGoalOverview>): string {
  const { progress } = overview;
  if (progress.kind === "project") return `完成度 ${progress.completed}/${progress.total}`;
  const last = progress.lastActivityAt ? `，最近 ${progress.lastActivityAt.slice(0, 10)}` : "";
  return `近${progress.windowDays}天 ${progress.activeMemberCount} 个活跃${last}`;
}

function MemberRow({ member, waitingOn }: { member: GoalMember; waitingOn?: GoalMember[] }) {
  return (
    <li className="rounded-row border border-border-hairline bg-surface-elevated px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="rounded-pill bg-surface px-2 py-0.5 text-xs text-ink-3">{member.kind === "task" ? "任务" : "轨道"}</span>
        <p className="min-w-0 flex-1 break-words text-sm text-ink">{member.title}</p>
      </div>
      {waitingOn && waitingOn.length > 0 && (
        <p className="mt-1 text-xs text-ink-3">等：{waitingOn.map((item) => item.title).join("、")}</p>
      )}
    </li>
  );
}

function MemberSection({
  title,
  members,
}: {
  title: string;
  members: Array<GoalMember | BlockedGoalMember>;
}) {
  return (
    <section className="rounded-card border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-ink">{title}</h2>
        <span className="text-xs text-ink-3">{members.length}</span>
      </div>
      {members.length === 0 ? (
        <p className="rounded-row border border-dashed border-border-hairline px-3 py-4 text-center text-sm text-ink-3">
          暂无成员
        </p>
      ) : (
        <ul className="space-y-2">
          {members.map((member) => (
            <MemberRow
              key={`${member.kind}:${member.id}`}
              member={member}
              waitingOn={"waitingOn" in member ? member.waitingOn : undefined}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

async function listAllTasks(): Promise<Task[]> {
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
  const goalTasks = useLiveQuery(() => listGoalTasks(id), [id], []);
  const goalTracks = useLiveQuery(() => listGoalTracks(id), [id], []);
  const allTasks = useLiveQuery(() => listAllTasks(), [], []);
  const allTracks = useLiveQuery(() => listTracks(), [], []);
  const steps = useLiveQuery(() => listAllTrackSteps(), [], []);
  const { syncAfterWrite } = useSyncContext();
  const [titleDraft, setTitleDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (!goal) return;
    setTitleDraft(goal.title);
    setNoteDraft(goal.note ?? "");
  }, [goal]);

  async function saveMeta(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!goal) return;
    await updateGoal(goal.id, {
      title: titleDraft,
      note: noteDraft.trim() ? noteDraft : null,
    });
    syncAfterWrite();
  }

  async function changeKind(kind: Goal["kind"]): Promise<void> {
    if (!goal || goal.kind === kind) return;
    await updateGoal(goal.id, { kind });
    syncAfterWrite();
  }

  async function changeStatus(status: Goal["status"]): Promise<void> {
    if (!goal || goal.status === status) return;
    await updateGoal(goal.id, { status });
    syncAfterWrite();
  }

  async function assignTask(taskId: string): Promise<void> {
    await assignTaskToGoal(taskId, id);
    syncAfterWrite();
  }

  async function assignTrack(trackId: string): Promise<void> {
    await assignTrackToGoal(trackId, id);
    syncAfterWrite();
  }

  async function removeMember(kind: GoalMemberKind, memberId: string): Promise<void> {
    if (goal) {
      const nextPrerequisites = goal.prerequisites.filter((edge) => edge.blocker !== memberId && edge.blocked !== memberId);
      if (nextPrerequisites.length !== goal.prerequisites.length) await updateGoalPrerequisites(goal.id, nextPrerequisites);
    }
    if (kind === "task") await assignTaskToGoal(memberId, null);
    else await assignTrackToGoal(memberId, null);
    syncAfterWrite();
  }

  async function savePrerequisites(next: Goal["prerequisites"]): Promise<void> {
    if (!goal) return;
    await updateGoalPrerequisites(goal.id, next);
    syncAfterWrite();
  }

  async function confirmDelete(): Promise<void> {
    if (!goal) return;
    await deleteGoal(goal.id);
    syncAfterWrite();
    setConfirmingDelete(false);
    navigate("/goals");
  }

  return (
    <div className="min-h-full bg-page text-ink">
      <div className="mx-auto w-full max-w-3xl px-4 py-4 pb-24">
        <Link to="/goals" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-3 hover:text-ink">
          <Icon icon={ArrowLeft} size={16} />
          目标
        </Link>
        {goal === undefined ? (
          <p className="rounded-card bg-surface px-3 py-6 text-center text-sm text-ink-3">正在加载...</p>
        ) : goal === null ? (
          <p className="rounded-card bg-surface px-3 py-6 text-center text-sm text-ink-3">目标不存在</p>
        ) : (
          <GoalContent
            goal={goal}
            goalTasks={goalTasks}
            goalTracks={goalTracks}
            allTasks={allTasks}
            allTracks={allTracks}
            steps={steps}
            titleDraft={titleDraft}
            noteDraft={noteDraft}
            confirmingDelete={confirmingDelete}
            onTitleDraft={setTitleDraft}
            onNoteDraft={setNoteDraft}
            onSaveMeta={saveMeta}
            onChangeKind={(kind) => void changeKind(kind)}
            onChangeStatus={(status) => void changeStatus(status)}
            onAssignTask={(taskId) => void assignTask(taskId)}
            onAssignTrack={(trackId) => void assignTrack(trackId)}
            onRemoveMember={(kind, memberId) => void removeMember(kind, memberId)}
            onSavePrerequisites={(next) => void savePrerequisites(next)}
            onOpenDelete={() => setConfirmingDelete(true)}
            onCancelDelete={() => setConfirmingDelete(false)}
            onConfirmDelete={() => void confirmDelete()}
          />
        )}
      </div>
    </div>
  );
}

interface GoalContentProps {
  goal: Goal;
  goalTasks: Parameters<typeof buildGoalOverview>[1];
  goalTracks: Parameters<typeof buildGoalOverview>[2];
  allTasks: Parameters<typeof GoalMemberPicker>[0]["tasks"];
  allTracks: Parameters<typeof GoalMemberPicker>[0]["tracks"];
  steps: Parameters<typeof buildGoalOverview>[3];
  titleDraft: string;
  noteDraft: string;
  confirmingDelete: boolean;
  onTitleDraft: (value: string) => void;
  onNoteDraft: (value: string) => void;
  onSaveMeta: (event: FormEvent<HTMLFormElement>) => void;
  onChangeKind: (kind: Goal["kind"]) => void;
  onChangeStatus: (status: Goal["status"]) => void;
  onAssignTask: (taskId: string) => void;
  onAssignTrack: (trackId: string) => void;
  onRemoveMember: (kind: GoalMemberKind, memberId: string) => void;
  onSavePrerequisites: (next: Goal["prerequisites"]) => void;
  onOpenDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}

function GoalContent({
  goal,
  goalTasks,
  goalTracks,
  allTasks,
  allTracks,
  steps,
  titleDraft,
  noteDraft,
  confirmingDelete,
  onTitleDraft,
  onNoteDraft,
  onSaveMeta,
  onChangeKind,
  onChangeStatus,
  onAssignTask,
  onAssignTrack,
  onRemoveMember,
  onSavePrerequisites,
  onOpenDelete,
  onCancelDelete,
  onConfirmDelete,
}: GoalContentProps) {
  const overview = buildGoalOverview(goal, goalTasks, goalTracks, steps);

  return (
    <>
      <header className="mb-3 rounded-card border border-border bg-surface p-4">
        <form onSubmit={onSaveMeta} className="space-y-2">
          <input
            value={titleDraft}
            onChange={(event) => onTitleDraft(event.target.value)}
            aria-label="目标标题"
            className="w-full rounded-ctl border border-border bg-surface-elevated px-3 py-2 text-base font-medium text-ink focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <textarea
            value={noteDraft}
            onChange={(event) => onNoteDraft(event.target.value)}
            aria-label="目标备注"
            rows={2}
            placeholder="备注"
            className="w-full resize-none rounded-ctl border border-border bg-surface-elevated px-3 py-2 text-sm leading-6 text-ink placeholder:text-ink-3 focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <div className="flex justify-end">
            <button type="submit" className="inline-flex items-center gap-1 rounded-ctl bg-accent px-3 py-1.5 text-sm text-page">
              <Icon icon={Check} size={16} />
              保存目标
            </button>
          </div>
        </form>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <SegmentedControl ariaLabel="目标类型" value={goal.kind} options={KIND_OPTIONS} onChange={onChangeKind} />
          <SegmentedControl ariaLabel="目标状态" value={goal.status} options={STATUS_OPTIONS} onChange={onChangeStatus} />
        </div>
        <p className="mt-3 rounded-row bg-surface-elevated px-3 py-2 text-sm text-ink-2">{progressText(goal, overview)}</p>
      </header>
      <div className="grid gap-3 md:grid-cols-2">
        <MemberSection title="现在能推进" members={overview.sections.ready} />
        <MemberSection title="在等前置" members={overview.sections.blocked} />
      </div>
      {overview.sections.completed.length > 0 && (
        <div className="mt-3">
          <MemberSection title="已完成" members={overview.sections.completed} />
        </div>
      )}
      {overview.sections.ignoredPrerequisites.length > 0 && (
        <p className="mt-3 rounded-row bg-surface px-3 py-2 text-xs text-ink-3">
          有 {overview.sections.ignoredPrerequisites.length} 条前置关系指向非成员，已在推进分区中忽略。
        </p>
      )}
      <div className="mt-3 grid gap-3">
        <GoalMemberPicker
          goalId={goal.id}
          tasks={allTasks}
          tracks={allTracks}
          members={overview.members}
          onAssignTask={onAssignTask}
          onAssignTrack={onAssignTrack}
          onRemoveMember={onRemoveMember}
        />
        <GoalPrerequisiteEditor
          members={overview.members}
          prerequisites={goal.prerequisites}
          onChange={onSavePrerequisites}
        />
        <section className="rounded-card border border-border bg-surface p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-ink">删除目标</h2>
            <button
              type="button"
              aria-label="删除目标"
              onClick={onOpenDelete}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-ctl bg-surface-elevated text-ink-3 hover:text-danger"
            >
              <Icon icon={Trash} size={18} />
            </button>
          </div>
          <p className="text-sm leading-6 text-ink-3">删除目标只会清空成员归属，不会删除任务或轨道。</p>
        </section>
      </div>
      <ConfirmSheet
        open={confirmingDelete}
        title="删除目标"
        body="目标会被删除，任务和轨道会保留并移出该目标。"
        confirmLabel="删除目标"
        cancelLabel="取消"
        danger
        onCancel={onCancelDelete}
        onConfirm={onConfirmDelete}
      />
    </>
  );
}
