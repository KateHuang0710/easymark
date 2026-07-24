// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { countOccurrences, createTextRange, findMatchIndex, replaceAllTextMatches, replaceRangeText } from './SearchReplace'

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

  it('replaces all matches even when one spans inline DOM nodes', () => {
    const editor = document.createElement('div')
    editor.innerHTML = '<p>alpha <strong>be</strong><em>ta</em> beta</p>'

    expect(replaceAllTextMatches(editor, 'beta', 'done')).toBe(2)
    expect(editor.textContent).toBe('alpha done done')
  })

  it('uses the native editing command so a replacement can be undone', () => {
    const editor = document.createElement('div')
    editor.textContent = 'before'
    document.body.appendChild(editor)
    const range = document.createRange()
    range.selectNodeContents(editor)
    const execCommand = vi.fn(() => true)
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand })

    replaceRangeText(range, 'after')

    expect(execCommand).toHaveBeenCalledWith('insertText', false, 'after')
  })
})
