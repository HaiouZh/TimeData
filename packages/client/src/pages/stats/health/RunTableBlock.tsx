import type { HealthRun, TableBlock } from "@timedata/shared";
import { buildRunTableRows, downloadCsv } from "../../../lib/healthBlocks/index.ts";
import type { ChartSeriesRange } from "../../../lib/healthMetrics/index.ts";

export function RunTableBlock({ config, runs, range }: { config: TableBlock; runs: readonly HealthRun[]; range: ChartSeriesRange }) {
  const table = buildRunTableRows({ runs, columnIds: config.columnIds, range, maxRows: config.maxRows });

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
