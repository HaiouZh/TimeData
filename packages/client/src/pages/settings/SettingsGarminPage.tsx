import { type FormEvent, useEffect, useState } from "react";
import { useSyncContext } from "../../contexts/SyncContext.tsx";
import SettingsDetailPage from "./SettingsDetailPage.tsx";

interface GarminConfigResponse {
  email: string;
  password: string;
  isCn: boolean;
  schedule: string;
  enabled: boolean;
  lastFetchDate: string;
}

interface GarminStatusResponse {
  enabled: boolean;
  lastFetch: {
    success: boolean;
    startDate: string;
    endDate: string;
    counts: Record<string, number>;
    errors: string[];
    duration: number;
  } | null;
  nextScheduled: string | null;
  running: boolean;
}

async function apiFetch<T>(
  apiUrl: string,
  path: string,
  options?: RequestInit,
): Promise<T> {
  const token = localStorage.getItem("syncAuthToken") || "";
  const res = await fetch(`${apiUrl}/api/admin/garmin${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export default function SettingsGarminPage() {
  const { apiUrl } = useSyncContext();
  const [config, setConfig] = useState<GarminConfigResponse | null>(null);
  const [status, setStatus] = useState<GarminStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // Form state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isCn, setIsCn] = useState(true);
  const [schedule, setSchedule] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [fetchStartDate, setFetchStartDate] = useState("");
  const [fetchEndDate, setFetchEndDate] = useState("");

  useEffect(() => {
    if (!apiUrl) {
      setLoading(false);
      return;
    }
    Promise.all([
      apiFetch<GarminConfigResponse>(apiUrl, "/config"),
      apiFetch<GarminStatusResponse>(apiUrl, "/status"),
    ])
      .then(([cfg, sts]) => {
        setConfig(cfg);
        setStatus(sts);
        setEmail(cfg.email);
        setIsCn(cfg.isCn);
        setSchedule(cfg.schedule);
        setEnabled(cfg.enabled);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [apiUrl]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!apiUrl) return;
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const body: Record<string, unknown> = {
        email,
        isCn,
        schedule,
        enabled,
      };
      if (password) body.password = password;
      await apiFetch(apiUrl, "/config", {
        method: "PUT",
        body: JSON.stringify(body),
      });
      setPassword("");
      setMessage("配置已保存");
      const cfg = await apiFetch<GarminConfigResponse>(apiUrl, "/config");
      setConfig(cfg);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleFetch() {
    if (!apiUrl) return;
    setFetching(true);
    setMessage("");
    setError("");
    try {
      const body: Record<string, string> = {};
      if (fetchStartDate) body.startDate = fetchStartDate;
      if (fetchEndDate) body.endDate = fetchEndDate;
      const result = await apiFetch<{
        success: boolean;
        counts: Record<string, number>;
        errors: string[];
        duration: number;
      }>(apiUrl, "/fetch", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (result.success) {
        const summary = Object.entries(result.counts)
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ");
        setMessage(`抓取成功 (${Math.round(result.duration / 1000)}s): ${summary}`);
      } else {
        setError(`抓取失败: ${result.errors.join("; ")}`);
      }
      const sts = await apiFetch<GarminStatusResponse>(apiUrl, "/status");
      setStatus(sts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "抓取失败");
    } finally {
      setFetching(false);
    }
  }

  async function handleTest() {
    if (!apiUrl) return;
    setTesting(true);
    setMessage("");
    setError("");
    try {
      const result = await apiFetch<{ ok: boolean; errors: string[] }>(
        apiUrl,
        "/test",
        { method: "POST" },
      );
      if (result.ok) {
        setMessage("连接测试成功 ✅");
      } else {
        setError(`连接失败: ${result.errors.join("; ")}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "测试失败");
    } finally {
      setTesting(false);
    }
  }

  if (!apiUrl) {
    return (
      <SettingsDetailPage title="Garmin 数据同步">
        <p className="text-sm text-slate-400">请先配置服务器地址</p>
      </SettingsDetailPage>
    );
  }

  return (
    <SettingsDetailPage title="Garmin 数据同步">
      {loading ? (
        <p className="text-sm text-slate-400">加载中…</p>
      ) : (
        <div className="space-y-6">
          {/* Config form */}
          <form onSubmit={handleSave} className="space-y-4">
            <h3 className="text-sm font-medium uppercase tracking-wider text-slate-500">
              账号配置
            </h3>
            <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
              <label className="block">
                <span className="text-xs text-slate-400">Garmin 邮箱</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 block w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  placeholder="user@example.com"
                />
              </label>
              <label className="block">
                <span className="text-xs text-slate-400">
                  密码{config?.password ? "（已设置，留空保持不变）" : ""}
                </span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1 block w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  placeholder="••••••••"
                />
              </label>
              <label className="flex items-center gap-3 py-1">
                <input
                  type="checkbox"
                  checked={isCn}
                  onChange={(e) => setIsCn(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-blue-500"
                />
                <span className="text-sm text-slate-200">中国区 (Garmin CN)</span>
              </label>
            </div>

            <h3 className="text-sm font-medium uppercase tracking-wider text-slate-500">
              定时抓取
            </h3>
            <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
              <label className="flex items-center gap-3 py-1">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-blue-500"
                />
                <span className="text-sm text-slate-200">启用每日定时抓取</span>
              </label>
              {enabled && (
                <label className="block">
                  <span className="text-xs text-slate-400">抓取时间 (HH:MM)</span>
                  <input
                    type="time"
                    value={schedule}
                    onChange={(e) => setSchedule(e.target.value)}
                    className="mt-1 block w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
                  />
                </label>
              )}
              {config?.lastFetchDate && (
                <p className="text-xs text-slate-500">
                  上次抓取到: {config.lastFetchDate}
                </p>
              )}
            </div>

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={saving}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
              >
                {saving ? "保存中…" : "保存配置"}
              </button>
              <button
                type="button"
                disabled={testing || !config?.email}
                onClick={handleTest}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-700 disabled:opacity-50"
              >
                {testing ? "测试中…" : "测试连接"}
              </button>
            </div>
          </form>

          {/* Manual fetch */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium uppercase tracking-wider text-slate-500">
              手动抓取
            </h3>
            <div className="flex flex-wrap gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
              <label className="block flex-1">
                <span className="text-xs text-slate-400">开始日期</span>
                <input
                  type="date"
                  value={fetchStartDate}
                  onChange={(e) => setFetchStartDate(e.target.value)}
                  className="mt-1 block w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
                />
              </label>
              <label className="block flex-1">
                <span className="text-xs text-slate-400">结束日期</span>
                <input
                  type="date"
                  value={fetchEndDate}
                  onChange={(e) => setFetchEndDate(e.target.value)}
                  className="mt-1 block w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
                />
              </label>
              <div className="flex items-end">
                <button
                  type="button"
                  disabled={fetching || !config?.email}
                  onClick={handleFetch}
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
                >
                  {fetching ? "抓取中…" : "立即抓取"}
                </button>
              </div>
            </div>
            <p className="text-xs text-slate-500">
              留空日期则自动从上次抓取日期的下一天开始，到昨天结束
            </p>
          </div>

          {/* Status */}
          {status?.lastFetch && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium uppercase tracking-wider text-slate-500">
                上次抓取结果
              </h3>
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 text-sm">
                <p className="text-slate-300">
                  {status.lastFetch.success ? "✅ 成功" : "❌ 失败"} |{" "}
                  {status.lastFetch.startDate} → {status.lastFetch.endDate} |{" "}
                  {Math.round(status.lastFetch.duration / 1000)}s
                </p>
                <div className="mt-2 space-y-1 text-xs text-slate-400">
                  {Object.entries(status.lastFetch.counts).map(([k, v]) => (
                    <p key={k}>
                      {k}: {v} 条
                    </p>
                  ))}
                </div>
                {status.lastFetch.errors.length > 0 && (
                  <div className="mt-2 space-y-1 rounded border border-red-900 bg-red-950/30 p-2 text-xs text-red-300">
                    {status.lastFetch.errors.map((err, i) => (
                      <p key={i}>{err}</p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Messages */}
          {message && (
            <div className="rounded-xl border border-emerald-800 bg-emerald-950/30 p-3 text-sm text-emerald-300">
              {message}
            </div>
          )}
          {error && (
            <div className="rounded-xl border border-red-800 bg-red-950/30 p-3 text-sm text-red-300">
              {error}
            </div>
          )}
        </div>
      )}
    </SettingsDetailPage>
  );
}
