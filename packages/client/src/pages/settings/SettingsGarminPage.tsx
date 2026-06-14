import { type FormEvent, useEffect, useState } from "react";
import { useSyncContext } from "../../contexts/SyncContext.tsx";
import { STORAGE_KEYS } from "../../lib/storageKeys.js";
import SettingsDetailPage from "./SettingsDetailPage.tsx";

export interface GarminConfigResponse {
  email: string;
  password: string;
  isCn: boolean;
  schedule: string;
  enabled: boolean;
  lastFetchDate: string;
  initialBackfillDays: number;
}

export type GarminFetchStatus = "success" | "partial_success" | "no_op" | "failed";

export interface GarminFetchError {
  code: string;
  message: string;
  domain?: string;
  date?: string;
}

export interface GarminFetchResult {
  success: boolean;
  status: GarminFetchStatus;
  trigger: "manual" | "scheduled" | "test";
  runId: string;
  startDate: string;
  endDate: string;
  counts: Record<string, number>;
  errors: GarminFetchError[];
  duration: number;
}

export interface GarminStatusResponse {
  enabled: boolean;
  lastFetch: GarminFetchResult | null;
  nextScheduled: string | null;
  running: boolean;
}

interface GarminFetchForm {
  startDate: string;
  endDate: string;
  days: string;
}

type GarminFetchBody = { startDate: string; endDate: string } | { days: number } | Record<string, never>;

const MAX_MANUAL_FETCH_DAYS = 90;
const MAX_INITIAL_BACKFILL_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const GARMIN_DOMAIN_LABELS: Record<string, string> = {
  health_heart_rate: "心率",
  health_hrv: "HRV",
  health_sleep: "睡眠",
  health_stress: "压力",
  runs: "跑步",
};

const GARMIN_ERROR_MESSAGES: Record<string, string> = {
  credentials_missing: "请先保存 Garmin 邮箱和密码",
  script_not_found: "服务器未找到 Garmin 抓取脚本，检查部署镜像或脚本路径",
  auth_failed: "Garmin 登录失败，检查账号、密码、区服和二步验证",
  rate_limited: "Garmin 暂时限制或网络失败，稍后重试",
  already_running: "已有抓取任务运行中",
  invalid_request: "请求参数无效",
  validation_failed: "部分记录格式不符合 TimeData schema",
  fetch_failed: "Garmin 抓取失败，请查看服务端日志",
};

function isYmd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function inclusiveDays(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  return Math.floor((end - start) / MS_PER_DAY) + 1;
}

function formatCounts(counts: Record<string, number>): string {
  const parts = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([domain, count]) => `${GARMIN_DOMAIN_LABELS[domain] ?? domain} ${count} 条`);
  return parts.length > 0 ? parts.join("，") : "没有写入新记录";
}

export function garminStatusLabel(status: GarminFetchStatus): string {
  const labels: Record<GarminFetchStatus, string> = {
    success: "成功",
    partial_success: "部分成功",
    no_op: "无需抓取",
    failed: "失败",
  };
  return labels[status];
}

export function formatGarminError(error: GarminFetchError | string): string {
  if (typeof error === "string") return error;
  const base = GARMIN_ERROR_MESSAGES[error.code] ?? error.message ?? "未知 Garmin 错误";
  const detailParts = [error.domain ? (GARMIN_DOMAIN_LABELS[error.domain] ?? error.domain) : "", error.date ?? ""]
    .filter(Boolean);
  if (error.code === "validation_failed" && detailParts.length > 0) {
    return `${base}（${detailParts.join(" ")}）`;
  }
  return base;
}

export function validateGarminFetchForm(form: GarminFetchForm): string | null {
  const startDate = form.startDate.trim();
  const endDate = form.endDate.trim();
  const daysText = form.days.trim();
  const hasDate = startDate !== "" || endDate !== "";
  const hasDays = daysText !== "";

  if (hasDate && hasDays) return "日期范围和最近 N 天只能二选一";
  if (hasDays) {
    const days = Number(daysText);
    if (!Number.isInteger(days) || days < 1 || days > MAX_MANUAL_FETCH_DAYS) {
      return "强制重抓天数必须是 1 到 90 的整数";
    }
    return null;
  }
  if ((startDate && !endDate) || (!startDate && endDate)) {
    return "开始日期和结束日期需要同时填写";
  }
  if (startDate && endDate) {
    if (!isYmd(startDate) || !isYmd(endDate)) return "日期格式需要是 YYYY-MM-DD";
    if (endDate < startDate) return "结束日期不能早于开始日期";
    if (inclusiveDays(startDate, endDate) > MAX_MANUAL_FETCH_DAYS) {
      return "手动日期范围最多 90 天";
    }
  }
  return null;
}

export function buildGarminFetchBody(form: GarminFetchForm): GarminFetchBody {
  const startDate = form.startDate.trim();
  const endDate = form.endDate.trim();
  const days = form.days.trim();
  if (days) return { days: Number(days) };
  if (startDate && endDate) return { startDate, endDate };
  return {};
}

export function formatGarminFetchMessage(result: GarminFetchResult): string {
  if (result.status === "no_op") return "已同步到昨天，无需抓取";
  const duration = Math.round(result.duration / 1000);
  const prefix = `抓取${garminStatusLabel(result.status)}`;
  const summary = `${result.startDate} → ${result.endDate}，${duration}s，${formatCounts(result.counts)}`;
  if (result.errors.length === 0) return `${prefix}: ${summary}`;
  return `${prefix}: ${summary}；${result.errors.map(formatGarminError).join("；")}`;
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Garmin 操作失败";
}

