import type { TodoTrackRow } from "../../lib/tasks/todoTrackRows.js";
import { TrackRow } from "./TrackRow.js";

/**
 * 「在等」区：只装停滞轨道。
 *
 * 准入判据只有一条——**轨道且落 waiting**，不收任务：排期过期与重力沉降的任务都留在收件箱，
 * 否则同一条任务会在两处出现、两套「多久算旧」的口径各调各的。
 *
 * 本区**不套折叠组**（今天区的轨道才套）：整区即轨道，再套一层折叠是多余嵌套。
 * 空区整块不渲染——没有停滞轨道时不留一个空标题在那儿。
 */
export function WaitingSection({ rows }: { rows: TodoTrackRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section data-testid="todo-section-waiting" data-section="waiting">
      <div className="mb-2 flex items-baseline justify-between px-2">
        <h2 className="td-text-label font-medium text-ink">在等</h2>
        <span className="td-text-caption text-ink-3">{rows.length}</span>
      </div>
      <div className="rounded-card p-1.5">
        {rows.map((row) => (
          <TrackRow key={row.track.id} row={row} />
        ))}
      </div>
    </section>
  );
}
