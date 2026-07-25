import React, { useEffect, useRef, useCallback } from 'react'
import { useTranslation } from '../../i18n'

interface MenuItem {
  id: string
  label: string
  shortcut?: string
  icon?: React.ReactNode
  action: () => void
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
            onClick={() => { if (!item.disabled) { item.action(); onClose() } }}
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
    const tr = tRef.current

    const items: MenuItem[] = [
      {
        id: 'cut',
        label: tr.editor.cut || 'Cut',
        shortcut: 'Ctrl+X',
        action: () => {
          if (hasSelection()) {
            navigator.clipboard.writeText(window.getSelection()!.toString()).catch(() => {})
            const r = window.getSelection()?.getRangeAt(0)
            r?.deleteContents()
            emitChange()
          }
        },
        disabled: !hasSelection(),
      },
      {
        id: 'copy',
        label: tr.editor.copy || 'Copy',
        shortcut: 'Ctrl+C',
        action: () => {
          if (hasSelection()) {
            navigator.clipboard.writeText(window.getSelection()!.toString()).catch(() => {})
          }
        },
        disabled: !hasSelection(),
      },
      {
        id: 'paste',
        label: tr.editor.paste || 'Paste',
        shortcut: 'Ctrl+V',
        action: async () => {
          try {
            const text = await navigator.clipboard.readText()
            const sel2 = window.getSelection()
            if (sel2 && sel2.rangeCount) {
              const range = sel2.getRangeAt(0)
              range.deleteContents()
              const textNode = document.createTextNode(text)
              range.insertNode(textNode)
              const newRange = document.createRange()
              newRange.setStartAfter(textNode)
              newRange.collapse(true)
              sel2.removeAllRanges()
              sel2.addRange(newRange)
              emitChange()
            }
          } catch {
            // Fallback: if clipboard.readText fails (e.g., missing clipboard-read permission),
            // try using a temporary textarea for paste
            try {
              const ta = document.createElement('textarea')
              ta.style.position = 'fixed'
              ta.style.left = '-9999px'
              document.body.appendChild(ta)
              ta.focus()
              document.execCommand('paste')
              const text = ta.value
              document.body.removeChild(ta)
              if (text) {
                const sel2 = window.getSelection()
                if (sel2 && sel2.rangeCount) {
                  const range = sel2.getRangeAt(0)
                  range.deleteContents()
                  const textNode = document.createTextNode(text)
                  range.insertNode(textNode)
                  const newRange = document.createRange()
                  newRange.setStartAfter(textNode)
                  newRange.collapse(true)
                  sel2.removeAllRanges()
                  sel2.addRange(newRange)
                  emitChange()
                }
              }
            } catch {}
          }
        },
      },
      { id: 'div1', label: '', action: () => {}, divider: true },
      {
        id: 'bold',
        label: tr.editor.bold?.replace(/ \(.*\)/, '') || 'Bold',
        shortcut: 'Ctrl+B',
        action: () => execFormat('bold'),
      },
      {
        id: 'italic',
        label: tr.editor.italic?.replace(/ \(.*\)/, '') || 'Italic',
        shortcut: 'Ctrl+I',
        action: () => execFormat('italic'),
      },
      {
        id: 'strikethrough',
        label: tr.editor.strikethrough || 'Strikethrough',
        shortcut: '',
        action: () => execFormat('strikeThrough'),
      },
      {
        id: 'code',
        label: tr.editor.inlineCode || 'Inline code',
        shortcut: 'Ctrl+Shift+`',
        action: insertInlineCode,
      },
      { id: 'div2', label: '', action: () => {}, divider: true },
      {
        id: 'heading1',
        label: tr.editor.heading1 || 'Heading 1',
        shortcut: 'Ctrl+1',
        action: () => execFormat('formatBlock', 'h1'),
      },
      {
        id: 'heading2',
        label: tr.editor.heading2 || 'Heading 2',
        shortcut: 'Ctrl+2',
        action: () => execFormat('formatBlock', 'h2'),
      },
      {
        id: 'heading3',
        label: tr.editor.heading3 || 'Heading 3',
        shortcut: 'Ctrl+3',
        action: () => execFormat('formatBlock', 'h3'),
      },
      { id: 'div3', label: '', action: () => {}, divider: true },
      {
        id: 'link',
        label: tr.editor.insertLink || 'Insert link',
        shortcut: 'Ctrl+K',
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
        label: tr.editor.codeBlock || 'Code block',
        shortcut: 'Ctrl+Shift+C',
        action: () => execFormat('formatBlock', 'pre'),
      },
      { id: 'div4', label: '', action: () => {}, divider: true },
      {
        id: 'selectAll',
        label: tr.editor.selectAll || 'Select all',
        shortcut: 'Ctrl+A',
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
        shortcut: 'Ctrl+F',
        action: () => openSearch(),
      },
    ]

    setMenu({ x: e.clientX, y: e.clientY, items })
  }, [execFormat, insertInlineCode, insertLink, emitChange, openSearch, editorRef])

  return { menu, handleContextMenu, closeMenu }
}
