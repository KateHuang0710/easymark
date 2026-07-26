import { describe, expect, it } from 'vitest'
import { segmentSearchMatches, splitSearchTerms } from './searchHighlight'

describe('search highlighting', () => {
  it('highlights each term from a multi-word search independently', () => {
    expect(segmentSearchMatches('foo appears before bar', 'foo bar')).toEqual([
      { text: 'foo', matched: true },
      { text: ' appears before ', matched: false },
      { text: 'bar', matched: true },
    ])
  })

  it('deduplicates terms case-insensitively and prefers longer alternatives', () => {
    expect(splitSearchTerms('Mark markdown MARK')).toEqual(['markdown', 'mark'])
    expect(segmentSearchMatches('Markdown mark', 'mark markdown').filter(part => part.matched).map(part => part.text))
      .toEqual(['Markdown', 'mark'])
  })

  it('treats regular-expression characters as literal text', () => {
    expect(segmentSearchMatches('Use C++ here', 'C++')).toEqual([
      { text: 'Use ', matched: false },
      { text: 'C++', matched: true },
      { text: ' here', matched: false },
    ])
  })
})
