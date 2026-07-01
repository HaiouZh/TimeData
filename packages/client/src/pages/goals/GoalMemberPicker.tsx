import type { GoalMemberRef, Task, Track, TrackStep } from "@timedata/shared";
import { type FormEvent, useMemo, useState } from "react";
import { allTags } from "../../lib/tasks/turnTags.js";
import { TagFilterPanel } from "../todo/TagFilterPanel.js";
import { GoalCandidateList } from "./GoalCandidateList.js";
import {
  buildGoalTaskCandidates,
  buildGoalTrackCandidates,
  taskCandidateGroups,
  trackCandidateGroups,
} from "./goalMemberCandidates.js";

export interface GoalMemberPickerProps {
  tasks: Task[];
  tracks: Track[];
  steps: TrackStep[];
  members: GoalMemberRef[];
  boardSignals: readonly string[];
  archived: boolean;
  onAddMember: (ref: GoalMemberRef) => void | Promise<void>;
  onQuickCreateTask: (title: string) => void | Promise<void>;
}

type PickerTab = "tasks" | "tracks";
type TagMode = "and" | "or";

const tabButtonClass = "min-h-9 rounded-ctl px-3 td-text-body transition-colors";

function toggleListValue(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

export function GoalMemberPicker({
  tasks,
  tracks,
  steps,
  members,
  boardSignals,
  archived,
  onAddMember,
  onQuickCreateTask,
}: GoalMemberPickerProps) {
  const [tab, setTab] = useState<PickerTab>("tasks");
  const [searchQuery, setSearchQuery] = useState("");
  const [includeTags, setIncludeTags] = useState<string[]>([]);
  const [excludeTags, setExcludeTags] = useState<string[]>([]);
  const [tagMode, setTagMode] = useState<TagMode>("and");
  const [notMode, setNotMode] = useState(false);
  const [quickTitle, setQuickTitle] = useState("");

  const tagOptions = useMemo(() => allTags(tasks), [tasks]);
  const taskCandidates = useMemo(
    () =>
      buildGoalTaskCandidates(tasks, members, {
        now: new Date(),
        searchQuery,
        includeTags,
        excludeTags,
        tagMode,
      }),
    [excludeTags, includeTags, members, searchQuery, tagMode, tasks],
  );
  const trackCandidates = useMemo(
    () => buildGoalTrackCandidates(tracks, steps, members, { searchQuery, boardSignals }),
    [boardSignals, members, searchQuery, steps, tracks],
  );
  const taskGroups = useMemo(() => taskCandidateGroups(taskCandidates), [taskCandidates]);
  const trackGroups = useMemo(() => trackCandidateGroups(trackCandidates), [trackCandidates]);

  function toggleTag(tag: string): void {
    if (notMode) {
      setExcludeTags((values) => toggleListValue(values, tag));
      setIncludeTags((values) => values.filter((item) => item !== tag));
    } else {
      setIncludeTags((values) => toggleListValue(values, tag));
      setExcludeTags((values) => values.filter((item) => item !== tag));
    }
  }

  function submitQuickCreate(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const title = quickTitle.trim();
    if (!title || archived) return;
    void onQuickCreateTask(title);
    setQuickTitle("");
  }

  return (
    <div className="flex min-h-0 flex-col">
      <div className="space-y-3 border-b border-border-hairline px-4 py-3">
        <div className="flex gap-2">
          <button
            type="button"
            aria-pressed={tab === "tasks"}
            onClick={() => setTab("tasks")}
            className={`${tabButtonClass} ${tab === "tasks" ? "bg-accent text-page" : "border border-border text-ink"}`}
          >
            任务
          </button>
          <button
            type="button"
            aria-pressed={tab === "tracks"}
            onClick={() => setTab("tracks")}
            className={`${tabButtonClass} ${tab === "tracks" ? "bg-accent text-page" : "border border-border text-ink"}`}
          >
            轨道
          </button>
        </div>
        <input
          type="search"
          aria-label="搜索成员"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="搜索成员"
          className="min-h-11 w-full rounded-row border border-border bg-surface px-3 td-text-body text-ink outline-none placeholder:text-ink-3 focus:border-accent"
        />
        {tab === "tasks" && (
          <TagFilterPanel
            tags={tagOptions}
            includeTags={includeTags}
            excludeTags={excludeTags}
            tagMode={tagMode}
            notMode={notMode}
            onToggleTag={toggleTag}
            onToggleMode={() => setTagMode((mode) => (mode === "and" ? "or" : "and"))}
            onToggleNotMode={() => setNotMode((value) => !value)}
            onClear={() => {
              setIncludeTags([]);
              setExcludeTags([]);
            }}
            className="max-h-28"
          />
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
        <GoalCandidateList
          tab={tab}
          taskGroups={taskGroups}
          trackGroups={trackGroups}
          emptyLabel="没有可添加成员"
          interaction={{ mode: "click", onSelect: (ref) => void onAddMember(ref) }}
        />
      </div>

      {!archived && (
        <form onSubmit={submitQuickCreate} className="flex items-center gap-2 border-t border-border-hairline px-4 py-3">
          <input
            type="text"
            aria-label="新建任务并加入"
            value={quickTitle}
            onChange={(event) => setQuickTitle(event.target.value)}
            className="min-h-11 min-w-0 flex-1 rounded-row border border-border bg-surface px-3 td-text-body text-ink outline-none placeholder:text-ink-3 focus:border-accent"
            placeholder="新建任务并加入"
          />
          <button type="submit" className="min-h-11 rounded-ctl bg-accent px-4 td-text-body font-medium text-page hover:bg-accent-strong">
            加入
          </button>
        </form>
      )}
    </div>
  );
}
