// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  addDeferredDocumentMouseDownListener,
  addVisualTableColumn,
  addVisualTableRow,
  alignVisualTableColumn,
  applyBlockFormat,
  applyNativeEditingCommand,
  applyTextAreaEdit,
  createVisualTable,
  deleteVisualTableColumn,
  deleteVisualTableColumnAtCell,
  deleteVisualTableRow,
  editTextIndent,
  editorHtmlToMarkdown,
  expandAllEditorFolds,
  exitBlockquoteAtSelection,
  getCaretOffset,
  getHistoryShortcut,
  insertCodeBlockAtSelection,
  insertInlineElement,
  insertParagraphAfterHeading,
  insertParagraphAfterCodeBlock,
  insertTableAtSelection,
  insertSoftBreakAtSelection,
  isCaretAtEndOfElement,
  moveAcrossVisualTable,
  removeCodeBlockAtSelection,
  parseCsvTable,
  replaceVisualTableFromCsv,
  sortVisualTableColumn,
  syncCodeBlockLanguageHistory,
  toggleHeadingFold,
  toggleListFold,
  updateCodeBlockLanguage,
  visualTableToCsv,
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

  it('treats code metadata as authoritative over stale pre metadata', () => {
    expect(editorHtmlToMarkdown('<pre data-lang="javascript"><code data-lang="python" class="hljs language-python">print(1)</code></pre>'))
      .toContain('```python\nprint(1)\n```')
  })

  it('preserves underline markup instead of silently dropping the format', () => {
    expect(editorHtmlToMarkdown('<p><u>important</u></p>')).toBe('<u>important</u>')
  })

  it('preserves semantic inline code and links inserted by the visual editor', () => {
    expect(editorHtmlToMarkdown('<p><code>value</code> and <a href="https://example.com/">site</a></p>'))
      .toBe('`value` and [site](https://example.com/)')
  })

  it('preserves a same-item line break and following body text in numbered lists', () => {
    expect(editorHtmlToMarkdown('<ol><li>编号标题<br>编号内正文</li></ol>'))
      .toBe('1.  编号标题  \n    编号内正文')
  })

  it('keeps normal body text outside a completed numbered list', () => {
    expect(editorHtmlToMarkdown('<ol><li>编号标题</li></ol><p>普通正文</p>'))
      .toBe('1.  编号标题\n\n普通正文')
  })

  it('keeps body text outside a wrapped code block exit transaction', () => {
    expect(editorHtmlToMarkdown('<div><pre data-lang="python"><code>value</code></pre><p>BODY</p></div>'))
      .toBe('```python\nvalue\n```\n\nBODY')
  })

  it('normalizes Chromium nested-list siblings before saving Markdown', () => {
    expect(editorHtmlToMarkdown('<ol><li>one</li><ol><li>two</li></ol></ol>'))
      .toBe('1.  one\n    1.  two')
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

  it('does not treat a caret before a trailing non-text element as the end', () => {
    const heading = document.createElement('h1')
    heading.innerHTML = 'title<img src="x.png" alt="diagram">'
    document.body.appendChild(heading)
    const range = document.createRange()
    range.setStart(heading.firstChild!, 5)
    range.collapse(true)

    expect(isCaretAtEndOfElement(heading, range)).toBe(false)
  })

  it('uses an undoable native paragraph command after a heading', () => {
    const editor = document.createElement('div')
    editor.contentEditable = 'true'
    editor.innerHTML = '<h3>Heading</h3>'
    document.body.appendChild(editor)
    const heading = editor.querySelector('h3')!
    const range = document.createRange()
    range.setStart(heading.firstChild!, heading.textContent!.length)
    range.collapse(true)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    const execCommand = vi.fn(() => true)
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand })

    expect(insertParagraphAfterHeading(editor, heading, selection)).toBe(true)
    expect(execCommand).toHaveBeenCalledWith('insertParagraph', false, undefined)
  })

  it('falls back to a normal paragraph when the native heading command is unavailable', () => {
    const editor = document.createElement('div')
    editor.contentEditable = 'true'
    editor.innerHTML = '<h3>Heading</h3>'
    document.body.appendChild(editor)
    const heading = editor.querySelector('h3')!
    const range = document.createRange()
    range.setStart(heading.firstChild!, heading.textContent!.length)
    range.collapse(true)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => false) })

    expect(insertParagraphAfterHeading(editor, heading, selection)).toBe(true)
    expect(editor.innerHTML).toBe('<h3>Heading</h3><p><br></p>')
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

