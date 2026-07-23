// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { countOccurrences, createTextRange, findMatchIndex } from './SearchReplace'

describe('SearchReplace helpers', () => {
  it('moves backwards and wraps around correctly', () => {
    expect(findMatchIndex('one two one', 'one', 8, -1, true)).toBe(0)
    expect(findMatchIndex('one two one', 'one', 0, -1, true)).toBe(8)
    expect(findMatchIndex('one two one', 'one', 0, 1, true)).toBe(8)
  })

  it('counts matches after content changes', () => {
    expect(countOccurrences('one one', 'one')).toBe(2)
    expect(countOccurrences('one', 'two')).toBe(0)
  })

  it('creates a range for a match spanning multiple text nodes', () => {
    const editor = document.createElement('div')
    editor.innerHTML = 'a<strong>b</strong>c'
    document.body.appendChild(editor)
    const range = createTextRange(editor, 0, 3)
    expect(range?.toString()).toBe('abc')
    editor.remove()
  })
})
