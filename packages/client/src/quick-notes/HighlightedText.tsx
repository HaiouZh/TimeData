import { Fragment } from "react";
import { splitHighlight } from "./highlightMatches.js";

export default function HighlightedText({ text, terms }: { text: string; terms: string[] }) {
  const segments = splitHighlight(text, terms);
  let offset = 0;

  return (
    <span className="whitespace-pre-wrap break-words">
      {segments.map((segment) => {
        const start = offset;
        offset += segment.text.length;
        const key = `${start}-${offset}-${segment.match ? "match" : "text"}`;
        return segment.match ? (
          <mark key={key} className="rounded bg-accent-soft px-0.5 text-accent-ink">
            {segment.text}
          </mark>
        ) : (
          <Fragment key={key}>{segment.text}</Fragment>
        );
      })}
    </span>
  );
}