describe('source editor indentation', () => {
  it('inserts and removes indentation at a collapsed caret', () => {
    expect(editTextIndent('alpha', 2, 2)).toEqual({
      value: 'al    pha',
      selectionStart: 6,
      selectionEnd: 6,
    })
    expect(editTextIndent('    alpha', 4, 4, true)).toEqual({
      value: 'alpha',
      selectionStart: 0,
      selectionEnd: 0,
    })
  })

  it('indents and outdents every selected line without deleting the selection', () => {
    const indented = editTextIndent('one\ntwo\nthree', 1, 7)
    expect(indented).toEqual({
      value: '    one\n    two\nthree',
      selectionStart: 0,
      selectionEnd: 15,
    })
    expect(editTextIndent(indented.value, indented.selectionStart, indented.selectionEnd, true)).toEqual({
      value: 'one\ntwo\nthree',
      selectionStart: 0,
      selectionEnd: 7,
    })
  })

  it('applies the smallest native textarea edit so indentation stays undoable', () => {
    const textarea = document.createElement('textarea')
    textarea.value = 'one\ntwo'
    document.body.appendChild(textarea)
    const execCommand = vi.fn((_command: string, _showUi: boolean, replacement: string) => {
      textarea.setRangeText(replacement, textarea.selectionStart, textarea.selectionEnd, 'end')
      return true
    })
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand })

    const edit = editTextIndent(textarea.value, 4, 7)
    expect(applyTextAreaEdit(textarea, edit)).toBe(true)
    expect(textarea.value).toBe('one\n    two')
    expect(execCommand).toHaveBeenCalledWith('insertText', false, '    ')
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([4, 11])
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

  it('uses one native HTML transaction when exiting at the end', () => {
    const editor = document.createElement('div')
    editor.contentEditable = 'true'
    editor.innerHTML = '<blockquote><p>quoted</p></blockquote>'
    document.body.appendChild(editor)
    const text = editor.querySelector('p')!.firstChild!
    const range = document.createRange()
    range.setStart(text, text.textContent!.length)
    range.collapse(true)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    const execCommand = vi.fn(() => true)
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand })

    expect(exitBlockquoteAtSelection(editor, selection)).toBe(true)
    expect(execCommand).toHaveBeenCalledTimes(1)
    expect(execCommand).toHaveBeenCalledWith(
      'insertHTML',
      false,
      '<blockquote><p>quoted</p></blockquote><p data-easymark-quote-exit="true"><br></p>',
    )
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

  it('uses a native replacement for the only code block', () => {
    const editor = document.createElement('div')
    editor.contentEditable = 'true'
    editor.innerHTML = '<pre><code><br></code></pre>'
    document.body.appendChild(editor)
    const code = editor.querySelector('code')!
    const range = document.createRange()
    range.setStart(code, 0)
    range.collapse(true)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    const execCommand = vi.fn((command: string, _showUi: boolean, html?: string) => {
      if (command !== 'insertHTML' || html === undefined) return false
      const activeRange = selection.getRangeAt(0)
      activeRange.deleteContents()
      const template = document.createElement('template')
      template.innerHTML = html
      activeRange.insertNode(template.content)
      return true
    })
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand })

    expect(removeCodeBlockAtSelection(editor, selection)).toBe(true)
    expect(editor.innerHTML).toBe('<p><br></p>')
    expect(execCommand).toHaveBeenCalledTimes(1)
  })
})

