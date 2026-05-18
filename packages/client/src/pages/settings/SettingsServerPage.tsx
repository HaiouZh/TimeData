import { useState } from "react";
import { useSyncContext } from "../../contexts/SyncContext.tsx";
import { safeGetItem, safeSetItem } from "../../lib/safeStorage.js";
import { STORAGE_KEYS } from "../../lib/storageKeys.js";
import SettingsDetailPage from "./SettingsDetailPage.js";

export default function SettingsServerPage() {
  const { apiUrl: savedApiUrl, updateApiUrl } = useSyncContext();
  const [apiUrl, setApiUrl] = useState(savedApiUrl);
  const [apiToken, setApiToken] = useState(safeGetItem(STORAGE_KEYS.apiToken) || "");
  const [saved, setSaved] = useState(false);

  function saveConfig() {
    updateApiUrl(apiUrl.trim());
    safeSetItem(STORAGE_KEYS.apiToken, apiToken.replace(/^Bearer\s+/i, "").trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <SettingsDetailPage title="服务器配置">
      <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <div>
          <label className="mb-1 block text-xs text-slate-500">API 地址</label>
          <input
            type="url"
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            placeholder="https://your-server.com"
            className="w-full rounded bg-slate-800 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">Token</label>
          <input
            type="password"
            value={apiToken}
            onChange={(e) => setApiToken(e.target.value)}
            placeholder="不带 Bearer 前缀的 token"
            className="w-full rounded bg-slate-800 px-3 py-2 text-sm"
          />
          <p className="mt-2 text-xs text-amber-300">Token 会保存在本机浏览器存储中，请只在可信设备上保存服务器 Token。</p>
        </div>
        <button type="button" onClick={saveConfig} className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500">
          {saved ? "已保存" : "保存配置"}
        </button>
        <div className="text-xs text-slate-500">新的服务器配置会用于后续同步、服务端更新和数据导出。</div>
      </section>
    </SettingsDetailPage>
  );
}
