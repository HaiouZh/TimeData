export function parseSearchTerms(query: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];

  for (const term of query.toLowerCase().trim().split(/\s+/)) {
    if (!term || seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
  }

  return terms;
}

export function matchesAllTerms(textLower: string, terms: string[]): boolean {
  return terms.every((term) => textLower.includes(term));
}
