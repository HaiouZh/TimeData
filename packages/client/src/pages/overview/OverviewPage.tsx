import { MagnifyingGlass } from "@phosphor-icons/react";
import { useLiveQuery } from "dexie-react-hooks";
import { useCallback, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Icon } from "../../components/Icon.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { PageHeader } from "../../components/ui/PageHeader.js";
import { useNowMinute } from "../../hooks/useNowMinute.js";
import { listGoals } from "../../lib/goals.js";
import { listAllQuickNotesForOverview } from "../../lib/overview/overviewData.js";
import { buildOverviewModel, clusterTitlesByStarKey } from "../../lib/overview/overviewModel.js";
import { searchOverview } from "../../lib/overview/overviewSearch.js";
import { buildOverviewStars, type OverviewStar } from "../../lib/overview/overviewStars.js";
import { listAllTrackSteps, listTracks } from "../../lib/tracks.js";
import { useIsWideScreen } from "../../lib/useIsWideScreen.js";
import { listAllTasksForGoals } from "../goals/goalPageData.js";
import { OverviewEntryBox } from "./OverviewEntryBox.js";
import { OverviewList } from "./OverviewList.js";
import { OverviewSky } from "./OverviewSky.js";
import { OverviewStarSheet } from "./OverviewStarSheet.js";
import { OverviewTallyPanel } from "./OverviewTallyPanel.js";
import { OverviewLegend } from "./overviewGlyphs.js";

const HOUR_MS = 3_600_000;

/** 全貌页：五份数据到齐前只放加载占位，到齐后按宽窄屏摆天空或清单。 */
export function OverviewPage(): React.JSX.Element {
  const goals = useLiveQuery(() => listGoals());
  const tasks = useLiveQuery(() => listAllTasksForGoals());
  const tracks = useLiveQuery(() => listTracks());
  const steps = useLiveQuery(() => listAllTrackSteps());
  const quickNotes = useLiveQuery(() => listAllQuickNotesForOverview());
  const nowMinute = useNowMinute();
  // 状态章、暗处、做完窗口都按天算，「现在」整点换一次就够；跟着分钟走会每分钟重算全部星
  const nowHourMs = Math.floor(nowMinute.getTime() / HOUR_MS) * HOUR_MS;
  const now = useMemo(() => new Date(nowHourMs), [nowHourMs]);
  const wide = useIsWideScreen();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [openStarKey, setOpenStarKey] = useState<string | null>(null);

  const index = useMemo(() => {
    if (tasks === undefined || tracks === undefined || steps === undefined || quickNotes === undefined) return null;
    return buildOverviewStars({ tasks, tracks, steps, quickNotes, now });
  }, [tasks, tracks, steps, quickNotes, now]);

  const openStar = useMemo(() => {
    if (openStarKey === null || index === null) return null;
    return index.stars.find((star) => star.key === openStarKey) ?? null;
  }, [index, openStarKey]);

  const model = useMemo(() => {
    if (goals === undefined || index === null) return null;
    return buildOverviewModel({ goals, index, now });
  }, [goals, index, now]);

  const search = useMemo(() => {
    if (model === null) return null;
    return searchOverview(model.clusters, query);
  }, [model, query]);

  const titlesByStar = useMemo(() => {
    if (model === null) return new Map<string, string[]>();
    return clusterTitlesByStarKey(model.clusters);
  }, [model]);

  const closeSheet = useCallback(() => setOpenStarKey(null), []);

  const clearQuery = useCallback(() => setQuery(""), []);

  const handleOpenStar = useCallback(
    (star: OverviewStar) => {
      // 项目进度的星直接进轨道页，其余弹详情
      if (star.kind === "progress") {
        navigate(star.href);
        return;
      }
      setOpenStarKey(star.key);
    },
    [navigate],
  );

  if (model === null) return <div data-overview-loading />;

  const clusters = search === null ? model.clusters : search.clusters;
  const nothingFound = search !== null && search.clusters.length === 0;

  return (
    <div className="min-h-full bg-page text-ink">
      <PageHeader
        title="全貌"
        actions={
          <Link to="/goals/manage" className="rounded-ctl px-2 py-1.5 td-text-label text-accent-ink transition hover:bg-surface-hover">
            管理事情
          </Link>
        }
      />
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-4 pb-24 lg:max-w-6xl">
        <OverviewEntryBox wide={wide} onSubmitted={clearQuery} />
        <div className="flex items-center gap-2 rounded-card border border-border bg-surface px-3 py-2">
          <Icon icon={MagnifyingGlass} size={16} className="text-ink-3" />
          <input type="search" aria-label="找星星" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="找星星…" className="min-w-0 flex-1 bg-transparent text-ink placeholder:text-ink-3 outline-none" />
          <span role="status" className="shrink-0 td-text-caption text-ink-3">{search === null ? "" : `找到 ${search.matchCount} 颗`}</span>
        </div>
        {nothingFound ? (
          <EmptyState title="没找到匹配的星" description="换个词试试" />
        ) : wide ? (
          <div className="flex flex-col gap-3">
            <OverviewLegend />
            <OverviewSky clusters={clusters} onOpenStar={handleOpenStar} />
          </div>
        ) : (
          <OverviewList clusters={clusters} onOpenStar={handleOpenStar} />
        )}
        <OverviewTallyPanel tally={model.tally} />
      </div>
      <OverviewStarSheet star={openStar} clusterTitles={openStar === null ? [] : (titlesByStar.get(openStar.key) ?? [])} onClose={closeSheet} />
    </div>
  );
}

export default OverviewPage;
