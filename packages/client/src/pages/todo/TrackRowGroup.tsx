import type { TodoTrackRow } from "../../lib/tasks/todoTrackRows.js";
import { getTodoTrackGroupCollapsed, setTodoTrackGroupCollapsed } from "../../lib/tasks/workbenchPrefs.js";
import { CollapsibleSection } from "./CollapsibleSection.js";
import { TrackRow } from "./TrackRow.js";

/**
 * 今天区里的轨道组。「在等」区**不套本组**——那区内容全是轨道，区本身即组。
 * 本组整体渲染在 `TaskList` 的 `SortableContext` 之外（由 `TaskColumn` 的 `extra` 插槽保证）：
 * `verticalListSortingStrategy` 按 DOM 顺序算位置，夹进任务行之间会扰乱计算。
 */
export function TrackRowGroup({ rows }: { rows: TodoTrackRow[] }) {
  if (rows.length === 0) return null;
  return (
    <CollapsibleSection
      title="轨道"
      count={rows.length}
      defaultOpen={!getTodoTrackGroupCollapsed()}
      onToggle={(open) => setTodoTrackGroupCollapsed(!open)}
    >
      {rows.map((row) => (
        <TrackRow key={row.track.id} row={row} />
      ))}
    </CollapsibleSection>
  );
}
