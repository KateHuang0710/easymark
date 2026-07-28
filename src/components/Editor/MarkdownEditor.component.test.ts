// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../i18n'
import { SettingsProvider } from '../../contexts/SettingsContext'
import { MarkdownEditor } from './MarkdownEditor'

type RenderedEditor = {
  host: HTMLDivElement
  root: Root
  changes: string[]
  getEditor: () => HTMLDivElement
  getContainer: () => HTMLDivElement
}

let originalExecCommand: PropertyDescriptor | undefined
let rendered: RenderedEditor[] = []

function installElectronStub() {
  window.electronAPI = {
    platform: 'darwin',
    getAIConfig: vi.fn(async () => ({
      configured: false,
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      persistedSecurely: true,
    })),
    readClipboardText: vi.fn(async () => ''),
    writeClipboardText: vi.fn(async () => undefined),
    saveImage: vi.fn(async () => ({ filename: 'assets/test.png' })),
  } as unknown as Window['electronAPI']
}

async function renderEditor(content: string): Promise<RenderedEditor> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const changes: string[] = []
  const root = createRoot(host)

  await act(async () => {
    root.render(
      React.createElement(
        I18nProvider,
        null,
        React.createElement(
          SettingsProvider,
          null,
          React.createElement(MarkdownEditor, {
            content,
            onChange: (next: string) => changes.push(next),
            onSave: vi.fn(),
          }),
        ),
      ),
    )
    await Promise.resolve()
  })

  const result = {
    host,
    root,
    changes,
    getEditor: () => host.querySelector<HTMLDivElement>('.editor-wysiwyg')!,
    getContainer: () => host.querySelector<HTMLDivElement>('.editor-container')!,
  }
  rendered.push(result)
  return result
}

function placeCaret(node: Node, offset = 0) {
  const range = document.createRange()
  range.setStart(node, offset)
  range.collapse(true)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
}

function selectContents(node: Node) {
  const range = document.createRange()
  range.selectNodeContents(node)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
}

async function click(element: Element) {
  await act(async () => {
    ;(element as HTMLElement).click()
    await Promise.resolve()
  })
}

function dispatchKey(editor: HTMLElement, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  editor.dispatchEvent(event)
  return event
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  document.body.innerHTML = ''
  const storage = new Map<string, string>()
  const localStorageStub = {
    getItem: (key: string) => storage.get(key) || null,
    setItem: (key: string, value: string) => { storage.set(key, value) },
    removeItem: (key: string) => { storage.delete(key) },
    clear: () => { storage.clear() },
    key: (index: number) => Array.from(storage.keys())[index] || null,
    get length() { return storage.size },
  }
  vi.stubGlobal('localStorage', localStorageStub)
  Object.defineProperty(window, 'localStorage', { configurable: true, value: localStorageStub })
  localStorageStub.setItem('easymark-locale', 'zh')
  installElectronStub()
  if (!window.matchMedia) {
    window.matchMedia = vi.fn(() => ({ matches: false, media: '', onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() })) as typeof window.matchMedia
  }
  window.requestAnimationFrame = callback => window.setTimeout(callback, 0)
  originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand')
})

afterEach(async () => {
  await act(async () => {
    for (const item of rendered) item.root.unmount()
    await Promise.resolve()
  })
  rendered = []
  document.body.innerHTML = ''
  window.getSelection()?.removeAllRanges()
  if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand)
  else Object.defineProperty(document, 'execCommand', { configurable: true, value: undefined })
  vi.restoreAllMocks()
})

