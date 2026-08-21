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
        {(() => {
          // 条目允许重复（同一句提示写两遍合法），单用文本做 key 会撞；
          // 「文本 + 同文出现序」让不重复条目的 key 与位置无关，插入/删除不整列失效。
          const seen = new Map<string, number>();
          return items.map((item) => {
            const nth = seen.get(item) ?? 0;
            seen.set(item, nth + 1);
            return (
              <li key={`${item}#${nth}`} className="break-words px-2 py-1 td-text-label text-ink">
                {item}
              </li>
            );
          });
        })()}
      </ul>
    </CollapsibleSection>
  );
}
