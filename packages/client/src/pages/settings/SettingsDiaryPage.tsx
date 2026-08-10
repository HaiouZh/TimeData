import { useEffect, useState } from "react";
import { StatusBanner } from "../../components/ui/StatusBanner.js";
import { ApiError } from "../../lib/api.js";
import { fetchDiaryConfig, saveDiaryTemplate, saveDiaryWeeklyTemplate } from "../../lib/diary/diaryApi.js";
import SettingsDetailPage from "./SettingsDetailPage.tsx";

const TEMPLATE_EXAMPLE = "日记_{yyyy}/Day/{yyyy}年{MM}月/{yyyy}-{MM}-{dd}.md";
const WEEKLY_TEMPLATE_EXAMPLE = "Reviews/{gggg}/{gggg}-W{ww}.md";

function extractServerMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string; message?: string } | null;
    return body?.error ?? body?.message ?? err.message;
  }
  return err instanceof Error ? err.message : "保存失败";
}

export default function SettingsDiaryPage() {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [template, setTemplate] = useState("");
  const [weeklyTemplate, setWeeklyTemplate] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [weeklySaving, setWeeklySaving] = useState(false);
  const [weeklyMessage, setWeeklyMessage] = useState("");
  const [weeklyError, setWeeklyError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchDiaryConfig()
      .then((config) => {
        if (cancelled) return;
        setEnabled(config.enabled);
        setTemplate(config.template);
        setWeeklyTemplate(config.weeklyTemplate);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(extractServerMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setMessage("");
    setError("");
    try {
      await saveDiaryTemplate(template);
      setMessage("模板已保存");
    } catch (err) {
      setError(extractServerMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveWeekly() {
    if (weeklySaving) return;
    setWeeklySaving(true);
    setWeeklyMessage("");
    setWeeklyError("");
    try {
      await saveDiaryWeeklyTemplate(weeklyTemplate);
      setWeeklyMessage("模板已保存");
    } catch (err) {
      setWeeklyError(extractServerMessage(err));
    } finally {
      setWeeklySaving(false);
    }
  }

  return (
    <SettingsDetailPage title="日记">
      {loading ? (
        <p className="td-text-body text-ink-3">加载中…</p>
      ) : (
        <div className="space-y-4">
          {!enabled && (
            <StatusBanner tone="warn">
              服务器未挂载日记 vault（DIARY_VAULT_DIR），保存的模板暂时不会生效
            </StatusBanner>
          )}

          <div className="space-y-3 rounded-card border border-border bg-surface p-4">
            <label className="block">
              <span className="td-text-caption text-ink-3">日记路径模板</span>
              <textarea
                name="template"
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                rows={3}
                className="mt-1 block w-full resize-none rounded-row border border-border bg-surface px-3 py-2 text-ink placeholder-ink-3 focus:border-accent focus:outline-none"
                placeholder={TEMPLATE_EXAMPLE}
              />
            </label>
            <p className="td-text-caption text-ink-3">
              占位符会按当天日期展开：{"{yyyy}"} 年、{"{MM}"} 月、{"{dd}"} 日。示例：{TEMPLATE_EXAMPLE}
            </p>
          </div>

          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="min-h-11 rounded-ctl bg-accent px-4 py-2 td-text-body font-medium text-page transition-colors hover:bg-accent-strong disabled:opacity-50"
          >
            {saving ? "保存中…" : "保存"}
          </button>

          {message && <StatusBanner tone="ok">{message}</StatusBanner>}
          {error && <StatusBanner tone="danger">{error}</StatusBanner>}

          <div className="space-y-3 rounded-card border border-border bg-surface p-4">
            <label className="block">
              <span className="td-text-caption text-ink-3">周记路径模板</span>
              <textarea
                name="weeklyTemplate"
                value={weeklyTemplate}
                onChange={(e) => setWeeklyTemplate(e.target.value)}
                rows={3}
                className="mt-1 block w-full resize-none rounded-row border border-border bg-surface px-3 py-2 text-ink placeholder-ink-3 focus:border-accent focus:outline-none"
                placeholder={WEEKLY_TEMPLATE_EXAMPLE}
              />
            </label>
            <p className="td-text-caption text-ink-3">
              占位符：{"{gggg}"} ISO 年、{"{ww}"} 两位周号；留空 = 回顾页周览不显示周记。示例：{WEEKLY_TEMPLATE_EXAMPLE}
            </p>
          </div>

          <button
            type="button"
            disabled={weeklySaving}
            onClick={() => void handleSaveWeekly()}
            className="min-h-11 rounded-ctl bg-accent px-4 py-2 td-text-body font-medium text-page transition-colors hover:bg-accent-strong disabled:opacity-50"
          >
            {weeklySaving ? "保存中…" : "保存"}
          </button>

          {weeklyMessage && <StatusBanner tone="ok">{weeklyMessage}</StatusBanner>}
          {weeklyError && <StatusBanner tone="danger">{weeklyError}</StatusBanner>}
        </div>
      )}
    </SettingsDetailPage>
  );
}