async function apiFetch<T>(
  apiUrl: string,
  path: string,
  options?: RequestInit,
): Promise<T> {
  const token = localStorage.getItem(STORAGE_KEYS.apiToken) || "";
  const res = await fetch(`${apiUrl}/api/admin/garmin${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    try {
      const body = JSON.parse(text) as { code?: string; error?: string; message?: string };
      throw new Error(formatGarminError({
        code: body.code ?? body.error ?? "fetch_failed",
        message: body.message ?? text,
      }));
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error(`${res.status}: ${text}`);
      throw error;
    }
  }
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
  const [initialBackfillDays, setInitialBackfillDays] = useState("7");
  const [fetchStartDate, setFetchStartDate] = useState("");
  const [fetchEndDate, setFetchEndDate] = useState("");
  const [fetchDays, setFetchDays] = useState("");

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
        setInitialBackfillDays(String(cfg.initialBackfillDays));
      })
      .catch((e) => setError(formatUnknownError(e)))
      .finally(() => setLoading(false));
  }, [apiUrl]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!apiUrl) return;
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const backfillDays = Number(initialBackfillDays);
      if (!Number.isInteger(backfillDays) || backfillDays < 1 || backfillDays > MAX_INITIAL_BACKFILL_DAYS) {
        setError("首次回填天数必须是 1 到 30 的整数");
        return;
      }
      const body: Record<string, unknown> = {
        email,
        isCn,
        schedule,
        enabled,
        initialBackfillDays: backfillDays,
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
      setInitialBackfillDays(String(cfg.initialBackfillDays));
    } catch (e) {
      setError(formatUnknownError(e));
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
      const form = { startDate: fetchStartDate, endDate: fetchEndDate, days: fetchDays };
      const validationError = validateGarminFetchForm(form);
      if (validationError) {
        setError(validationError);
        return;
      }
      const result = await apiFetch<GarminFetchResult>(apiUrl, "/fetch", {
        method: "POST",
        body: JSON.stringify(buildGarminFetchBody(form)),
      });
      if (result.status === "failed") {
        setError(formatGarminFetchMessage(result));
      } else {
        setMessage(formatGarminFetchMessage(result));
      }
      const sts = await apiFetch<GarminStatusResponse>(apiUrl, "/status");
      setStatus(sts);
    } catch (e) {
      setError(formatUnknownError(e));
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
      const result = await apiFetch<{ ok: boolean; errors: GarminFetchError[] }>(
        apiUrl,
        "/test",
        { method: "POST" },
      );
      if (result.ok) {
        setMessage("连接测试成功");
      } else {
        setError(`连接失败: ${result.errors.map(formatGarminError).join("；")}`);
      }
    } catch (e) {
      setError(formatUnknownError(e));
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
              <label className="block">
                <span className="text-xs text-slate-400">首次回填天数</span>
                <input
                  name="initialBackfillDays"
                  type="number"
                  min={1}
                  max={30}
                  step={1}
                  value={initialBackfillDays}
                  onChange={(e) => setInitialBackfillDays(e.target.value)}
                  className="mt-1 block w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
                />
              </label>
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
              <label className="block min-w-[9rem] flex-1">
                <span className="text-xs text-slate-400">开始日期</span>
                <input
                  type="date"
                  value={fetchStartDate}
                  onChange={(e) => setFetchStartDate(e.target.value)}
                  className="mt-1 block w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
                />
              </label>
              <label className="block min-w-[9rem] flex-1">
                <span className="text-xs text-slate-400">结束日期</span>
                <input
                  type="date"
                  value={fetchEndDate}
                  onChange={(e) => setFetchEndDate(e.target.value)}
                  className="mt-1 block w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
                />
              </label>
              <label className="block min-w-[9rem] flex-1">
                <span className="text-xs text-slate-400">强制重抓最近 N 天</span>
                <input
                  name="fetchDays"
                  type="number"
                  min={1}
                  max={90}
                  step={1}
                  value={fetchDays}
                  onChange={(e) => setFetchDays(e.target.value)}
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
              日期和 N 天都留空时，服务器会按健康表缺口智能补到昨天
            </p>
          </div>

          {/* Status */}
          {status?.running && (
            <div className="rounded-xl border border-blue-800 bg-blue-950/30 p-3 text-sm text-blue-200">
              Garmin 正在抓取中，请稍后刷新状态
            </div>
          )}
          {status?.lastFetch && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium uppercase tracking-wider text-slate-500">
                上次抓取结果
              </h3>
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 text-sm">
                <p className="text-slate-300">
                  {garminStatusLabel(status.lastFetch.status)} | {status.lastFetch.startDate} →{" "}
                  {status.lastFetch.endDate} |{" "}
                  {Math.round(status.lastFetch.duration / 1000)}s
                </p>
                {status.lastFetch.status === "no_op" && (
                  <p className="mt-2 text-xs text-emerald-300">
                    已同步到昨天，无需抓取
                  </p>
                )}
                <div className="mt-2 space-y-1 text-xs text-slate-400">
                  {Object.entries(status.lastFetch.counts).map(([k, v]) => (
                    <p key={k}>
                      {GARMIN_DOMAIN_LABELS[k] ?? k}: {v} 条
                    </p>
                  ))}
                </div>
                {status.lastFetch.errors.length > 0 && (
                  <div className="mt-2 space-y-1 rounded border border-red-900 bg-red-950/30 p-2 text-xs text-red-300">
                    {status.lastFetch.errors.map((err, index) => (
                      <p key={`${err.code}-${err.domain ?? ""}-${err.date ?? ""}-${index}`}>
                        {formatGarminError(err)}
                      </p>
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
