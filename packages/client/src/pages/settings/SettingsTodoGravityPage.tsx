import { useLiveQuery } from "dexie-react-hooks";
import { useCallback } from "react";
import { Cards } from "@phosphor-icons/react";
import { Icon } from "../../components/Icon.js";
import { useSyncContext } from "../../contexts/SyncContext.tsx";
import { listTasks, type TodoBuckets } from "../../lib/tasks.js";
import { splitInboxByGravity } from "../../lib/tasks/gravity.js";
import { currentGravityDate } from "../../lib/tasks/gravityClock.js";
import {
  DEFAULT_TODO_GRAVITY_SETTINGS,
  sanitizeTodoGravitySettings,
  setTodoGravitySettings,
  useTodoGravitySettings,
} from "../../lib/settings/todoGravitySetting.ts";
import SettingsDetailPage from "./SettingsDetailPage.tsx";
import { SettingsNumberRow, SettingsSection, SettingsToggleRow } from "./components/SettingsRows.js";

const EMPTY: TodoBuckets = { today: [], inbox: [], scheduled: [], recurring: [], completed: [] };

export default function SettingsTodoGravityPage() {
  const settings = useTodoGravitySettings();
  const buckets = useLiveQuery(() => listTasks(), [], EMPTY) ?? EMPTY;
  const { syncAfterWrite } = useSyncContext();
  const now = currentGravityDate();
  const { sunken } = splitInboxByGravity(buckets.inbox, settings, now);

  const persist = useCallback(
    (patch: Partial<typeof settings>) => {
      const next = sanitizeTodoGravitySettings({ ...settings, ...patch });
      void setTodoGravitySettings(next).then(() => syncAfterWrite());
    },
    [settings, syncAfterWrite],
  );

  const restoreDefaults = useCallback(() => {
    void setTodoGravitySettings(DEFAULT_TODO_GRAVITY_SETTINGS).then(() => syncAfterWrite());
  }, [syncAfterWrite]);

  return (
    <SettingsDetailPage title="水位线与翻牌">
      <SettingsSection title="预览" description="按当前设置，收件箱里沉入水下的任务数量。">
        <div className="flex items-center gap-3 px-4 py-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-row bg-surface-hover text-ink-2">
            <Icon icon={Cards} size={20} />
          </span>
          <div className="text-sm text-ink-2">
            现在 inbox 里 <span className="font-semibold text-ink">{sunken.length}</span> /{" "}
            <span className="font-semibold text-ink">{buckets.inbox.length}</span> 条在水下
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="参数">
        <SettingsToggleRow
          title="启用水位线"
          subtitle="关闭后收件箱不再隐藏沉下去的任务"
          checked={settings.enabled}
          onChange={(checked) => persist({ enabled: checked })}
        />
        <SettingsNumberRow
          title="多少天没动静就沉下去"
          subtitle="超过这些天没更新的任务从收件箱沉入水下"
          value={settings.waterlineDays}
          min={1}
          max={365}
          disabled={!settings.enabled}
          onChange={(v) => persist({ waterlineDays: v })}
        />
        <SettingsNumberRow
          title="每顶一次多扛几天"
          subtitle="「顶一下」增加任务抗沉天数"
          value={settings.weightStepDays}
          min={1}
          max={365}
          disabled={!settings.enabled}
          onChange={(v) => persist({ weightStepDays: v })}
        />
        <SettingsNumberRow
          title="新建保护期"
          subtitle="新建的任务先在明面上待几天"
          value={settings.graceDays}
          min={0}
          max={365}
          disabled={!settings.enabled}
          onChange={(v) => persist({ graceDays: v })}
        />
        <SettingsNumberRow
          title="一次备几张牌"
          subtitle="翻牌区每次抽取的水下任务数量"
          value={settings.drawM}
          min={1}
          max={10}
          disabled={!settings.enabled}
          onChange={(v) => persist({ drawM: v })}
        />
        <SettingsNumberRow
          title="一批最多顶几张"
          subtitle="每轮翻牌可「顶一下」的次数上限"
          value={settings.pickN}
          min={1}
          max={settings.drawM}
          disabled={!settings.enabled}
          onChange={(v) => persist({ pickN: v })}
        />
      </SettingsSection>

      <div className="px-1">
        <button
          type="button"
          onClick={restoreDefaults}
          className="w-full rounded-ctl border border-border bg-surface px-4 py-2.5 text-sm text-ink-2 transition-colors hover:bg-surface-hover"
        >
          恢复默认
        </button>
      </div>
    </SettingsDetailPage>
  );
}