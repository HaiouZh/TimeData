import type { TableBlock } from "@timedata/shared";
import type { ChartSeriesRange, HealthMetricCollections } from "../../../lib/healthMetrics/index.ts";
import { buildMetricTableRows, downloadCsv } from "../../../lib/healthBlocks/index.ts";

function metricIdFromColumn(columnId: string): string | null {
  if (columnId === "date") return null;
  const rolling = /^(.*):rolling:\d+$/.exec(columnId);
  return rolling?.[1] ?? columnId;
}

function effectiveMetricColumns(config: TableBlock): { metricIds: string[]; columnIds: string[] } {
  const metricIds = [...new Set(config.columnIds.map(metricIdFromColumn).filter((id): id is string => id != null))];
  const columnIds = ["date"];
  if (config.showRawColumns) columnIds.push(...metricIds);
  if (config.showRollingColumns) {
    for (const metricId of metricIds) {
      for (const windowSize of config.rollingWindows) columnIds.push(`${metricId}:rolling:${windowSize}`);
    }
  }
  return { metricIds, columnIds };
}

export function MetricTableBlock({
  config,
  collections,
  range,
}: {
  config: TableBlock;
  collections: HealthMetricCollections;
  range: ChartSeriesRange;
}) {
  const { metricIds, columnIds } = effectiveMetricColumns(config);
  const table = buildMetricTableRows({
    metricIds,
    columnIds,
    rollingWindows: config.rollingWindows,
    range,
    hideEmptyRows: config.hideEmptyRows,
    maxRows: config.maxRows,
    collections,
  });

  return (
    <section className="health-panel" aria-label={config.title}>
      <div className="health-panel-header">
        <h3 className="health-panel-title">{config.title}</h3>
        {config.presentation.exportEnabled && table.rows.length > 0 && (
          <button type="button" className="health-block-edit" onClick={() => downloadCsv(`${config.title}.csv`, table)}>
            导出 CSV
          </button>
        )}
      </div>
      {table.rows.length === 0 ? (
        <div className="health-empty-inline">当前范围无数据</div>
      ) : (
        <div className="health-table-scroll">
          <table className="health-table">
            <thead>
              <tr>
                {table.columns.map((column) => (
                  <th key={column.id}>{column.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => (
                <tr key={row.id}>
                  {table.columns.map((column) => (
                    <td key={column.id}>{row.cells[column.id]?.formatted ?? "--"}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
