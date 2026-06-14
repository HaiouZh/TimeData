import { useLiveQuery } from "dexie-react-hooks";
import { useCallback, useMemo, useState } from "react";
import type { HealthSleep } from "@timedata/shared";
import { db } from "../../../db/index.ts";
import { filterByDateRange, computeSleepDuration } from "../../../lib/healthUtils.ts";
import { TrendChart } from "../InsightCharts.tsx";

const DEFAULT_VISIBLE = 10;

function SleepRecordRow({
  record,
  isEditing,
  onEdit,
  onCancel,
  onSave,
}: {
  record: HealthSleep;
  isEditing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (value: number) => void;
}) {
  const [draft, setDraft] = useState(record.adjustmentHours);
  const duration = computeSleepDuration(record);

  // Preview duration with the draft adjustmentHours value
  const previewDuration = useMemo(() => {
    const preview = { ...record, adjustmentHours: draft };
    return computeSleepDuration(preview);
  }, [record, draft]);

  const handleStartEdit = useCallback(() => {
    setDraft(record.adjustmentHours);
    onEdit();
  }, [record.adjustmentHours, onEdit]);

  return (
    <>
      <tr className="sleep-record-row">
        <td>{record.date}</td>
        <td>{record.sleepStart}</td>
        <td>{record.wakeTime}</td>
        <td>{(Math.round(duration * 10) / 10).toFixed(1)}h</td>
        <td>{record.adjustmentHours}</td>
        <td>
          <button
            className="sleep-edit-btn"
            onClick={handleStartEdit}
            title="编辑调整时长"
            aria-label="编辑调整时长"
          >
            ✏️
          </button>
        </td>
      </tr>
      {isEditing && (
        <tr className="sleep-editor-row">
          <td colSpan={6}>
            <div className="sleep-editor">
              <label>
                调整时长（小时）：
                <input
                  type="number"
                  min={-12}
                  max={12}
                  step={0.1}
                  value={draft}
                  onChange={(e) => setDraft(Number(e.target.value))}
                />
              </label>
              <span className="sleep-editor-preview">
                预计总时长：{(Math.round(previewDuration * 10) / 10).toFixed(1)}h
              </span>
              <div className="sleep-editor-actions">
                <button className="sleep-editor-save" onClick={() => onSave(draft)}>
                  保存
                </button>
                <button className="sleep-editor-cancel" onClick={onCancel}>
                  取消
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function SleepCard({ range }: { range: "30" | "90" | "all" }) {
  const allData = useLiveQuery(() => db.healthSleep.orderBy("date").toArray()) ?? [];
  const data = useMemo(() => filterByDateRange(allData, range), [allData, range]);

  const chartData = useMemo(
    () =>
      [...data]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((s) => ({ date: s.date, 睡眠时长: Math.round(computeSleepDuration(s) * 10) / 10 })),
    [data],
  );

  // Records sorted newest-first for the list
  const listRecords = useMemo(
    () => [...data].sort((a, b) => b.date.localeCompare(a.date)),
    [data],
  );

  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const visibleRecords = showAll ? listRecords : listRecords.slice(0, DEFAULT_VISIBLE);
  const hasMore = listRecords.length > DEFAULT_VISIBLE;

  const handleSave = useCallback(async (record: HealthSleep, newValue: number) => {
    await db.transaction("rw", [db.healthSleep, db.syncLog], async () => {
      const now = new Date().toISOString();
      const updated: HealthSleep = { ...record, adjustmentHours: newValue, updatedAt: now };
      await db.healthSleep.put(updated);
      await db.syncLog.add({
        id: crypto.randomUUID(),
        tableName: "health_sleep",
        recordId: record.id,
        action: "update",
        timestamp: now,
        synced: 0,
      });
    });
    setEditingId(null);
  }, []);

  if (data.length === 0) return <div className="health-card empty">暂无睡眠数据</div>;

  const latest = chartData[chartData.length - 1];

  return (
    <div className="health-card">
      <div className="health-card-header">
        <span className="health-card-icon">🌙</span>
        <h3>睡眠</h3>
        {latest != null && <span className="health-card-value">{latest.睡眠时长.toFixed(1)}h</span>}
      </div>
      <TrendChart
        chart="area"
        data={chartData}
        series={[{ key: "睡眠时长", color: "#818cf8" }]}
      />

      {/* Sleep record list */}
      <div className="sleep-record-list">
        <table className="sleep-record-table">
          <thead>
            <tr>
              <th>日期</th>
              <th>入睡</th>
              <th>起床</th>
              <th>时长</th>
              <th>调整</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visibleRecords.map((record) => (
              <SleepRecordRow
                key={record.id}
                record={record}
                isEditing={editingId === record.id}
                onEdit={() => setEditingId(record.id)}
                onCancel={() => setEditingId(null)}
                onSave={(value) => void handleSave(record, value)}
              />
            ))}
          </tbody>
        </table>
        {hasMore && (
          <button
            className="sleep-show-more"
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? "收起" : `显示全部 (${listRecords.length})`}
          </button>
        )}
      </div>
    </div>
  );
}
