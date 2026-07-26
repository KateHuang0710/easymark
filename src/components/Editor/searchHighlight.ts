export interface SearchTextSegment {
  text: string
  matched: boolean
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function splitSearchTerms(query: string): string[] {
  return [...new Set(query.trim().split(/\s+/).filter(Boolean).map(term => term.toLocaleLowerCase()))]
    .sort((a, b) => b.length - a.length)
}

export function segmentSearchMatches(text: string, query: string): SearchTextSegment[] {
  const terms = splitSearchTerms(query)
  if (!terms.length) return [{ text, matched: false }]
  const termSet = new Set(terms)
  const expression = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'giu')
  return text.split(expression).filter(Boolean).map(part => ({
    text: part,
    matched: termSet.has(part.toLocaleLowerCase()),
  }))
}
