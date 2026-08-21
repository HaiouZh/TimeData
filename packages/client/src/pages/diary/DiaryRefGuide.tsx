import { getDiaryRefCollapsed, setDiaryRefCollapsed } from "../../lib/diary/diaryRefPrefs.js";
import { CollapsibleSection } from "../todo/CollapsibleSection.js";

/** 存档引导块：只读渲染配置条目，零网络零查询。空 items 由父层整段不渲染，本组件不处理空态。 */
export function DiaryRefGuide({ items }: { items: string[] }) {
  return (
    <CollapsibleSection
      title="引导"
      count={items.length}
      defaultOpen={!getDiaryRefCollapsed("guide")}
      onToggle={(open) => setDiaryRefCollapsed("guide", !open)}
    >
      <ul className="space-y-1" data-testid="diary-ref-guide-list">
        {items.map((item, i) => (
          <li key={`${i}-${item}`} className="break-words px-2 py-1 td-text-label text-ink">
            {item}
          </li>
        ))}
      </ul>
    </CollapsibleSection>
  );
}
