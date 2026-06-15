import { useMemo, useState } from "react";
import type { MetricChartBlock } from "@timedata/shared";
import { listMetricDefs } from "../../../lib/healthMetrics/index.ts";

export type BuilderDraft = Omit<MetricChartBlock, "id" | "createdAt" | "updatedAt"> & { id?: string };

const ROLLING_PRESETS = [7, 30];

export function ChartBuilderSheet({
  open,
  initial,
  onSave,
  onClose,
  onDelete,
}: {
  open: boolean;
  initial: MetricChartBlock | null;
  onSave: (draft: BuilderDraft) => void;
  onClose: () => void;
  onDelete: (id: string) => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, { id: string; label: string }[]>();
    for (const def of listMetricDefs()) {
      const list = map.get(def.group) ?? [];
      list.push({ id: def.id, label: def.label });
      map.set(def.group, list);
    }
    return [...map.entries()];
  }, []);

  const [title, setTitle] = useState(initial?.title ?? "");
  const [metricIds, setMetricIds] = useState<string[]>(initial?.metricIds ?? []);
  const [chartKind, setChartKind] = useState<MetricChartBlock["chartKind"]>(initial?.chartKind ?? "line");
  const [trendMode, setTrendMode] = useState<MetricChartBlock["trendMode"]>(initial?.trendMode ?? "auto");
  const [rollingWindows, setRollingWindows] = useState<number[]>(initial?.rollingWindows ?? [7]);
  const [showAverageLine, setShowAverageLine] = useState(initial?.showAverageLine ?? false);

  if (!open) return null;

  const barDisabled = metricIds.length > 1;
  const effectiveKind = barDisabled && chartKind === "bar" ? "line" : chartKind;

  function toggleMetric(id: string) {
    setMetricIds((prev) => (prev.includes(id) ? prev.filter((metricId) => metricId !== id) : [...prev, id]));
  }

  function toggleRolling(windowSize: number) {
    setRollingWindows((prev) =>
      prev.includes(windowSize)
        ? prev.filter((item) => item !== windowSize)
        : [...prev, windowSize].sort((left, right) => left - right),
    );
  }

  function handleSave() {
    if (metricIds.length === 0) return;
    onSave({
      id: initial?.id,
      type: "metricChart",
      title: title.trim() || "未命名图表",
      metricIds,
      chartKind: effectiveKind,
      trendMode,
      rollingWindows,
      showAverageLine,
      order: initial?.order ?? Number.MAX_SAFE_INTEGER,
    });
  }

  return (
    <div className="chart-builder-sheet" role="dialog" aria-label="图表搭建">
      <input className="chart-builder-title" placeholder="标题" value={title} onChange={(event) => setTitle(event.target.value)} />

      {groups.map(([group, items]) => (
        <fieldset key={group} className="chart-builder-group">
          <legend>{group}</legend>
          {items.map((item) => (
            <label key={item.id}>
              <input
                type="checkbox"
                aria-label={item.label}
                checked={metricIds.includes(item.id)}
                onChange={() => toggleMetric(item.id)}
              />
              {item.label}
            </label>
          ))}
        </fieldset>
      ))}

      <fieldset className="chart-builder-kind">
        <legend>图表类型</legend>
        {(["line", "area", "bar"] as const).map((kind) => (
          <label key={kind}>
            <input
              type="radio"
              name="chartKind"
              aria-label={kind === "line" ? "折线" : kind === "area" ? "面积" : "柱状"}
              disabled={kind === "bar" && barDisabled}
              checked={effectiveKind === kind}
              onChange={() => setChartKind(kind)}
            />
            {kind === "line" ? "折线" : kind === "area" ? "面积" : "柱状"}
          </label>
        ))}
      </fieldset>

      <label>
        趋势模式
        <select value={trendMode} onChange={(event) => setTrendMode(event.target.value as MetricChartBlock["trendMode"])}>
          <option value="auto">自动</option>
          <option value="normalized">归一化</option>
          <option value="raw">原始值</option>
        </select>
      </label>

      <fieldset className="chart-builder-rolling">
        <legend>滚动均线</legend>
        {ROLLING_PRESETS.map((windowSize) => (
          <label key={windowSize}>
            <input
              type="checkbox"
              aria-label={`${windowSize}日均线`}
              checked={rollingWindows.includes(windowSize)}
              onChange={() => toggleRolling(windowSize)}
            />
            {windowSize}日
          </label>
        ))}
      </fieldset>

      <label>
        <input
          type="checkbox"
          aria-label="平均参考线"
          checked={showAverageLine}
          onChange={(event) => setShowAverageLine(event.target.checked)}
        />
        平均参考线
      </label>

      <div className="chart-builder-actions">
        <button type="button" onClick={handleSave}>
          保存
        </button>
        <button type="button" onClick={onClose}>
          取消
        </button>
        {initial && (
          <button type="button" onClick={() => onDelete(initial.id)}>
            删除
          </button>
        )}
      </div>
    </div>
  );
}
