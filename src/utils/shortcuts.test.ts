import { describe, expect, it } from 'vitest'
import { formatShortcut, isInlineCodeShortcut } from './shortcuts'

describe('formatShortcut', () => {
  it('uses macOS modifier names on macOS', () => {
    expect(formatShortcut('Ctrl+Shift+`', 'darwin')).toBe('Cmd+Shift+`')
    expect(formatShortcut('Alt+Shift+5', 'darwin')).toBe('Option+Shift+5')
  })

  it('keeps Windows and Linux modifier names unchanged', () => {
    expect(formatShortcut('Ctrl+B', 'win32')).toBe('Ctrl+B')
    expect(formatShortcut('Ctrl+B', 'linux')).toBe('Ctrl+B')
  })
})

describe('isInlineCodeShortcut', () => {
  it('recognizes the physical backquote key when Shift changes key to tilde', () => {
    expect(isInlineCodeShortcut({
      key: '~',
      code: 'Backquote',
      ctrlKey: false,
      metaKey: true,
      shiftKey: true,
    })).toBe(true)
  })

  it('rejects backquote without the required modifiers', () => {
    expect(isInlineCodeShortcut({
      key: '`',
      code: 'Backquote',
      ctrlKey: false,
      metaKey: false,
      shiftKey: true,
    })).toBe(false)
  })
})
