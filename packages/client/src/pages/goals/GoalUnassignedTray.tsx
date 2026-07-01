import type { GoalMemberRef, Task, Track, TrackStep } from "@timedata/shared";
import { useMemo, useState } from "react";
import { allTags } from "../../lib/tasks/turnTags.js";
import { TagFilterPanel } from "../todo/TagFilterPanel.js";
import { GoalCandidateList } from "./GoalCandidateList.js";
import {
  buildGoalTaskCandidates,
  buildGoalTrackCandidates,
  taskCandidateGroups,
  trackCandidateGroups,
} from "./goalMemberCandidates.js";

export interface GoalUnassignedTrayProps {
  tasks: Task[];
  tracks: Track[];
  steps: TrackStep[];
  boardSignals: readonly string[];
}

type TrayTab = "tasks" | "tracks";
type TagMode = "and" | "or";

const tabButtonClass = "min-h-9 rounded-ctl px-3 td-text-body transition-colors";
const NO_MEMBERS: GoalMemberRef[] = [];

function toggleListValue(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

export function GoalUnassignedTray({ tasks, tracks, steps, boardSignals }: GoalUnassignedTrayProps) {
  const [tab, setTab] = useState<TrayTab>("tasks");
  const [searchQuery, setSearchQuery] = useState("");
  const [includeTags, setIncludeTags] = useState<string[]>([]);
  const [excludeTags, setExcludeTags] = useState<string[]>([]);
  const [tagMode, setTagMode] = useState<TagMode>("and");
  const [notMode, setNotMode] = useState(false);

  const tagOptions = useMemo(() => allTags(tasks.filter((task) => !task.done)), [tasks]);
  const taskCandidates = useMemo(
    () =>
      buildGoalTaskCandidates(tasks, NO_MEMBERS, {
        now: new Date(),
        searchQuery,
        includeTags,
        excludeTags,
        tagMode,
      }),
    [excludeTags, includeTags, searchQuery, tagMode, tasks],
  );
  const trackCandidates = useMemo(
    () => buildGoalTrackCandidates(tracks, steps, NO_MEMBERS, { searchQuery, boardSignals }),
    [boardSignals, searchQuery, steps, tracks],
  );
  const taskGroups = useMemo(() => taskCandidateGroups(taskCandidates), [taskCandidates]);
  const trackGroups = useMemo(() => trackCandidateGroups(trackCandidates), [trackCandidates]);
  const total = taskCandidates.length + trackCandidates.length;

  function toggleTag(tag: string): void {
    if (notMode) {
      setExcludeTags((values) => toggleListValue(values, tag));
      setIncludeTags((values) => values.filter((item) => item !== tag));
    } else {
      setIncludeTags((values) => toggleListValue(values, tag));
      setExcludeTags((values) => values.filter((item) => item !== tag));
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-elevated text-ink">
      <div className="space-y-3 border-b border-border-hairline px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="td-text-body font-medium text-ink">未归类</h2>
          <span className="rounded-pill bg-accent-soft px-2 py-1 td-text-caption tabular-nums text-accent">{total}</span>
        </div>
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
          aria-label="搜索未归类项"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="搜索未归类项"
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
          emptyLabel="没有未归类项"
          interaction={{ mode: "drag" }}
        />
      </div>
    </div>
  );
}
