import type { Track, TrackStep } from "@timedata/shared";
import { bucketForTrack } from "../progressAxis.js";
import { lastActivityAt } from "../tracksView.js";

/** 轨道行落哪个区。todo 页只收这两个——settled 不显示、轨道没有 inbox/upcoming 语义。 */
export type TodoTrackZone = "today" | "waiting";

export interface TodoTrackRow {
  track: Track;
  steps: TrackStep[];
  zone: TodoTrackZone;
  stepCount: number;
  hasOpenStep: boolean;
}

/**
 * 没被任何任务行徽章认领的 active 轨道 → todo 页的独立行。
 *
 * 去重判据只认 `claimedTrackIds`（来自 `buildTaskTrackIndex` 的输出），**刻意不复用
 * `buildProgressItems` 的 `consumedTrackIds`**：那份多一道「被认领的任务本身要进面板」的条件，
 * 于是轨道挂在子任务上时两处判定相反，同一条轨道会既有徽章又独立成行。
 *
 * 落区一律经 `bucketForTrack`，不自行判停滞或开口步——阈值口径只有一份。
 */
export function todoTrackRows(
  tracks: readonly Track[],
  stepsByTrack: ReadonlyMap<string, TrackStep[]>,
  claimedTrackIds: ReadonlySet<string>,
  now: Date,
): TodoTrackRow[] {
  const rows: TodoTrackRow[] = [];

  for (const track of tracks) {
    if (claimedTrackIds.has(track.id)) continue;
    const steps = stepsByTrack.get(track.id) ?? [];
    const bucket = bucketForTrack(track, steps, now);
    // queued（一步没写）与 doing 同落今天：刚建的轨道不显示会让人找不到它，
    // 且 7 天不动会自动掉进 waiting。settled 不成行——取数已按 active 过滤，这里是双保险。
    const zone: TodoTrackZone | null =
      bucket === "doing" || bucket === "queued" ? "today" : bucket === "waiting" ? "waiting" : null;
    if (zone === null) continue;

    rows.push({
      track,
      steps,
      zone,
      stepCount: steps.length,
      hasOpenStep: steps.some((step) => step.endedAt === null),
    });
  }

  return rows.sort((a, b) => {
    const at = lastActivityAt([...a.steps]) ?? a.track.createdAt;
    const bt = lastActivityAt([...b.steps]) ?? b.track.createdAt;
    return bt.localeCompare(at);
  });
}
