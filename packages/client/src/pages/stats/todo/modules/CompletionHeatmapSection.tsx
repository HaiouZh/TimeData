import { completionEvents } from "../../../../lib/todoStats/events.js";
import { heatmapCells } from "../../../../lib/todoStats/heatmap.js";
import type { TodoStatsModuleProps } from "../types.ts";

const HEATMAP_DAYS = 365;

const LEVEL_CLASS: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: "bg-accent/20",
  1: "bg-accent/40",
  2: "bg-accent/60",
  3: "bg-accent/80",
  4: "bg-accent/100",
};

export default function CompletionHeatmapSection({ today, tasks }: TodoStatsModuleProps) {
  const completedAt = completionEvents(tasks).map((event) => event.completedAt);
  const cells = heatmapCells(completedAt, today, HEATMAP_DAYS);

  return (
    <section className="rounded-card border border-border bg-surface p-4 shadow-elev1">
      <h3 className="td-text-label font-medium text-fg-muted">完成热力图</h3>
      <div className="mt-2 grid grid-flow-col grid-rows-7 gap-0.5 overflow-x-auto">
        {cells.map((cell) => (
          <div
            key={cell.date}
            title={`${cell.date} · ${cell.count}`}
            className={`size-2.5 rounded-[2px] ${LEVEL_CLASS[cell.level]}`}
          />
        ))}
      </div>
    </section>
  );
}
