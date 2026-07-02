import { useLiveQuery } from "dexie-react-hooks";
import { useTrackActionTags } from "../lib/settings/trackActionTagsSetting.js";
import { listAllTrackSteps, listTracks } from "../lib/tracks.js";
import { boardItemsForTracks, groupStepsByTrack, partitionTracks, type TrackBoardItem } from "../lib/tracksView.js";

// 「待我处理」约定 = 第一个配置的看板信号（默认词表首位即 待我处理）。
// 统计当前看板信号命中该 tag 的 active 轨道数，作为导航「轨道」图标的回手 badge（TK-12）。
export function countAttentionTracks(items: readonly TrackBoardItem[], attentionTag: string | undefined): number {
  if (!attentionTag) return 0;
  return items.reduce((count, item) => (item.signal?.tag === attentionTag ? count + 1 : count), 0);
}

export function useTrackAttentionCount(): number {
  const tracks = useLiveQuery(() => listTracks(), [], []);
  const steps = useLiveQuery(() => listAllTrackSteps(), [], []);
  const actionTags = useTrackActionTags();
  const { active } = partitionTracks(tracks);
  const byTrack = groupStepsByTrack(steps);
  const items = boardItemsForTracks(active, byTrack, actionTags);
  return countAttentionTracks(items, actionTags[0]);
}
