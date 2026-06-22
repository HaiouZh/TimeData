import { useState } from "react";
import { SegmentedControl } from "../../components/ui/SegmentedControl.js";
import { TRACK_COURT_META, TRACK_COURTS, type TrackCourt } from "../../lib/trackCourts.js";
import {
  readTrackActionTagConfigs,
  setTrackActionTagConfigs,
  useTrackActionTagConfigs,
  type TrackActionTagConfig,
} from "../../lib/settings/trackActionTagsSetting.js";
import SettingsDetailPage from "./SettingsDetailPage.tsx";

const COURT_OPTIONS = TRACK_COURTS.map((court) => ({ value: court, label: TRACK_COURT_META[court].laneLabel }));

export function SettingsTracksPage() {
  const configs = useTrackActionTagConfigs();
  const [draft, setDraft] = useState("");

  async function add(raw: string) {
    const trimmed = raw.trim();
    setDraft("");
    const current = await readTrackActionTagConfigs();
    if (!trimmed || current.some((item) => item.tag === trimmed)) return;
    await setTrackActionTagConfigs([...current, { tag: trimmed, court: "neutral" }]);
  }

  async function remove(tag: string) {
    const current = await readTrackActionTagConfigs();
    await setTrackActionTagConfigs(current.filter((item) => item.tag !== tag));
  }

  async function changeCourt(tag: string, court: TrackCourt) {
    const current = await readTrackActionTagConfigs();
    await setTrackActionTagConfigs(
      current.map((item): TrackActionTagConfig => (item.tag === tag ? { ...item, court } : item)),
    );
  }

  return (
    <SettingsDetailPage title="轨道状态标签">
      <section className="space-y-3">
        <p className="text-sm leading-6 text-ink-3">
          这些标签是轨道的交棒状态词表。每个标签归到一个阵营；颜色跟阵营走，阵营数量固定。
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
        {configs.length === 0 ? (
          <p className="text-sm text-ink-3">还没有交棒标签；看板不会把普通批注当成交棒。</p>
        ) : (
          <ul className="space-y-2">
            {configs.map((item) => (
              <li
                key={item.tag}
                className="grid gap-2 rounded-card border border-border bg-surface-elevated p-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              >
                <span className="inline-flex items-center gap-2 text-sm text-ink-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${TRACK_COURT_META[item.court].dotClass}`} />
                  <span>#{item.tag}</span>
                  <button
                    type="button"
                    aria-label={`删除 ${item.tag}`}
                    onClick={() => void remove(item.tag)}
                    className="text-ink-3 transition hover:text-ink"
                  >
                    ×
                  </button>
                </span>
                <SegmentedControl
                  options={COURT_OPTIONS}
                  value={item.court}
                  onChange={(court) => void changeCourt(item.tag, court)}
                  ariaLabel={`${item.tag} 的阵营`}
                  className="w-full sm:w-[26rem]"
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </SettingsDetailPage>
  );
}
