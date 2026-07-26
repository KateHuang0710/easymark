import React, { useEffect, useRef, useCallback } from 'react'
import { useTranslation } from '../../i18n'
import { formatShortcut } from '../../utils/shortcuts'

interface MenuItem {
  id: string
  label: string
  shortcut?: string
  icon?: React.ReactNode
  action: () => void | Promise<void>
  divider?: boolean
  disabled?: boolean
}

interface ContextMenuProps {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const rect = el.getBoundingClientRect()
    const maxX = window.innerWidth - rect.width - 8
    const maxY = window.innerHeight - rect.height - 8
    if (rect.left > maxX) el.style.left = maxX + 'px'
    if (rect.top > maxY) el.style.top = maxY + 'px'
    if (rect.left < 8) el.style.left = '8px'
    if (rect.top < 8) el.style.top = '8px'

    el.focus()
  }, [x, y])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', keyHandler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', keyHandler)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="context-menu"
      style={{ left: x, top: y }}
      tabIndex={-1}
    >
      {items.map((item, i) => (
        item.divider ? (
          <div key={`div-${i}`} className="context-divider" />
        ) : (
          <button
            key={item.id}
            className="context-item"
            onClick={() => {
              if (item.disabled) return
              void Promise.resolve(item.action()).catch(error => console.error('Context menu action failed:', error))
              onClose()
            }}
            disabled={item.disabled}
          >
            {item.icon && <span className="context-icon">{item.icon}</span>}
            <span className="context-label">{item.label}</span>
            {item.shortcut && <span className="context-shortcut">{item.shortcut}</span>}
          </button>
        )
      ))}
    </div>
  )
}

