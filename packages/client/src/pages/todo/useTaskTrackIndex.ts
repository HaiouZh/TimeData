import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import { useAgentExecTags } from "../../lib/settings/trackAgentExecTagsSetting.js";
import { useTrackActionTags } from "../../lib/settings/trackActionTagsSetting.js";
import { buildTaskTrackIndex, type TaskTrackInfo } from "../../lib/taskTrackIndex.js";
import { listAllTrackSteps, listTracks } from "../../lib/tracks.js";
import { groupStepsByTrack } from "../../lib/tracksView.js";

/**
 * todo 页一次订阅的 task→track 反查索引；TodoPage 顶层调一次，经 metaChip 组合函数下发到各行。
 *
 * **`actionTags` 的顺序承重**：第 0 位是「待我处理」约定位，决定徽章走 warn 档
 * （见 `lib/trackBadgeTone.ts: badgeToneForSignal`，同口径也用在 `tracksDispatch.classify`
 * 与 `useTrackAttentionCount`）。本 hook 只把数组整体透传下去，重排 / 去重它会静默改变徽章配色。
 *
 * `listTracks("active")` 的参数不是冗余的下游二次过滤：传 status 才走 Dexie 的 status 索引，
 * 不传则全表扫（含全部历史 concluded 轨道）——删了它功能测试照绿、代价随归档堆积只增不减。
 */
export function useTaskTrackIndex(): Map<string, TaskTrackInfo> {
  const tracks = useLiveQuery(() => listTracks("active"), [], []);
  const steps = useLiveQuery(() => listAllTrackSteps(), [], []);
  const actionTags = useTrackActionTags();
  const agentExecTags = useAgentExecTags();
  return useMemo(
    () => buildTaskTrackIndex(tracks, groupStepsByTrack(steps), actionTags, agentExecTags),
    [tracks, steps, actionTags, agentExecTags],
  );
}
