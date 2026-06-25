import { Capacitor } from "@capacitor/core";
import { useEffect, useRef, useState } from "react";
import { useSyncContext } from "../../contexts/SyncContext.tsx";
import { safeGetItem, safeSetItem } from "../../lib/safeStorage.js";
import { STORAGE_KEYS } from "../../lib/storageKeys.js";
import SettingsDetailPage from "./SettingsDetailPage.js";

const inputClassName = "w-full rounded-ctl border border-border bg-surface-elevated px-3 py-2 text-sm text-ink";

export default function SettingsServerPage() {
  const { apiUrl: savedApiUrl, updateApiUrl } = useSyncContext();
  const [apiUrl, setApiUrl] = useState(savedApiUrl);
  const [apiToken, setApiToken] = useState(safeGetItem(STORAGE_KEYS.apiToken) || "");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const savedTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current !== null) {
        window.clearTimeout(savedTimerRef.current);
        savedTimerRef.current = null;
      }
    };
  }, []);

  function saveConfig() {
    const nextApiUrl = apiUrl.trim();
    if (Capacitor.isNativePlatform() && nextApiUrl.toLowerCase().startsWith("http://")) {
      setSaved(false);
      setError("Android App 不支持 HTTP 明文地址，请使用 HTTPS 反向代理地址。");
      return;
    }

    updateApiUrl(nextApiUrl);
    safeSetItem(STORAGE_KEYS.apiToken, apiToken.replace(/^Bearer\s+/i, "").trim());
    setError("");
    setSaved(true);
    if (savedTimerRef.current !== null) {
      window.clearTimeout(savedTimerRef.current);
    }
    savedTimerRef.current = window.setTimeout(() => {
      setSaved(false);
      savedTimerRef.current = null;
    }, 2000);
  }

  return (
    <SettingsDetailPage title="服务器配置">
      <section className="space-y-3 rounded-card border border-border bg-surface p-4">
        <div>
          <label className="mb-1 block text-xs text-ink-3">API 地址</label>
          <input
            type="url"
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            placeholder="https://your-server.com"
            className={inputClassName}
          />
          <p className="mt-2 text-xs text-ink-3">Android App 保持 HTTPS-only；自托管服务器请配置 HTTPS 反向代理后填写 https:// 地址。</p>
          <p className="mt-1 text-xs text-ink-3">自托管：服务端 <code className="font-mono">ALLOWED_ORIGINS</code> 必须包含 <code className="font-mono">https://localhost</code>，否则 Android 跨域请求会被 CORS 拒绝。</p>
        </div>
        <div>
          <label className="mb-1 block text-xs text-ink-3">Token</label>
          <input
            type="password"
            value={apiToken}
            onChange={(e) => setApiToken(e.target.value)}
            placeholder="不带 Bearer 前缀的 token"
            className={inputClassName}
          />
          <p className="mt-2 text-xs text-warn">
            Token 会保存在本机浏览器存储中，请只在可信设备上保存服务器 Token。
          </p>
        </div>
        {error ? <p className="text-xs text-danger">{error}</p> : null}
        <button
          type="button"
          onClick={saveConfig}
          className="rounded-ctl bg-accent px-4 py-2 text-sm font-medium text-page hover:bg-accent-strong"
        >
          {saved ? "已保存" : "保存配置"}
        </button>
        <div className="text-xs text-ink-3">新的服务器配置会用于后续同步、服务端更新和数据导出。</div>
      </section>
    </SettingsDetailPage>
  );
}
