// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  addDeferredDocumentMouseDownListener,
  applyBlockFormat,
  applyNativeEditingCommand,
  editorHtmlToMarkdown,
  exitBlockquoteAtSelection,
  getCaretOffset,
  getHistoryShortcut,
  insertInlineElement,
  insertSoftBreakAtSelection,
  isCaretAtEndOfElement,
  removeCodeBlockAtSelection,
} from './MarkdownEditor'
import { renderMarkdown } from '../../services/markdown'

describe('applyBlockFormat', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('uses the native editing command without replacing the editor root', () => {
    const editor = document.createElement('div')
    editor.contentEditable = 'true'
    editor.innerHTML = '<p>keep this content</p>'
    document.body.appendChild(editor)

    const text = editor.querySelector('p')!.firstChild!
    const range = document.createRange()
    range.setStart(text, 4)
    range.collapse(true)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    const execCommand = vi.fn(() => true)
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand })

    expect(applyBlockFormat(editor, 'h1')).toBe(true)
    expect(execCommand).toHaveBeenCalledWith('formatBlock', false, 'h1')
    expect(editor.isConnected).toBe(true)
    expect(editor.innerHTML).toBe('<p>keep this content</p>')
  })

  it('rejects selections outside the editor', () => {
    const editor = document.createElement('div')
    const outside = document.createTextNode('outside')
    document.body.append(editor, outside)
    const range = document.createRange()
    range.selectNodeContents(outside)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => true) })

    expect(applyBlockFormat(editor, 'h1')).toBe(false)
  })

  it('uses native editing commands for inline formatting', () => {
    const editor = document.createElement('div')
    editor.contentEditable = 'true'
    editor.textContent = 'format me'
    document.body.appendChild(editor)
    const range = document.createRange()
    range.selectNodeContents(editor)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    const execCommand = vi.fn(() => true)
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand })

    expect(applyNativeEditingCommand(editor, 'bold')).toBe(true)
    expect(execCommand).toHaveBeenCalledWith('bold', false, undefined)
  })
})

describe('editorHtmlToMarkdown', () => {
  it('does not save the visual language label as code content', () => {
    const markdown = editorHtmlToMarkdown(
      '<pre data-lang="javascript"><span class="code-lang-label">javascript</span><code>const x = 1</code></pre>',
    )
    expect(markdown).toContain('```javascript\nconst x = 1\n```')
    expect(markdown).not.toContain('javascript\njavascript')
  })

  it('preserves checked and unchecked task-list markers', () => {
    const markdown = editorHtmlToMarkdown(
      '<ul><li><input type="checkbox" checked disabled>done</li><li><input type="checkbox" disabled>todo</li></ul>',
    )
    expect(markdown).toContain('[x] done')
    expect(markdown).toContain('[ ] todo')
  })

  it('converts protected asset URLs back to portable relative paths', () => {
    expect(editorHtmlToMarkdown('<p><img src="easymark-asset://local/image-1.png" alt="image"></p>'))
      .toBe('![image](assets/image-1.png)')
  })

  it('preserves common structured Markdown through the visual editor', () => {
    const source = [
      '# Heading',
      '',
      '- [x] finished',
      '- [ ] pending',
      '',
      '```typescript',
      'const value = 1',
      '```',
      '',
      '![image](assets/image-1.png)',
      '',
      '~~removed~~',
      '',
      '| Name | Value |',
      '| --- | ---: |',
      '| alpha | **one** |',
    ].join('\n')
    const html = renderMarkdown(source)
    expect(html).toContain('<input')
    expect(html).toContain('align="right"')
    const markdown = editorHtmlToMarkdown(html)

    expect(markdown).toContain('# Heading')
    expect(markdown).toContain('[x] finished')
    expect(markdown).toContain('[ ] pending')
    expect(markdown).toContain('```typescript\nconst value = 1\n```')
    expect(markdown).toContain('![image](assets/image-1.png)')
    expect(markdown).toContain('~~removed~~')
    expect(markdown).toContain('| Name | Value |')
    expect(markdown).toContain('| --- | ---: |')
    expect(markdown).toContain('| alpha | **one** |')
  })

  it('uses a longer fence when code contains triple backticks', () => {
    const markdown = editorHtmlToMarkdown('<pre data-lang=""><code>before ``` after</code></pre>')
    expect(markdown).toContain('````\nbefore ``` after\n````')
  })

  it('preserves code when formatBlock creates a pre without a code child', () => {
    expect(editorHtmlToMarkdown('<pre>plain code</pre>')).toContain('```\nplain code\n```')
  })

  it('does not mistake the highlight.js marker class for a language', () => {
    const markdown = editorHtmlToMarkdown('<pre data-lang=""><code class="hljs">plain code</code></pre>')
    expect(markdown).toContain('```\nplain code\n```')
    expect(markdown).not.toContain('```hljs')
  })

  it('reads only a real language class when data-lang is absent', () => {
    expect(editorHtmlToMarkdown('<pre><code class="hljs language-python">print(1)</code></pre>'))
      .toContain('```python\nprint(1)\n```')
  })

  it('preserves underline markup instead of silently dropping the format', () => {
    expect(editorHtmlToMarkdown('<p><u>important</u></p>')).toBe('<u>important</u>')
  })

  it('preserves semantic inline code and links inserted by the visual editor', () => {
    expect(editorHtmlToMarkdown('<p><code>value</code> and <a href="https://example.com/">site</a></p>'))
      .toBe('`value` and [site](https://example.com/)')
  })
})

