import { useState } from "react";
import {
  readTrackActionTags,
  setTrackActionTags,
  useTrackActionTags,
} from "../../lib/settings/trackActionTagsSetting.js";
import {
  readAgentExecTags,
  setAgentExecTags,
  useAgentExecTags,
} from "../../lib/settings/trackAgentExecTagsSetting.js";
import SettingsDetailPage from "./SettingsDetailPage.tsx";

export function SettingsTracksPage() {
  const tags = useTrackActionTags();
  const [draft, setDraft] = useState("");
  const execTags = useAgentExecTags();
  const [execDraft, setExecDraft] = useState("");

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

  async function addExec(raw: string) {
    const trimmed = raw.trim().replace(/^#/, "");
    setExecDraft("");
    const current = await readAgentExecTags();
    if (!trimmed || current.includes(trimmed)) return;
    await setAgentExecTags([...current, trimmed]);
  }

  async function removeExec(tag: string) {
    const current = await readAgentExecTags();
    await setAgentExecTags(current.filter((item) => item !== tag));
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
      <section className="mt-6 space-y-3">
        <h2 className="td-text-label text-ink">agent 执行信号</h2>
        <p className="td-text-body text-ink-3">
          步骤带这些标签时，调度台把该轨道归入「agent 在跑」分组（无论谁记录）。清空则只按写入者区分。
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void addExec(execDraft);
          }}
          className="flex gap-2"
        >
          <input
            value={execDraft}
            onChange={(e) => setExecDraft(e.target.value)}
            placeholder="如:agent在做"
            aria-label="新增 agent 执行信号"
            className="min-h-10 flex-1 rounded-ctl border border-border bg-surface px-3 td-text-body text-ink placeholder:text-ink-3 focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <button
            type="submit"
            className="shrink-0 rounded-ctl bg-accent px-3 td-text-label text-page transition hover:bg-accent-hover"
          >
            添加
          </button>
        </form>
        {execTags.length === 0 ? (
          <p className="td-text-body text-ink-3">未配置；甘特只按谁写入这一步区分颜色。</p>
        ) : (
          <ul className="space-y-2">
            {execTags.map((tag) => (
              <li
                key={tag}
                className="flex items-center justify-between gap-2 rounded-card border border-border bg-surface-elevated p-2"
              >
                <span className="td-text-body text-ink-2">#{tag}</span>
                <button
                  type="button"
                  aria-label={`删除执行者信号 ${tag}`}
                  onClick={() => void removeExec(tag)}
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
