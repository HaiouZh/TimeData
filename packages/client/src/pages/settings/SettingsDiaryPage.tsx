import { useEffect, useState } from "react";
import { ApiError } from "../../lib/api.js";
import { fetchDiaryConfig, saveDiaryTemplate } from "../../lib/diary/diaryApi.js";
import SettingsDetailPage from "./SettingsDetailPage.tsx";

const TEMPLATE_EXAMPLE = "日记_{yyyy}/Day/{yyyy}年{MM}月/{yyyy}-{MM}-{dd}.md";

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
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchDiaryConfig()
      .then((config) => {
        if (cancelled) return;
        setEnabled(config.enabled);
        setTemplate(config.template);
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

  return (
    <SettingsDetailPage title="日记">
      {loading ? (
        <p className="td-text-body text-ink-3">加载中…</p>
      ) : (
        <div className="space-y-4">
          {!enabled && (
            <div className="rounded-xl border border-warn/40 bg-warn-soft p-3 td-text-body text-warn">
              服务器未挂载日记 vault（DIARY_VAULT_DIR），保存的模板暂时不会生效
            </div>
          )}

          <div className="space-y-3 rounded-card border border-border bg-surface p-4">
            <label className="block">
              <span className="td-text-caption text-ink-3">日记路径模板</span>
              <textarea
                name="template"
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                rows={3}
                className="mt-1 block w-full resize-none rounded-xl border border-border bg-surface px-3 py-2 td-text-body text-ink placeholder-ink-3 focus:border-accent focus:outline-none"
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
            className="rounded-xl bg-accent px-4 py-2 td-text-body font-medium text-page transition-colors hover:bg-accent-strong disabled:opacity-50"
          >
            {saving ? "保存中…" : "保存"}
          </button>

          {message && (
            <div className="rounded-xl border border-ok/40 bg-ok/10 p-3 td-text-body text-ok">{message}</div>
          )}
          {error && (
            <div className="rounded-xl border border-danger/40 bg-danger-soft p-3 td-text-body text-danger">{error}</div>
          )}
        </div>
      )}
    </SettingsDetailPage>
  );
}
