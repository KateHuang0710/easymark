// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { addDeferredDocumentMouseDownListener, applyBlockFormat } from './MarkdownEditor'

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
