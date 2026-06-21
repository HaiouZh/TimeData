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
    await setTrackActionTags(current.filter((t) => t !== tag));
  }

  return (
    <SettingsDetailPage title="轨道状态标签">
      <section className="space-y-3">
        <p className="text-sm leading-6 text-ink-3">
          这些标签会作为轨道接力状态的建议词表。统计面板按 active 轨道最新一步的标签聚合；这里可自由添加、删除。
        </p>
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
            placeholder="如:等我 / 待决策 / 卡住 / agent在做"
            aria-label="新增状态标签"
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
          <p className="text-sm text-ink-3">还没有状态标签；统计面板只会展示实际出现在最新步上的临时标签。</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <li key={tag}>
                <span className="inline-flex items-center gap-1 rounded-pill bg-surface-elevated px-2.5 py-1 text-sm text-ink-2">
                  #{tag}
                  <button
                    type="button"
                    aria-label={`删除 ${tag}`}
                    onClick={() => void remove(tag)}
                    className="text-ink-3 transition hover:text-ink"
                  >
                    ×
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </SettingsDetailPage>
  );
}