describe('visual editor selection helpers', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    window.getSelection()?.removeAllRanges()
  })

  it('inserts semantic inline elements instead of escaped Markdown text', () => {
    const editor = document.createElement('div')
    editor.textContent = 'selected text'
    document.body.appendChild(editor)
    const range = document.createRange()
    range.selectNodeContents(editor)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => false) })

    expect(insertInlineElement(editor, 'code')).toBe(true)
    expect(editor.innerHTML).toBe('<code>selected text</code>')
    expect(editorHtmlToMarkdown(editor.innerHTML)).toBe('`selected text`')
  })

  it('does not calculate a caret for a different editor pane', () => {
    const first = document.createElement('div')
    const second = document.createElement('div')
    first.textContent = 'first'
    second.textContent = 'second'
    document.body.append(first, second)
    const range = document.createRange()
    range.setStart(first.firstChild!, 2)
    range.collapse(true)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    expect(getCaretOffset(first)).toBe(2)
    expect(getCaretOffset(second)).toBeNull()
  })

  it('detects the true end of a heading with nested formatting', () => {
    const heading = document.createElement('h1')
    heading.innerHTML = '<strong>bold</strong> tail'
    document.body.appendChild(heading)
    const range = document.createRange()
    range.setStart(heading.querySelector('strong')!.firstChild!, 4)
    range.collapse(true)
    expect(isCaretAtEndOfElement(heading, range)).toBe(false)
    range.setStart(heading.lastChild!, 5)
    range.collapse(true)
    expect(isCaretAtEndOfElement(heading, range)).toBe(true)
  })
})

describe('editor history shortcuts', () => {
  it('supports macOS and Windows undo and redo variants case-insensitively', () => {
    expect(getHistoryShortcut('z')).toBe('undo')
    expect(getHistoryShortcut('Z', true)).toBe('redo')
    expect(getHistoryShortcut('y')).toBe('redo')
    expect(getHistoryShortcut('b')).toBeNull()
  })
})

describe('blockquote keyboard behavior', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    window.getSelection()?.removeAllRanges()
    vi.restoreAllMocks()
  })

  it('exits the quote at the caret and preserves trailing quoted text', () => {
    const editor = document.createElement('div')
    editor.contentEditable = 'true'
    editor.innerHTML = '<blockquote><p>before after</p></blockquote>'
    document.body.appendChild(editor)
    const text = editor.querySelector('p')!.firstChild!
    const range = document.createRange()
    range.setStart(text, 6)
    range.collapse(true)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    expect(exitBlockquoteAtSelection(editor, selection)).toBe(true)
    expect(editor.innerHTML).toBe('<blockquote><p>before</p></blockquote><p><br></p><blockquote><p> after</p></blockquote>')
    expect(selection.anchorNode).toBe(editor.children[1])
  })

  it('inserts a soft break inside the current quote', () => {
    const editor = document.createElement('div')
    editor.contentEditable = 'true'
    editor.innerHTML = '<blockquote><p>quoted</p></blockquote>'
    document.body.appendChild(editor)
    const text = editor.querySelector('p')!.firstChild!
    const range = document.createRange()
    range.setStart(text, 3)
    range.collapse(true)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => false) })
    expect(insertSoftBreakAtSelection(editor, selection)).toBe(true)
    expect(editor.querySelector('blockquote')!.innerHTML).toBe('<p>quo<br>ted</p>')
  })
})

describe('removeCodeBlockAtSelection', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    window.getSelection()?.removeAllRanges()
  })

  it('removes the only empty code block without leaving its bordered pre element', () => {
    const editor = document.createElement('div')
    editor.contentEditable = 'true'
    editor.innerHTML = '<pre data-lang=""><code class="hljs"><br></code></pre>'
    document.body.appendChild(editor)
    const code = editor.querySelector('code')!
    const range = document.createRange()
    range.setStart(code, 0)
    range.collapse(true)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    expect(removeCodeBlockAtSelection(editor, selection)).toBe(true)
    expect(editor.querySelector('pre')).toBeNull()
    expect(editor.innerHTML).toBe('<p><br></p>')
  })

  it('does not remove a code block that still contains code', () => {
    const editor = document.createElement('div')
    editor.innerHTML = '<pre><code>const value = 1</code></pre>'
    document.body.appendChild(editor)
    const codeText = editor.querySelector('code')!.firstChild!
    const range = document.createRange()
    range.setStart(codeText, 0)
    range.collapse(true)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    expect(removeCodeBlockAtSelection(editor, selection)).toBe(false)
    expect(editor.querySelector('pre')).not.toBeNull()
  })

  it('removes the code block when all of its code is selected', () => {
    const editor = document.createElement('div')
    editor.innerHTML = '<p>before</p><pre data-lang="javascript"><span class="code-lang-label">javascript</span><code>const value = 1</code></pre>'
    document.body.appendChild(editor)
    const code = editor.querySelector('code')!
    const range = document.createRange()
    range.selectNodeContents(code)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    expect(removeCodeBlockAtSelection(editor, selection)).toBe(true)
    expect(editor.querySelector('pre')).toBeNull()
    expect(editor.textContent).toBe('before')
  })
})


describe('addDeferredDocumentMouseDownListener', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('does not register the listener after cleanup runs before the timer', () => {
    vi.useFakeTimers()
    const add = vi.spyOn(document, 'addEventListener')
    const handler = vi.fn()

    const cleanup = addDeferredDocumentMouseDownListener(handler)
    cleanup()
    vi.runAllTimers()

    expect(add).not.toHaveBeenCalledWith('mousedown', handler)
  })

  it('removes a listener that was already registered', () => {
    vi.useFakeTimers()
    const remove = vi.spyOn(document, 'removeEventListener')
    const handler = vi.fn()

    const cleanup = addDeferredDocumentMouseDownListener(handler)
    vi.runAllTimers()
    cleanup()

    expect(remove).toHaveBeenCalledWith('mousedown', handler)
  })
})
