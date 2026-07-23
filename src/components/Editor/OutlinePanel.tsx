import React, { useMemo, useCallback } from 'react'
import { useTranslation } from '../../i18n'

interface Heading {
  level: number
  text: string
  index: number
}

interface OutlinePanelProps {
  content: string
  editorRef: React.RefObject<HTMLDivElement | null>
  visible: boolean
  onClose: () => void
}

export function OutlinePanel({ content, editorRef, visible, onClose }: OutlinePanelProps) {
  const { t } = useTranslation()

  const headings = useMemo(() => {
    const result: Heading[] = []
    const lines = content.split('\n')
    let idx = 0
    for (const line of lines) {
      const match = line.match(/^(#{1,6})\s+(.+)$/)
      if (match) {
        result.push({ level: match[1].length, text: match[2].trim(), index: idx })
      }
      idx++
    }
    return result
  }, [content])

  const scrollToHeading = useCallback((heading: Heading) => {
    if (!editorRef.current) return
    const el = editorRef.current
    // Find the heading by content matching rather than index mapping,
    // since markdown blank lines and non-block elements don't map 1:1 to DOM children.
    const normalizedHeadingText = heading.text.replace(/\s+/g, ' ').toLowerCase().trim()
    let lineEl: Element | null = null
    const children = el.children
    for (let i = 0; i < children.length; i++) {
      const child = children[i]
      const tag = child.tagName.toLowerCase()
      if (['h1','h2','h3','h4','h5','h6'].includes(tag)) {
        const childText = child.textContent?.replace(/\s+/g, ' ').toLowerCase().trim() || ''
        if (childText === normalizedHeadingText) {
          lineEl = child
          break
        }
      }
    }
    // Fallback: try index-based approach
    if (!lineEl) {
      let blockCount = 0
      for (let i = 0; i < children.length; i++) {
        const child = children[i]
        const tag = child.tagName.toLowerCase()
        if (['h1','h2','h3','h4','h5','h6','p','blockquote','pre','ul','ol','hr'].includes(tag)) {
          if (blockCount === heading.index) {
            lineEl = child
            break
          }
          blockCount++
        }
      }
    }
    if (lineEl) {
      lineEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
    } else {
      el.scrollTop = 0
    }
    onClose()
  }, [editorRef, onClose])

  if (!visible) return null

  if (headings.length === 0) {
    return (
      <div className="outline-panel">
        <div className="outline-header">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
          </svg>
          <span>{t.editor.outline || 'Outline'}</span>
          <div className="outline-spacer" />
          <button className="outline-close" onClick={onClose}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="outline-empty">{t.editor.noHeadings || 'No headings found'}</div>
      </div>
    )
  }

  return (
    <div className="outline-panel">
      <div className="outline-header">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
        </svg>
        <span>{t.editor.outline || 'Outline'}</span>
        <div className="outline-spacer" />
        <span className="outline-count">{headings.length}</span>
        <button className="outline-close" onClick={onClose}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div className="outline-list">
        {headings.map((h, i) => (
          <button
            key={i}
            className="outline-item"
            style={{ paddingLeft: 8 + (h.level - 1) * 16 }}
            onClick={() => scrollToHeading(h)}
          >
            <span className={`outline-marker level-${h.level}`} />
            <span className="outline-text">{h.text}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