export function useEditorContextMenu(
  editorRef: React.RefObject<HTMLDivElement | null>,
  execFormat: (cmd: string, val?: string) => void,
  insertInlineCode: () => void,
  insertLink: (url: string) => boolean,
  emitChange: () => void,
  openSearch: () => void
) {
  const { t } = useTranslation()
  const tRef = useRef(t)
  tRef.current = t
  const [menu, setMenu] = React.useState<{ x: number; y: number; items: MenuItem[] } | null>(null)

  const hasSelection = () => {
    const sel = window.getSelection()
    return sel && sel.rangeCount > 0 && sel.toString().length > 0
  }

  const closeMenu = useCallback(() => setMenu(null), [])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const sel = window.getSelection()
    const selected = hasSelection() ? sel!.toString() : ''
    const selectedRange = sel?.rangeCount && editorRef.current?.contains(sel.getRangeAt(0).commonAncestorContainer)
      ? sel.getRangeAt(0).cloneRange()
      : null
    const tr = tRef.current
    const shortcut = (value: string) => formatShortcut(value, window.electronAPI.platform)
    const label = (value: string | undefined, fallback: string) => (value || fallback).replace(/ \([^)]*\)$/, '')

    const items: MenuItem[] = [
      {
        id: 'cut',
        label: tr.editor.cut || 'Cut',
        shortcut: shortcut('Ctrl+X'),
        action: async () => {
          if (!selected || !selectedRange) return
          await window.electronAPI.writeClipboardText(selected)
          const currentSelection = window.getSelection()
          currentSelection?.removeAllRanges()
          currentSelection?.addRange(selectedRange)
          editorRef.current?.focus()
          if (!document.execCommand('delete')) {
            selectedRange.deleteContents()
            selectedRange.collapse(true)
            currentSelection?.removeAllRanges()
            currentSelection?.addRange(selectedRange)
          }
          emitChange()
        },
        disabled: !selected,
      },
      {
        id: 'copy',
        label: tr.editor.copy || 'Copy',
        shortcut: shortcut('Ctrl+C'),
        action: async () => {
          if (selected) await window.electronAPI.writeClipboardText(selected)
        },
        disabled: !selected,
      },
      {
        id: 'paste',
        label: tr.editor.paste || 'Paste',
        shortcut: shortcut('Ctrl+V'),
        action: async () => {
          try {
            const text = await window.electronAPI.readClipboardText()
            if (!text || !selectedRange) return
            const currentSelection = window.getSelection()
            currentSelection?.removeAllRanges()
            currentSelection?.addRange(selectedRange)
            editorRef.current?.focus()
            if (!document.execCommand('insertText', false, text)) {
              selectedRange.deleteContents()
              const textNode = document.createTextNode(text)
              selectedRange.insertNode(textNode)
              selectedRange.setStartAfter(textNode)
              selectedRange.collapse(true)
              currentSelection?.removeAllRanges()
              currentSelection?.addRange(selectedRange)
            }
            emitChange()
          } catch (error) {
            console.error('Clipboard paste failed:', error)
          }
        },
      },
      { id: 'div1', label: '', action: () => {}, divider: true },
      {
        id: 'bold',
        label: label(tr.editor.bold, 'Bold'),
        shortcut: shortcut('Ctrl+B'),
        action: () => execFormat('bold'),
      },
      {
        id: 'italic',
        label: label(tr.editor.italic, 'Italic'),
        shortcut: shortcut('Ctrl+I'),
        action: () => execFormat('italic'),
      },
      {
        id: 'strikethrough',
        label: label(tr.editor.strikethrough, 'Strikethrough'),
        shortcut: shortcut('Alt+Shift+5'),
        action: () => execFormat('strikeThrough'),
      },
      {
        id: 'code',
        label: label(tr.editor.inlineCode, 'Inline code'),
        shortcut: shortcut('Ctrl+Shift+`'),
        action: insertInlineCode,
      },
      { id: 'div2', label: '', action: () => {}, divider: true },
      {
        id: 'heading1',
        label: label(tr.editor.heading1, 'Heading 1'),
        shortcut: shortcut('Ctrl+1'),
        action: () => execFormat('formatBlock', 'h1'),
      },
      {
        id: 'heading2',
        label: label(tr.editor.heading2, 'Heading 2'),
        shortcut: shortcut('Ctrl+2'),
        action: () => execFormat('formatBlock', 'h2'),
      },
      {
        id: 'heading3',
        label: label(tr.editor.heading3, 'Heading 3'),
        shortcut: shortcut('Ctrl+3'),
        action: () => execFormat('formatBlock', 'h3'),
      },
      { id: 'div3', label: '', action: () => {}, divider: true },
      {
        id: 'link',
        label: label(tr.editor.insertLink, 'Insert link'),
        shortcut: shortcut('Ctrl+K'),
        action: () => {
          const url = prompt('Enter URL:', 'https://')
          if (url) {
            insertLink(url)
          }
        },
      },
      {
        id: 'blockquote',
        label: tr.editor.blockquote || 'Blockquote',
        shortcut: '',
        action: () => execFormat('formatBlock', 'blockquote'),
      },
      {
        id: 'codeblock',
        label: label(tr.editor.codeBlock, 'Code block'),
        shortcut: shortcut('Ctrl+Shift+C'),
        action: () => execFormat('formatBlock', 'pre'),
      },
      { id: 'div4', label: '', action: () => {}, divider: true },
      {
        id: 'selectAll',
        label: tr.editor.selectAll || 'Select all',
        shortcut: shortcut('Ctrl+A'),
        action: () => {
          const range = document.createRange()
          if (editorRef.current) {
            range.selectNodeContents(editorRef.current)
            const sel2 = window.getSelection()
            sel2?.removeAllRanges()
            sel2?.addRange(range)
          }
        },
      },
      {
        id: 'search',
        label: tr.editor.find || 'Find',
        shortcut: shortcut('Ctrl+F'),
        action: () => openSearch(),
      },
    ]

    setMenu({ x: e.clientX, y: e.clientY, items })
  }, [execFormat, insertInlineCode, insertLink, emitChange, openSearch, editorRef])

  return { menu, handleContextMenu, closeMenu }
}
