import type { HealthBlockRange, HealthChartConfig, HealthChartConfigDraft } from "@timedata/shared";
import { useEffect, useMemo, useState } from "react";
import { listMetricDefs } from "../../../lib/healthMetrics/index.ts";

export type BuilderDraft = HealthChartConfigDraft;

const ROLLING_PRESETS = [7, 30];
const RUN_COLUMNS = [
  { id: "distanceKm", label: "距离" },
  { id: "duration", label: "时长" },
  { id: "pace", label: "配速" },
  { id: "averageHeartRate", label: "心率" },
  { id: "city", label: "城市" },
  { id: "type", label: "类型" },
];

type BuilderChoice = "stat" | "chart" | "metricTable" | "runTable";

function choiceFromInitial(initial: HealthChartConfig | null): BuilderChoice {
  if (!initial) return "chart";
  if (initial.view === "stat") return "stat";
  if (initial.view === "chart") return "chart";
  return initial.source === "runs" ? "runTable" : "metricTable";
}

function metricIdsFromInitial(initial: HealthChartConfig | null): string[] {
  if (!initial) return [];
  if (initial.view === "stat" || initial.view === "chart") return initial.metricIds;
  if (initial.source !== "healthMetricDaily") return [];
  return initial.columnIds.filter((columnId) => columnId !== "date" && !columnId.includes(":rolling:"));
}

function runColumnsFromInitial(initial: HealthChartConfig | null): string[] {
  if (initial?.view !== "table" || initial.source !== "runs") return ["date", "pace"];
  return initial.columnIds.filter((columnId) => columnId !== "date");
}

function blockRange(rangeMode: "inherit" | "recent", recentDays: number): HealthBlockRange {
  if (rangeMode === "recent") return { mode: "recent", days: Math.max(1, Math.floor(recentDays) || 30) };
  return { mode: "inherit" };
}

