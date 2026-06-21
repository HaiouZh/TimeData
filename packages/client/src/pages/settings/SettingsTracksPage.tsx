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
    <SettingsDetailPage title="轨道行动标签">
      <section className="space-y-3">
        <p className="text-sm text-slate-400">
          命中这些标签的「当前步」会进入轨道面的「轮到我」收件箱。自由添加、随时增删——它不是固定枚举。
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
            placeholder="如:等我 / 待决策 / 卡住"
            aria-label="新增行动标签"
            className="min-h-10 flex-1 rounded-lg border border-slate-800 bg-slate-900/70 px-3 text-sm text-slate-100 placeholder:text-slate-600 focus:border-slate-600 focus:outline-none"
          />
          <button
            type="submit"
            className="shrink-0 rounded-lg bg-blue-600 px-3 text-sm font-medium text-white transition-colors hover:bg-blue-500"
          >
            添加
          </button>
        </form>
        {tags.length === 0 ? (
          <p className="text-sm text-slate-500">还没有行动标签——「轮到我」收件箱会一直是空的。</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <li key={tag}>
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-2.5 py-1 text-sm text-slate-200">
                  #{tag}
                  <button
                    type="button"
                    aria-label={`删除 ${tag}`}
                    onClick={() => void remove(tag)}
                    className="text-slate-500 transition-colors hover:text-slate-200"
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
