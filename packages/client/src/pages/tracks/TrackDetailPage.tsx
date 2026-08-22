import { Check, X } from "@phosphor-icons/react";
import { useLiveQuery } from "dexie-react-hooks";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { Icon } from "../../components/Icon.js";
import { OverflowMenu } from "../../components/ui/OverflowMenu.js";
import { LoadingState } from "../../components/ui/LoadingState.js";
import { PageBackButton } from "../../components/ui/PageBackButton.js";
import { StatusBanner } from "../../components/ui/StatusBanner.js";
import { useConfirm } from "../../hooks/useConfirm.tsx";
import { useTrackActionTags } from "../../lib/settings/trackActionTagsSetting.js";
import {
  appendUserStep,
  closeCurrentStep,
  deleteTrack,
  deleteTrackStep,
  getTrack,
  listTrackSteps,
  setTrackStatus,
  updateTrack,
  updateTrackStep,
} from "../../lib/tracks.js";
import { currentStepId, latestStep } from "../../lib/tracksView.js";
import { CollapsibleSection } from "../todo/CollapsibleSection.js";
import { CurrentFrameCard } from "./CurrentFrameCard.js";
import { RefChip } from "./RefChip.js";
import { StepComposer, type StepDraft } from "./StepComposer.js";
import { TrackTimeline } from "./TrackTimeline.js";
import { MilestoneBar } from "./workbench/MilestoneBar.js";
import { MilestonePanel } from "./workbench/MilestonePanel.js";
import { SignalSwitcher } from "./workbench/SignalSwitcher.js";
import { listTrackMilestones } from "../../lib/trackMilestones.js";

const STATUS_LABEL: Record<string, string> = { active: "推进中", concluded: "已归档", parked: "已归档" };

