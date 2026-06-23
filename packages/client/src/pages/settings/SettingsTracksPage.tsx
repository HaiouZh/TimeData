import { useState } from "react";
import {
  readTrackActionTags,
  setTrackActionTags,
  useTrackActionTags,
} from "../../lib/settings/trackActionTagsSetting.js";
import SettingsDetailPage from "./SettingsDetailPage.tsx";

export function SettingsTracksPage() {
  const tags = useTrackActionTags();
  const [draft, setDraft] = useState("");

  async function add(raw: string) {
    const trimmed = raw.trim();
    setDraft("");
    const current = await readTrackActionTags();
    if (!trimmed || current.includes(trimmed)) return;
    await setTrackActionTags([...current, trimmed]);
  }

  async function remove(tag: string) {
    const current = await readTrackActionTags();
    await setTrackActionTags(current.filter((item) => item !== tag));
  }

  return (
    <SettingsDetailPage title="轨道看板信号">
      <section className="space-y-3">
        <p className="text-sm leading-6 text-ink-3">配置会进入轨道列表顶部聚合的步骤标签。</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void add(draft);
          }}
          className="flex gap-2"
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="如:待我处理 / agent在做"
            aria-label="新增看板信号"
            className="min-h-10 flex-1 rounded-ctl border border-border bg-surface px-3 text-sm text-ink placeholder:text-ink-3 focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <button
            type="submit"
            className="shrink-0 rounded-ctl bg-accent px-3 text-sm font-medium text-page transition hover:bg-accent-hover"
          >
            添加
          </button>
        </form>
        {tags.length === 0 ? (
          <p className="text-sm text-ink-3">还没有看板信号；步骤标签只用于回看检索。</p>
        ) : (
          <ul className="space-y-2">
            {tags.map((tag) => (
              <li
                key={tag}
                className="flex items-center justify-between gap-2 rounded-card border border-border bg-surface-elevated p-2"
              >
                <span className="text-sm text-ink-2">#{tag}</span>
                <button
                  type="button"
                  aria-label={`删除 ${tag}`}
                  onClick={() => void remove(tag)}
                  className="text-ink-3 transition hover:text-ink"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </SettingsDetailPage>
  );
}
