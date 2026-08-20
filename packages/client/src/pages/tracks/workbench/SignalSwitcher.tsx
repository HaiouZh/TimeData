import { latestTrackBoardSignal, type Track, type TrackStep } from "@timedata/shared";
import { useMemo } from "react";
import { useTrackActionTags } from "../../../lib/settings/trackActionTagsSetting.js";
import { useAgentExecTags } from "../../../lib/settings/trackAgentExecTagsSetting.js";
import { useResumeTags } from "../../../lib/settings/trackResumeTagsSetting.js";
import { useWaitExternalTags } from "../../../lib/settings/trackWaitExternalTagsSetting.js";
import { appendUserStep } from "../../../lib/tracks.js";

type DispatchGroupKey = "awaiting-me" | "agent-running" | "wait-external" | "in-progress";

function classify(
  signal: { tag: string } | null,
  awaitTag: string | null,
  agentExecTags: readonly string[],
  waitExternalTags: readonly string[],
): DispatchGroupKey {
  if (awaitTag !== null && signal?.tag === awaitTag) return "awaiting-me";
  if (signal !== null && agentExecTags.includes(signal.tag)) return "agent-running";
  if (signal !== null && waitExternalTags.includes(signal.tag)) return "wait-external";
  return "in-progress";
}

export interface SignalSwitcherProps {
  track: Track;
  steps: readonly TrackStep[];
}

export function SignalSwitcher(props: SignalSwitcherProps): React.JSX.Element | null {
  const { track, steps } = props;
  const actionTags = useTrackActionTags();
  const agentExecTags = useAgentExecTags();
  const waitExternalTags = useWaitExternalTags();
  const resumeTags = useResumeTags();

  const boardSignals = useMemo(
    () => [...actionTags, ...agentExecTags, ...waitExternalTags, ...resumeTags],
    [actionTags, agentExecTags, waitExternalTags, resumeTags],
  );

  const signal = useMemo(() => latestTrackBoardSignal(steps, boardSignals), [steps, boardSignals]);

  const currentGroup = useMemo(
    () => classify(signal, actionTags[0] ?? null, agentExecTags, waitExternalTags),
    [signal, actionTags, agentExecTags, waitExternalTags],
  );

  if (track.status !== "active") return null;

  const groups: Array<{ key: DispatchGroupKey; label: string; tag: string | undefined }> = [
    { key: "awaiting-me", label: "等我接", tag: actionTags[0] },
    { key: "agent-running", label: "agent在做", tag: agentExecTags[0] },
    { key: "wait-external", label: "等外部", tag: waitExternalTags[0] },
    { key: "in-progress", label: "恢复推进", tag: resumeTags[0] },
  ];

  const visible = groups.filter((g) => g.tag);

  return (
    <div data-testid="signal-switcher" className="flex flex-wrap gap-2">
      {visible.map((g) => {
        const isActive = currentGroup === g.key;
        return (
          <button
            key={g.key}
            type="button"
            aria-label={`切换信号：${g.label}`}
            data-testid={`signal-${g.key}`}
            data-active={isActive ? "true" : "false"}
            onClick={() => {
              if (isActive) return;
              void (async () => {
                try {
                  await appendUserStep({
                    trackId: track.id,
                    content: `→ ${g.label}`,
                    mode: "instant",
                    tags: [g.tag as string],
                  });
                } catch (error) {
                  console.warn("[SignalSwitcher] appendUserStep failed", error);
                }
              })();
            }}
            className={
              isActive
                ? "rounded-pill border border-accent bg-accent px-3 py-1 td-text-caption text-white"
                : "rounded-pill border border-border bg-surface px-3 py-1 td-text-caption text-ink-2 hover:border-accent/40 hover:text-accent"
            }
          >
            {g.label}
          </button>
        );
      })}
    </div>
  );
}
