import { Link } from "react-router";
import { Sheet } from "../../components/ui/Sheet.js";
import type { OverviewStar } from "../../lib/overview/overviewStars.js";
import { getDateString } from "../../lib/time.js";
import { STAR_KIND_LABELS } from "./overviewGlyphs.js";

/** 星详情：底部弹层里看全文或标题、在哪些团、最近动静。 */
export function OverviewStarSheet(props: { star: OverviewStar | null; clusterTitles: readonly string[]; onClose: () => void }): React.JSX.Element {
  const { star, clusterTitles, onClose } = props;
  return (
    <Sheet open={star !== null} onClose={onClose} title={star === null ? undefined : STAR_KIND_LABELS[star.kind]}>
      {star !== null && (
        <div className="flex flex-col gap-3 px-4 pb-4">
          {star.source.type === "quick_note" ? (
            <p className="whitespace-pre-wrap break-words td-text-body text-ink">{star.source.note.text}</p>
          ) : (
            <p className="break-words td-text-body text-ink">{star.title}</p>
          )}
          <p className="td-text-caption text-ink-2">{`在：${clusterTitles.join("、")}`}</p>
          <p className="td-text-caption text-ink-3">{`最近动静 ${getDateString(new Date(star.at))}`}</p>
          <Link to={star.href} onClick={onClose} className="self-start rounded-ctl bg-accent px-3 py-1.5 td-text-label text-page transition hover:bg-accent-strong">
            去原处
          </Link>
        </div>
      )}
    </Sheet>
  );
}