describe('native code-block editing', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    window.getSelection()?.removeAllRanges()
    vi.restoreAllMocks()
  })

  function emulateInsertHtml(selection: Selection) {
    return vi.fn((command: string, _showUi: boolean, html?: string) => {
      if (command === 'defaultParagraphSeparator') return true
      if (command === 'insertParagraph') {
        const range = selection.getRangeAt(0)
        const paragraph = document.createElement('p')
        paragraph.appendChild(document.createElement('br'))
        range.insertNode(paragraph)
        range.setStartAfter(paragraph)
        range.collapse(true)
        return true
      }
      if (command !== 'insertHTML' || html === undefined) return false
      const range = selection.getRangeAt(0)
      range.deleteContents()
      const template = document.createElement('template')
      template.innerHTML = html
      range.insertNode(template.content)
      return true
    })
  }

  function emulateNativeHistory(editor: HTMLElement, selection: Selection) {
    const history = [editor.innerHTML]
    let historyIndex = 0
    return vi.fn((command: string, _showUi?: boolean, html?: string) => {
      if (command === 'defaultParagraphSeparator') return true
      if (command === 'insertHTML' && html !== undefined) {
        const range = selection.getRangeAt(0)
        range.deleteContents()
        const template = document.createElement('template')
        template.innerHTML = html
        range.insertNode(template.content)
        history.splice(historyIndex + 1)
        history.push(editor.innerHTML)
        historyIndex = history.length - 1
        return true
      }
      if (command === 'insertParagraph') {
        const range = selection.getRangeAt(0)
        const paragraph = document.createElement('p')
        paragraph.appendChild(document.createElement('br'))
        range.insertNode(paragraph)
        range.setStartAfter(paragraph)
        range.collapse(true)
        history.splice(historyIndex + 1)
        history.push(editor.innerHTML)
        historyIndex = history.length - 1
        return true
      }
      if (command === 'undo' && historyIndex > 0) {
        historyIndex -= 1
        editor.innerHTML = history[historyIndex]
        return true
      }
      if (command === 'redo' && historyIndex < history.length - 1) {
        historyIndex += 1
        editor.innerHTML = history[historyIndex]
        return true
      }
      return false
    })
  }

  it('inserts a semantic code block through one native transaction', () => {
    const editor = document.createElement('div')
    editor.contentEditable = 'true'
    editor.innerHTML = '<p>code</p>'
    document.body.appendChild(editor)
    const range = document.createRange()
    range.selectNodeContents(editor.querySelector('p')!)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    const execCommand = emulateInsertHtml(selection)
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand })

    expect(insertCodeBlockAtSelection(editor, 'typescript', true, selection)).toBe(true)
    expect(editor.querySelector('pre')?.getAttribute('data-lang')).toBe('typescript')
    expect(editor.querySelector('code')?.textContent).toBe('code')
    expect(editor.querySelector('.code-lang-label')?.textContent).toBe('typescript')
    expect(execCommand).toHaveBeenCalledTimes(1)
  })

  it('changes language in place and exits without nesting adjacent content', () => {
    const editor = document.createElement('div')
    editor.contentEditable = 'true'
    editor.innerHTML = '<div class="code-block-wrapper"><pre data-lang="js"><span class="code-lang-label" contenteditable="false">js</span><code class="hljs language-js">value</code></pre></div><table><tbody><tr><td>keep</td></tr></tbody></table>'
    document.body.appendChild(editor)
    const codeText = editor.querySelector('code')!.firstChild!
    const range = document.createRange()
    range.setStart(codeText, 3)
    range.collapse(true)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    const execCommand = emulateInsertHtml(selection)
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand })

    const originalPre = editor.querySelector('pre')!
    expect(updateCodeBlockLanguage(editor, originalPre, 'python', true, selection)).toBe(true)
    const updatedPre = editor.querySelector('pre')!
    expect(updatedPre).toBe(originalPre)
    expect(updatedPre.getAttribute('data-lang')).toBe('python')
    expect(updatedPre.querySelector('.code-lang-label')?.textContent).toBe('python')
    expect(updatedPre.querySelector('code')?.getAttribute('data-lang')).toBe('python')
    expect(updatedPre.querySelector('code')?.textContent).toBe('value')
    expect(editor.querySelector('.code-block-wrapper')?.nextElementSibling?.tagName).toBe('TABLE')
    const insertCalls = execCommand.mock.calls.filter(call => call[0] === 'insertHTML')
    expect(insertCalls).toHaveLength(1)
    expect(insertCalls[0][2]).toContain('code-lang-history-value')
    expect(insertCalls[0][2]).not.toContain('<pre')
    expect(insertCalls[0][2]).not.toContain('<table')
    expect(insertParagraphAfterCodeBlock(editor, updatedPre, selection)).toBe(true)
    expect(editor.querySelector('pre')?.getAttribute('data-lang')).toBe('python')
    expect(editor.querySelector('p')).not.toBeNull()
    expect(execCommand.mock.calls.filter(call => call[0] === 'insertHTML')).toHaveLength(1)
  })

  it('places an exited paragraph outside a wrapped code block', () => {
    const editor = document.createElement('div')
    editor.contentEditable = 'true'
    editor.innerHTML = '<div class="code-block-wrapper"><pre data-lang="python"><code data-lang="python" class="hljs language-python">const x = 1</code></pre></div>'
    document.body.appendChild(editor)
    const codeText = editor.querySelector('code')!.firstChild!
    const range = document.createRange()
    range.setStart(codeText, codeText.textContent!.length)
    range.collapse(true)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    const execCommand = emulateNativeHistory(editor, selection)
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand })

    expect(insertParagraphAfterCodeBlock(editor, editor.querySelector('pre')!, selection)).toBe(true)
    const wrapper = editor.querySelector('.code-block-wrapper')!
    const paragraph = wrapper.nextElementSibling as HTMLElement
    expect(paragraph?.tagName).toBe('P')
    expect(wrapper.querySelector('p')).toBeNull()
    paragraph.textContent = 'BODY'
    expect(editorHtmlToMarkdown(editor.innerHTML)).toBe('```python\nconst x = 1\n```\n\nBODY')
  })

  it('does not invoke Chromium native commands that can nest the exit inside code', () => {
    const editor = document.createElement('div')
    editor.contentEditable = 'true'
    editor.innerHTML = '<pre data-lang="python"><code data-lang="python" class="hljs language-python">const x = 1</code></pre>'
    document.body.appendChild(editor)
    const codeText = editor.querySelector('code')!.firstChild!
    const range = document.createRange()
    range.setStart(codeText, codeText.textContent!.length)
    range.collapse(true)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    const execCommand = vi.fn(() => true)
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand })

    expect(insertParagraphAfterCodeBlock(editor, editor.querySelector('pre')!, selection)).toBe(true)
    expect(execCommand).not.toHaveBeenCalled()
    expect(editor.querySelector('pre')?.nextElementSibling?.tagName).toBe('P')
  })

  it('syncs language metadata when the native history marker is undone and redone', () => {
    const editor = document.createElement('div')
    editor.contentEditable = 'true'
    editor.innerHTML = '<pre data-lang="javascript"><span class="code-lang-label" contenteditable="false">javascript</span><code data-lang="javascript" class="hljs language-javascript">const value = 1</code></pre><p>after</p>'
    document.body.appendChild(editor)
    const codeText = editor.querySelector('code')!.firstChild!
    const range = document.createRange()
    range.setStart(codeText, 2)
    range.collapse(true)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    const execCommand = emulateInsertHtml(selection)
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand })

    expect(updateCodeBlockLanguage(editor, editor.querySelector('pre')!, 'python', true, selection)).toBe(true)
    expect(editorHtmlToMarkdown(editor.innerHTML)).toContain('```python\nconst value = 1\n```')
    expect(editor.querySelector('code')?.getAttribute('data-lang')).toBe('python')
    expect(editor.querySelector('code')?.classList.contains('language-python')).toBe(true)
    expect(editor.querySelector('pre')?.nextElementSibling?.textContent).toBe('after')
    const host = editor.querySelector<HTMLElement>('.code-lang-history-host')!
    const marker = host.querySelector<HTMLElement>('.code-lang-history-value')!
    const savedMarker = marker.cloneNode(true)

    marker.remove()
    expect(syncCodeBlockLanguageHistory(editor, selection)).toBe(true)
    expect(editorHtmlToMarkdown(editor.innerHTML)).toContain('```javascript\nconst value = 1\n```')

    host.appendChild(savedMarker)
    expect(syncCodeBlockLanguageHistory(editor, selection)).toBe(true)
    expect(editorHtmlToMarkdown(editor.innerHTML)).toContain('```python\nconst value = 1\n```')
    expect(execCommand.mock.calls.filter(call => call[0] === 'insertHTML')).toHaveLength(1)
  })

  it('makes deleting an empty code block undoable', () => {
    const editor = document.createElement('div')
    editor.contentEditable = 'true'
    editor.innerHTML = '<pre data-lang=""><code data-lang="" class="hljs"><br></code></pre>'
    document.body.appendChild(editor)
    const code = editor.querySelector('code')!
    const range = document.createRange()
    range.setStart(code, 0)
    range.collapse(true)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    const execCommand = emulateNativeHistory(editor, selection)
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand })

    expect(removeCodeBlockAtSelection(editor, selection)).toBe(true)
    expect(editor.innerHTML).toBe('<p><br></p>')
    expect(document.execCommand('undo')).toBe(true)
    expect(editor.querySelector('pre')).not.toBeNull()
    expect(document.execCommand('redo')).toBe(true)
    expect(editor.innerHTML).toBe('<p><br></p>')
  })
})