export function ChartBuilderSheet({
  open,
  initial,
  onSave,
  onClose,
  onDelete,
}: {
  open: boolean;
  initial: HealthChartConfig | null;
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

  const [choice, setChoice] = useState<BuilderChoice>(() => choiceFromInitial(initial));
  const [title, setTitle] = useState(initial?.title ?? "");
  const [metricIds, setMetricIds] = useState<string[]>(() => metricIdsFromInitial(initial));
  const [runColumns, setRunColumns] = useState<string[]>(() => runColumnsFromInitial(initial));
  const [rangeMode, setRangeMode] = useState<"inherit" | "recent">(initial?.range.mode === "recent" ? "recent" : "inherit");
  const [recentDays, setRecentDays] = useState(initial?.range.mode === "recent" ? initial.range.days : 30);
  const [chartKind, setChartKind] = useState(initial?.view === "chart" ? initial.chartKind : "line");
  const [trendMode, setTrendMode] = useState(initial?.view === "chart" ? initial.trendMode : "auto");
  const [rollingWindows, setRollingWindows] = useState<number[]>(
    initial?.view === "chart" || (initial?.view === "table" && initial.source === "healthMetricDaily") ? initial.rollingWindows : [7],
  );
  const [showAverageLine, setShowAverageLine] = useState(initial?.view === "chart" ? initial.showAverageLine : false);
  const [showRawColumns, setShowRawColumns] = useState(initial?.view === "table" ? initial.showRawColumns : true);
  const [showRollingColumns, setShowRollingColumns] = useState(initial?.view === "table" ? initial.showRollingColumns : false);
  const [hideEmptyRows, setHideEmptyRows] = useState(initial?.view === "table" ? initial.hideEmptyRows : false);
  const [maxRows, setMaxRows] = useState(initial?.view === "table" ? initial.maxRows : 20);
  const [exportEnabled, setExportEnabled] = useState(initial?.presentation.exportEnabled ?? false);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const selectedMetrics = metricIds;
  const barDisabled = choice === "chart" && selectedMetrics.length > 1;
  const effectiveKind = barDisabled && chartKind === "bar" ? "line" : chartKind;
  const selectedRunColumns = [...new Set(["date", ...runColumns])];
  const titleValue = title.trim() || defaultTitle(choice);

  function toggleMetric(id: string) {
    setMetricIds((prev) => (prev.includes(id) ? prev.filter((metricId) => metricId !== id) : [...prev, id]));
  }

  function toggleRunColumn(id: string) {
    setRunColumns((prev) => (prev.includes(id) ? prev.filter((columnId) => columnId !== id) : [...prev, id]));
  }

  function toggleRolling(windowSize: number) {
    setRollingWindows((prev) =>
      prev.includes(windowSize)
        ? prev.filter((item) => item !== windowSize)
        : [...prev, windowSize].sort((left, right) => left - right),
    );
  }

  function presentation() {
    return {
      exportEnabled,
      colorRules: initial?.presentation.colorRules ?? [],
      height: initial?.presentation.height,
      yAxis: initial?.presentation.yAxis ?? "auto",
    };
  }

  function handleSave() {
    const range = blockRange(rangeMode, recentDays);
    const base = { id: initial?.id, createdAt: initial?.createdAt, title: titleValue, order: initial?.order ?? Number.MAX_SAFE_INTEGER, range, presentation: presentation() };
    if (choice === "stat") {
      if (selectedMetrics.length === 0) return;
      onSave({ ...base, view: "stat", source: "derived", metricIds: selectedMetrics });
      return;
    }
    if (choice === "chart") {
      if (selectedMetrics.length === 0) return;
      onSave({
        ...base,
        view: "chart",
        source: "healthMetricDaily",
        metricIds: selectedMetrics,
        chartKind: effectiveKind,
        trendMode,
        rollingWindows,
        showAverageLine,
      });
      return;
    }
    if (choice === "metricTable") {
      if (selectedMetrics.length === 0) return;
      onSave({
        ...base,
        view: "table",
        source: "healthMetricDaily",
        columnIds: ["date", ...selectedMetrics],
        rollingWindows,
        showRawColumns,
        showRollingColumns,
        hideEmptyRows,
        maxRows,
      });
      return;
    }
    if (runColumns.length === 0) return;
    onSave({
      ...base,
      view: "table",
      source: "runs",
      columnIds: selectedRunColumns,
      rollingWindows: [],
      showRawColumns: true,
      showRollingColumns: false,
      hideEmptyRows,
      maxRows,
    });
  }

  return (
    <div
      className="chart-builder-overlay"
      role="dialog"
      aria-label="视图搭建"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="chart-builder-sheet">
        <button type="button" className="chart-builder-handle" aria-label="关闭" onClick={onClose}>
          <span />
        </button>
        <div className="chart-builder-head">{initial ? "编辑视图" : "新建视图"}</div>

        <div className="chart-builder-body">
          <div className="chart-builder-tabs" role="tablist" aria-label="块类型">
            {(["stat", "chart", "metricTable", "runTable"] as const).map((item) => (
              <button key={item} type="button" aria-pressed={choice === item} onClick={() => setChoice(item)}>
                {choiceLabel(item)}
              </button>
            ))}
          </div>

          <input className="chart-builder-title" placeholder="标题" value={title} onChange={(event) => setTitle(event.target.value)} />

          {choice !== "runTable" ? (
            groups.map(([group, items]) => (
              <fieldset key={group} className="chart-builder-group">
                <legend>{group}</legend>
                {items.map((item) => (
                  <label key={item.id} className="chart-builder-chip">
                    <input
                      type="checkbox"
                      aria-label={item.label}
                      checked={selectedMetrics.includes(item.id)}
                      onChange={() => toggleMetric(item.id)}
                    />
                    {item.label}
                  </label>
                ))}
              </fieldset>
            ))
          ) : (
            <fieldset className="chart-builder-group">
              <legend>跑步字段</legend>
              {RUN_COLUMNS.map((item) => (
                <label key={item.id} className="chart-builder-chip">
                  <input
                    type="checkbox"
                    aria-label={item.label}
                    checked={runColumns.includes(item.id)}
                    onChange={() => toggleRunColumn(item.id)}
                  />
                  {item.label}
                </label>
              ))}
            </fieldset>
          )}

          <fieldset className="chart-builder-kind">
            <legend>时间范围</legend>
            <label className="chart-builder-chip">
              <input type="radio" name="rangeMode" aria-label="继承页面范围" checked={rangeMode === "inherit"} onChange={() => setRangeMode("inherit")} />
              继承页面范围
            </label>
            <label className="chart-builder-chip">
              <input type="radio" name="rangeMode" aria-label="最近天数" checked={rangeMode === "recent"} onChange={() => setRangeMode("recent")} />
              最近
            </label>
            <input
              type="number"
              className="chart-builder-num"
              aria-label="最近天数值"
              min={1}
              value={recentDays}
              onChange={(event) => setRecentDays(Number(event.target.value) || 30)}
            />
          </fieldset>

          {choice === "chart" && (
            <>
              <fieldset className="chart-builder-kind">
                <legend>图表类型</legend>
                {(["line", "area", "bar"] as const).map((kind) => (
                  <label key={kind} className="chart-builder-chip">
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

              <label className="chart-builder-field">
                趋势模式
                <select value={trendMode} onChange={(event) => setTrendMode(event.target.value as "auto" | "normalized" | "raw")}>
                  <option value="auto">自动</option>
                  <option value="normalized">归一化</option>
                  <option value="raw">原始值</option>
                </select>
              </label>

              <label className="chart-builder-switch">
                <input type="checkbox" aria-label="平均参考线" checked={showAverageLine} onChange={(event) => setShowAverageLine(event.target.checked)} />
                平均参考线
              </label>
            </>
          )}

          {(choice === "chart" || choice === "metricTable") && (
            <fieldset className="chart-builder-rolling">
              <legend>滚动均线</legend>
              {ROLLING_PRESETS.map((windowSize) => (
                <label key={windowSize} className="chart-builder-chip">
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
          )}

          {(choice === "metricTable" || choice === "runTable") && (
            <fieldset className="chart-builder-rolling">
              <legend>表格设置</legend>
              {choice === "metricTable" && (
                <>
                  <label className="chart-builder-switch">
                    <input type="checkbox" aria-label="显示原始列" checked={showRawColumns} onChange={(event) => setShowRawColumns(event.target.checked)} />
                    显示原始列
                  </label>
                  <label className="chart-builder-switch">
                    <input type="checkbox" aria-label="显示滚动列" checked={showRollingColumns} onChange={(event) => setShowRollingColumns(event.target.checked)} />
                    显示滚动列
                  </label>
                  <label className="chart-builder-switch">
                    <input type="checkbox" aria-label="隐藏空行" checked={hideEmptyRows} onChange={(event) => setHideEmptyRows(event.target.checked)} />
                    隐藏空行
                  </label>
                </>
              )}
              <label className="chart-builder-field">
                最大行数
                <input
                  type="number"
                  aria-label="最大行数"
                  min={1}
                  value={maxRows ?? ""}
                  onChange={(event) => setMaxRows(event.target.value === "" ? null : Number(event.target.value) || 20)}
                />
              </label>
              <label className="chart-builder-switch">
                <input type="checkbox" aria-label="导出 CSV" checked={exportEnabled} onChange={(event) => setExportEnabled(event.target.checked)} />
                导出 CSV
              </label>
            </fieldset>
          )}

          <div className="chart-builder-summary">{summaryText(choice, titleValue, selectedMetrics.length, selectedRunColumns.length, rollingWindows)}</div>
        </div>

        <div className="chart-builder-actions">
          {initial && (
            <button type="button" className="cb-delete" onClick={() => onDelete(initial.id)}>
              删除
            </button>
          )}
          <span className="cb-spacer" />
          <button type="button" className="cb-cancel" onClick={onClose}>
            取消
          </button>
          <button type="button" className="cb-save" onClick={handleSave}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

function defaultTitle(choice: BuilderChoice): string {
  if (choice === "stat") return "健康摘要";
  if (choice === "metricTable") return "指标表";
  if (choice === "runTable") return "跑步表";
  return "健康趋势";
}

function choiceLabel(choice: BuilderChoice): string {
  if (choice === "stat") return "统计卡";
  if (choice === "metricTable") return "指标表";
  if (choice === "runTable") return "跑步表";
  return "趋势图";
}

function summaryText(choice: BuilderChoice, title: string, metricCount: number, runColumnCount: number, rollingWindows: number[]): string {
  if (choice === "runTable") return `将创建：${title} · ${Math.max(runColumnCount, 1)} 列`;
  const rolling = rollingWindows.length > 0 ? ` · ${rollingWindows.join("/")} 日均线` : "";
  return `将创建：${choiceLabel(choice)} · ${metricCount} 个指标${rolling}`;
}
