import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import { useAgentExecTags } from "../../lib/settings/trackAgentExecTagsSetting.js";
import { useTrackActionTags } from "../../lib/settings/trackActionTagsSetting.js";
import { buildTaskTrackIndex, type TaskTrackInfo } from "../../lib/taskTrackIndex.js";
import { listAllTrackSteps, listTracks } from "../../lib/tracks.js";
import { groupStepsByTrack } from "../../lib/tracksView.js";

/** todo 页一次订阅的 task→track 反查索引；TodoPage 顶层调一次，经 metaChip 组合函数下发到各行。 */
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