describe('visual table editing', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    window.getSelection()?.removeAllRanges()
  })

  it('creates an editable Markdown-compatible table', () => {
    const table = createVisualTable(3, 3)
    const cells = table.querySelectorAll('th,td')
    expect(table.tHead?.rows).toHaveLength(1)
    expect(table.tBodies.item(0)?.rows).toHaveLength(2)
    expect(cells).toHaveLength(9)
    expect(Array.from(table.querySelectorAll('th')).every(cell => cell.querySelector('br'))).toBe(true)
  })

  it('inserts a table at an empty block and places the caret in its first header', () => {
    const editor = document.createElement('div')
    editor.contentEditable = 'true'
    editor.innerHTML = '<p><br></p>'
    document.body.appendChild(editor)
    const paragraph = editor.querySelector('p')!
    const range = document.createRange()
    range.setStart(paragraph, 0)
    range.collapse(true)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    const table = insertTableAtSelection(editor, 3, 2, selection)
    expect(table).not.toBeNull()
    expect(editor.firstElementChild).toBe(table)
    expect(table?.nextElementSibling?.tagName).toBe('P')
    const anchorElement = selection.anchorNode?.nodeType === Node.ELEMENT_NODE
      ? selection.anchorNode as Element
      : selection.anchorNode?.parentElement
    expect(anchorElement?.closest('th')).toBe(table?.querySelector('th'))
  })

  it('adds, aligns, and removes rows and columns without breaking Markdown output', () => {
    const table = createVisualTable(3, 2)
    const firstHeader = table.querySelector('th')!
    firstHeader.textContent = 'Name'
    table.querySelectorAll('th')[1].textContent = 'Value'
    table.querySelector('tbody td')!.textContent = 'alpha'

    const addedRow = addVisualTableRow(table, table.tBodies.item(0)!.rows.item(0))
    expect(addedRow.cells).toHaveLength(2)
    expect(table.tBodies.item(0)?.rows).toHaveLength(3)
    expect(addVisualTableColumn(table, 0)).toBe(1)
    expect(Array.from(table.rows).every(row => row.cells.length === 3)).toBe(true)
    expect(alignVisualTableColumn(table, 1, 'center')).toBe(true)
    expect(Array.from(table.rows).every(row => row.cells.item(1)?.getAttribute('align') === 'center')).toBe(true)
    expect(deleteVisualTableColumn(table, 1)).toBe(true)
    expect(deleteVisualTableRow(table, addedRow)).toBe(true)

    const markdown = editorHtmlToMarkdown(table.outerHTML)
    expect(markdown).toContain('| Name | Value |')
    expect(markdown).toContain('| alpha |')
  })

  it('uses Tab navigation and creates a new row after the final cell', () => {
    const table = createVisualTable(2, 2)
    document.body.appendChild(table)
    const cells = Array.from(table.querySelectorAll<HTMLTableCellElement>('th,td'))
    const selection = window.getSelection()!
    const result = moveAcrossVisualTable(table, cells[cells.length - 1], false, selection)

    expect(result.moved).toBe(true)
    expect(result.changed).toBe(true)
    expect(table.tBodies.item(0)?.rows).toHaveLength(2)
    expect(result.cell).toBe(table.tBodies.item(0)?.rows.item(1)?.cells.item(0))
  })

  it('returns a connected neighboring cell after deleting the active column', () => {
    const table = createVisualTable(2, 2)
    document.body.appendChild(table)
    const row = table.tBodies.item(0)!.rows.item(0)!
    const activeCell = row.cells.item(1)!

    const nextCell = deleteVisualTableColumnAtCell(table, activeCell)

    expect(activeCell.isConnected).toBe(false)
    expect(Array.from(table.rows).every(currentRow => currentRow.cells.length === 1)).toBe(true)
    expect(nextCell).toBe(row.cells.item(0))
    expect(nextCell?.isConnected).toBe(true)
  })

  it('round-trips CSV values and replaces a visual table', () => {
    const table = createVisualTable(2, 2)
    table.rows.item(0)!.cells.item(0)!.textContent = 'Name'
    table.rows.item(0)!.cells.item(1)!.textContent = 'Comment'
    table.rows.item(1)!.cells.item(0)!.textContent = 'A, B'
    table.rows.item(1)!.cells.item(1)!.textContent = 'said "yes"'
    expect(visualTableToCsv(table)).toBe('Name,Comment\n"A, B","said ""yes"""')
    expect(parseCsvTable('Name,Value\nA,2\nB,1')).toEqual([['Name', 'Value'], ['A', '2'], ['B', '1']])

    document.body.appendChild(table)
    const cell = replaceVisualTableFromCsv(table, 'Name,Value\nB,2\nA,10')
    const replacement = cell?.closest('table')!
    expect(replacement.rows).toHaveLength(3)
    expect(sortVisualTableColumn(replacement, 0, 'asc')).toBe(true)
    expect(replacement.tBodies.item(0)?.rows.item(0)?.cells.item(0)?.textContent).toBe('A')
  })
})