export default function TrackDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  // ?? null 把三态分开:undefined=查询未落(加载中)、null=查到但不存在、实体=命中。
  const track = useLiveQuery(async () => (await getTrack(id)) ?? null, [id]);
  const steps = useLiveQuery(() => listTrackSteps(id), [id], []);
  const milestones = useLiveQuery(() => listTrackMilestones(id), [id], []) ?? [];
  const actionTags = useTrackActionTags();
  const [editingMeta, setEditingMeta] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [summaryDraft, setSummaryDraft] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [milestonesExpanded, setMilestonesExpanded] = useState(false);
  const { confirm, dialog } = useConfirm();

  const isActive = track != null && track.status === "active";
  const hasOpenStep = currentStepId(steps) !== null;
  const location = useLocation();
  const highlightStepId = location.hash.startsWith("#step-") ? location.hash.slice("#step-".length) : null;
  const latest = latestStep(steps);
  const history = useMemo(() => steps.filter((s) => s.id !== latest?.id), [steps, latest?.id]);

  useEffect(() => {
    if (!highlightStepId || steps.length === 0) return;
    // jsdom 无 scrollIntoView 实现，可选调用
    document.getElementById(`step-${highlightStepId}`)?.scrollIntoView?.({ block: "center" });
  }, [highlightStepId, steps.length]);

  useEffect(() => {
    if (!track || editingMeta) return;
    setTitleDraft(track.title);
    setSummaryDraft(track.summary ?? "");
  }, [editingMeta, track]);

  async function addStep(draft: StepDraft): Promise<void> {
    if (!track) return;
    await appendUserStep({ trackId: track.id, content: draft.content, mode: draft.mode, tags: draft.tags });
  }

  async function closeStep(): Promise<void> {
    if (!track) return;
    try {
      await closeCurrentStep(track.id);
      setActionError(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "闭合失败，请重试");
    }
  }

  async function changeStatus(status: "active" | "concluded"): Promise<void> {
    if (!track || track.status === status) return;
    try {
      await setTrackStatus(track.id, status);
      setActionError(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "状态更新失败，请重试");
    }
  }

  async function editStep(stepId: string, content: string): Promise<void> {
    try {
      await updateTrackStep(stepId, { content });
      setActionError(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "步骤保存失败，请重试");
    }
  }

  async function removeStep(stepId: string): Promise<void> {
    try {
      await deleteTrackStep(stepId);
      setActionError(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "步骤删除失败，请重试");
    }
  }

  async function removeTrack(): Promise<void> {
    if (!track) return;
    // 删轨道会连带删掉它下面所有步骤，误触一次就没了——比「删一条步骤」重得多，走弹层。
    if (
      !(await confirm({
        title: "删除轨道？",
        body: `「${track.title}」及其下全部步骤将一并删除，无法恢复。`,
        danger: true,
      }))
    )
      return;
    try {
      await deleteTrack(track.id);
      setActionError(null);
      navigate("/tracks");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "轨道删除失败，请重试");
    }
  }

  async function saveMeta(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!track) return;
    try {
      await updateTrack(track.id, {
        title: titleDraft,
        summary: summaryDraft.trim() ? summaryDraft : null,
      });
      setActionError(null);
      setEditingMeta(false);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "保存失败，请重试");
    }
  }

  function cancelMetaEdit(): void {
    if (!track) return;
    setTitleDraft(track.title);
    setSummaryDraft(track.summary ?? "");
    setEditingMeta(false);
  }

  return (
    <div className="min-h-full bg-page text-ink">
      {dialog}
      <div className="mx-auto w-full max-w-3xl xl:max-w-6xl px-4 py-4 pb-24">
        <div className="mb-3">
          <PageBackButton to="/tracks" label="轨道" />
        </div>
        {track === undefined ? (
          <LoadingState label="正在加载..." className="rounded-card bg-surface px-3 py-6" />
        ) : track === null ? (
          <p className="rounded-card bg-surface px-3 py-6 text-center td-text-body text-ink-3">轨道不存在</p>
        ) : (
          <>
            <header className="mb-6 border-b border-border pb-4">
              {editingMeta ? (
                <form onSubmit={(event) => void saveMeta(event)} className="space-y-2">
                  <input
                    value={titleDraft}
                    onChange={(event) => setTitleDraft(event.target.value)}
                    aria-label="轨道标题"
                    className="w-full rounded-ctl border border-border bg-surface-elevated px-3 py-2 text-ink focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <textarea
                    value={summaryDraft}
                    onChange={(event) => setSummaryDraft(event.target.value)}
                    aria-label="轨道摘要"
                    rows={2}
                    className="w-full resize-none rounded-ctl border border-border bg-surface-elevated px-3 py-2 text-ink focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={cancelMetaEdit}
                      className="inline-flex items-center gap-1 rounded-ctl border border-border px-4 py-2 td-text-label text-ink-2 hover:text-ink"
                    >
                      <Icon icon={X} size={16} />
                      取消
                    </button>
                    <button
                      type="submit"
                      className="inline-flex items-center gap-1 rounded-ctl bg-accent px-4 py-2 td-text-label text-accent-contrast"
                    >
                      <Icon icon={Check} size={16} />
                      保存轨道
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={`h-2 w-2 shrink-0 rounded-pill ${track.status === "active" ? "bg-accent" : "bg-ink-3"}`}
                    />
                    <h1 className="min-w-0 flex-1 td-text-title break-words text-ink">{track.title}</h1>
                    <span className="shrink-0 td-text-caption text-ink-2">{STATUS_LABEL[track.status] ?? track.status}</span>
                    <OverflowMenu
                      ariaLabel="轨道操作"
                      items={[
                        { key: "edit", label: "编辑轨道", onSelect: () => setEditingMeta(true) },
                        track.status === "active"
                          ? { key: "archive", label: "归档", onSelect: () => void changeStatus("concluded") }
                          : { key: "resume", label: "重新推进", onSelect: () => void changeStatus("active") },
                        { key: "remove", label: "删除轨道", onSelect: () => void removeTrack(), danger: true },
                      ]}
                    />
                  </div>
                  {track.summary && <p className="mt-2 td-text-body text-ink-2">{track.summary}</p>}
                  {track.refs.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {track.refs.map((refItem) => (
                        <RefChip key={`${refItem.kind}:${refItem.id}`} refItem={refItem} />
                      ))}
                    </div>
                  )}
                </>
              )}
            </header>
            {actionError && (
              <StatusBanner tone="danger" role="alert" className="mb-3">
                {actionError}
              </StatusBanner>
            )}
            <div className="mb-6 flex flex-col gap-4 border-y border-border py-4">
              <div className="flex flex-wrap items-center gap-4">
                <SignalSwitcher track={track} steps={steps} onError={setActionError} />
                <span aria-hidden="true" className="hidden h-4 w-px bg-border sm:block" />
                <MilestoneBar
                  milestones={milestones}
                  expanded={milestonesExpanded}
                  onToggle={() => setMilestonesExpanded((v) => !v)}
                  readOnly={track.status !== "active"}
                />
              </div>
              <MilestonePanel
                trackId={track.id}
                milestones={milestones}
                expanded={milestonesExpanded}
                readOnly={track.status !== "active"}
                onError={setActionError}
              />
            </div>
            <div data-testid="detail-narrative">
                {latest ? (
                  <CurrentFrameCard key={latest.id} step={latest} onEdit={editStep} onDelete={removeStep} />
                ) : (
                  <p className="mb-3 rounded-card bg-surface px-3 py-6 td-text-body text-center text-ink-3">尚无步骤</p>
                )}
                {isActive && (
                  <StepComposer
                    onSubmit={(draft) => addStep(draft)}
                    statusTags={actionTags}
                    onCloseStep={() => void closeStep()}
                    canCloseStep={hasOpenStep}
                  />
                )}
                {history.length > 0 && (
                  <CollapsibleSection title="历史" count={history.length} defaultOpen>
                    <TrackTimeline
                      steps={history}
                      highlightStepId={highlightStepId}
                      onEditStep={editStep}
                      onDeleteStep={removeStep}
                    />
                  </CollapsibleSection>
                )}
              </div>
          </>
        )}
      </div>
    </div>
  );
}