describe('MarkdownEditor mounted component', () => {
  it('routes Command+Y to native redo while leaving Command+Z to Chromium', async () => {
    const { getEditor } = await renderEditor('Body')
    const editor = getEditor()
    const paragraph = editor.querySelector('p')!
    placeCaret(paragraph.firstChild!, 2)
    const execCommand = vi.fn(() => true)
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand })

    const undoEvent = dispatchKey(editor, { key: 'z', code: 'KeyZ', metaKey: true })
    const redoEvent = dispatchKey(editor, { key: 'y', code: 'KeyY', metaKey: true })

    expect(undoEvent.defaultPrevented).toBe(false)
    expect(redoEvent.defaultPrevented).toBe(true)
    expect(execCommand).toHaveBeenCalledWith('redo', false, undefined)
    expect(execCommand).not.toHaveBeenCalledWith('undo', false, undefined)
  })

  it('uses the mounted toolbar to create a list and preserves Markdown output', async () => {
    const { getEditor, getContainer, changes } = await renderEditor('Body')
    const editor = getEditor()
    const paragraph = editor.querySelector('p')!
    selectContents(paragraph)
    const execCommand = vi.fn((command: string) => {
      if (command !== 'insertUnorderedList') return true
      const list = document.createElement('ul')
      const item = document.createElement('li')
      item.textContent = paragraph.textContent
      list.appendChild(item)
      paragraph.replaceWith(list)
      return true
    })
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand })

    await click(getContainer().querySelector('button[title^="无序列表"]')!)

    expect(execCommand).toHaveBeenCalledWith('insertUnorderedList', false, undefined)
    expect(changes[changes.length - 1]).toContain('-   Body')
  })

  it('does not intercept Enter inside a list, leaving the native transaction intact', async () => {
    const { getEditor } = await renderEditor('- First\n- Second')
    const editor = getEditor()
    const item = editor.querySelector('li')!
    placeCaret(item.firstChild!, item.textContent!.length)

    const event = dispatchKey(editor, { key: 'Enter', code: 'Enter' })

    expect(event.defaultPrevented).toBe(false)
  })

  it('creates a code block, assigns a language, and keeps the language out of code text', async () => {
    const { getEditor, getContainer, changes } = await renderEditor('const value = 1')
    const editor = getEditor()
    const paragraph = editor.querySelector('p')!
    selectContents(paragraph)

    await click(getContainer().querySelector('button[title^="代码块 /"]')!)
    expect(editor.querySelector('pre code')?.textContent).toContain('const value = 1')
    expect(changes[changes.length - 1]).toContain('```\nconst value = 1\n```')

    const codeText = editor.querySelector('code')!.firstChild!
    placeCaret(codeText, codeText.textContent!.length)
    await click(getContainer().querySelector('.editor-code-language-btn')!)
    await click(Array.from(getContainer().querySelectorAll<HTMLButtonElement>('.lang-picker-item')).find(button => button.textContent === 'python')!)

    expect(editor.querySelector('pre')?.getAttribute('data-lang')).toBe('python')
    expect(editor.querySelector('.code-lang-label')?.textContent).toBe('python')
    expect(changes[changes.length - 1]).toContain('```python\nconst value = 1\n```')
  })

  it('inserts a visual table through the mounted toolbar and emits Markdown', async () => {
    const { getEditor, getContainer, changes } = await renderEditor('Body')
    const editor = getEditor()
    const paragraph = editor.querySelector('p')!
    placeCaret(paragraph.firstChild!, paragraph.textContent!.length)

    await click(getContainer().querySelector('button[title="插入可视化表格"]')!)

    expect(editor.querySelectorAll('table th')).toHaveLength(3)
    expect(editor.querySelectorAll('table td')).toHaveLength(6)
    expect(changes[changes.length - 1]).toContain('|  |  |  |')
  })

  it('supports table Tab navigation and exposes table tools after a cell is focused', async () => {
    const { getEditor, getContainer } = await renderEditor('| A | B |\n| --- | --- |\n| 1 | 2 |')
    const editor = getEditor()
    const cell = editor.querySelector('td')!
    placeCaret(cell, 0)
    document.dispatchEvent(new Event('selectionchange'))
    await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 0)) })

    const event = dispatchKey(editor, { key: 'Tab', code: 'Tab' })
    expect(event.defaultPrevented).toBe(true)
    await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 0)) })
    expect(getContainer().querySelector('.table-visual-tools')).not.toBeNull()
  })
})
