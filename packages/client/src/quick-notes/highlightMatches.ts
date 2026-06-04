export interface HighlightSegment {
  text: string;
  match: boolean;
}

export function splitHighlight(text: string, terms: string[]): HighlightSegment[] {
  if (!text || terms.length === 0) return [{ text, match: false }];

  const lowerText = text.toLowerCase();
  const ranges: Array<[number, number]> = [];

  for (const rawTerm of terms) {
    const term = rawTerm.toLowerCase();
    if (!term) continue;

    let start = lowerText.indexOf(term);
    while (start !== -1) {
      ranges.push([start, start + term.length]);
      start = lowerText.indexOf(term, start + term.length);
    }
  }

  if (ranges.length === 0) return [{ text, match: false }];

  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of ranges) {
    const previous = merged.at(-1);
    if (previous && start <= previous[1]) {
      previous[1] = Math.max(previous[1], end);
    } else {
      merged.push([start, end]);
    }
  }

  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) segments.push({ text: text.slice(cursor, start), match: false });
    segments.push({ text: text.slice(start, end), match: true });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });

  return segments;
}
