import { useCallback, useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiFetch } from "../../../../lib/api.ts";
import { deletedStats, type ArchiveItem, type DeletedStats } from "../../../../lib/todoStats/deletedStats.ts";

interface DeletedArchiveResponse {
  items: ArchiveItem[];
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; stats: DeletedStats };

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "加载删除归档失败";
}

export default function DeletedInsightsSection() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  const load = useCallback(() => {
    setState({ status: "loading" });
    apiFetch<DeletedArchiveResponse>("/api/tasks/deleted-archive")
      .then((res) => {
        setState({ status: "success", stats: deletedStats(res.items) });
      })
      .catch((error: unknown) => {
        setState({ status: "error", message: formatError(error) });
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="rounded-card border border-border bg-surface p-4 shadow-elev1">
      <h3 className="td-text-label font-medium text-ink-2">删除洞察</h3>
      <p className="mt-1 td-text-caption text-ink-3">删除数据自 2026-07-12 归档上线起算</p>

      {state.status === "loading" && (
        <div className="mt-2 space-y-2" aria-busy="true">
          <div className="h-4 w-1/3 animate-pulse rounded bg-surface-hover" />
          <div className="h-32 animate-pulse rounded bg-surface-hover" />
        </div>
      )}

      {state.status === "error" && (
        <div className="mt-2 space-y-2 rounded-row border border-danger/40 bg-danger/10 p-3">
          <p className="td-text-caption text-danger">{state.message}</p>
          <button
            type="button"
            onClick={load}
            className="min-h-11 rounded-ctl border border-border bg-surface px-3 py-1.5 td-text-caption font-medium text-ink-2 transition-colors hover:bg-surface-hover"
          >
            重试
          </button>
        </div>
      )}

      {state.status === "success" && (
        <div className="mt-2 space-y-3">
          <p className="td-text-caption text-ink-3">
            累计删除 {state.stats.total} 条 · 完成后删除 {state.stats.deletedAfterDone} 条
          </p>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={state.stats.byWeek}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="weekStart" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="count" name="按周删除数" fill="var(--color-accent)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 td-text-caption text-ink-3">
            {state.stats.byReason.map((entry) => (
              <div key={entry.reason} className="flex items-center justify-between">
                <span>{entry.reason}</span>
                <span>{entry.count}</span>
              </div>
            ))}
          </div>
          <div className="space-y-1">
            {state.stats.survivalBuckets.map((bucket) => {
              const max = Math.max(1, ...state.stats.survivalBuckets.map((b) => b.count));
              return (
                <div key={bucket.label} className="flex items-center gap-2 td-text-caption text-ink-3">
                  <span className="w-16 shrink-0">{bucket.label}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-pill bg-surface-hover">
                    <div
                      className="h-full rounded-pill bg-accent"
                      style={{ width: `${(bucket.count / max) * 100}%` }}
                    />
                  </div>
                  <span className="w-8 shrink-0 text-right">{bucket.count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