describe('heading and list folding', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('folds a heading section until the next heading of the same or higher level', () => {
    const editor = document.createElement('div')
    editor.innerHTML = '<h2>First</h2><p>A</p><h3>Nested</h3><p>B</p><h2>Second</h2><p>C</p>'
    document.body.appendChild(editor)
    const first = editor.querySelector('h2')!

    expect(toggleHeadingFold(first)).toBe(true)
    expect(first.classList.contains('easymark-heading-folded')).toBe(true)
    expect(editor.children[1].classList.contains('easymark-fold-hidden')).toBe(true)
    expect(editor.children[2].classList.contains('easymark-fold-hidden')).toBe(true)
    expect(editor.children[4].classList.contains('easymark-fold-hidden')).toBe(false)
    expect(editorHtmlToMarkdown(editor.innerHTML)).toContain('## First\n\nA\n\n### Nested\n\nB\n\n## Second')

    expect(toggleHeadingFold(first)).toBe(false)
    expect(editor.querySelector('.easymark-fold-hidden')).toBeNull()
  })

  it('folds nested lists and expands every folded block without changing content', () => {
    const editor = document.createElement('div')
    editor.innerHTML = '<h2>Section</h2><ul><li>Parent<ul><li>Child</li></ul></li></ul><p>After</p>'
    document.body.appendChild(editor)
    const heading = editor.querySelector('h2')!
    const item = editor.querySelector('li')!
    const before = editorHtmlToMarkdown(editor.innerHTML)

    expect(toggleListFold(item)).toBe(true)
    expect(item.classList.contains('easymark-list-folded')).toBe(true)
    expect(toggleHeadingFold(heading)).toBe(true)
    expect(expandAllEditorFolds(editor)).toBe(2)
    expect(editor.querySelector('.easymark-list-folded,.easymark-heading-folded,.easymark-fold-hidden')).toBeNull()
    expect(editorHtmlToMarkdown(editor.innerHTML)).toBe(before)
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
