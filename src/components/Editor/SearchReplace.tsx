import React, { useState, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from '../../i18n'

interface SearchReplaceProps {
  editorRef: React.RefObject<HTMLDivElement | null>
  getMarkdown: () => string
  onChange: (content: string) => void
  visible: boolean
  onClose: () => void
}

const STORAGE_KEY = 'easymark-search-last'

export function SearchReplace({ editorRef, getMarkdown, onChange, visible, onClose }: SearchReplaceProps) {
  const { t } = useTranslation()
  const [search, setSearch] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) || '' } catch { return '' }
  })
  const [replace, setReplace] = useState('')
  const [matchCount, setMatchCount] = useState(0)
  const [currentIdx, setCurrentIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const contentRef = useRef('')

  useEffect(() => {
    if (visible) {
      try { localStorage.setItem(STORAGE_KEY, search) } catch {}
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [visible, search])

  useEffect(() => {
    if (!editorRef.current) return
    const text = editorRef.current.textContent || ''
    contentRef.current = text
    if (!search) { setMatchCount(0); return }
    const lower = text.toLowerCase()
    const q = search.toLowerCase()
    let count = 0
    let idx = lower.indexOf(q)
    while (idx !== -1) { count++; idx = lower.indexOf(q, idx + q.length) }
    setMatchCount(count)
    setCurrentIdx(prev => count > 0 ? Math.min(prev || 1, count) : 0)
  }, [editorRef, search])

  const findNext = useCallback((dir: 1 | -1 = 1) => {
    if (!search || !editorRef.current) return
    const el = editorRef.current
    const text = el.textContent || ''
    const q = search.toLowerCase()
    const sel = window.getSelection()
    let start = 0
    if (sel && sel.rangeCount && sel.anchorNode && el.contains(sel.anchorNode)) {
      const pre = document.createRange()
      pre.selectNodeContents(el)
      pre.setEnd(sel.anchorNode, sel.anchorOffset)
      start = pre.toString().length
    }
    const idx = text.toLowerCase().indexOf(q, start + (dir === -1 ? -search.length : 0))
    const foundIdx = idx !== -1 ? idx : text.toLowerCase().indexOf(q)
    if (foundIdx !== -1) {
      setCurrentIdx(prev => {
        if (dir === 1) return Math.min(prev + 1, matchCount)
        return Math.max(prev - 1, 1)
      })
      const range = document.createRange()
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null)
      let charCount = 0
      while (walk.nextNode()) {
        const len = (walk.currentNode.textContent || '').length
        if (charCount + len > foundIdx) {
          const offset = foundIdx - charCount
          range.setStart(walk.currentNode, offset)
          range.setEnd(walk.currentNode, offset + q.length)
          sel?.removeAllRanges()
          sel?.addRange(range)
          try {
            const r = range.getBoundingClientRect()
            if (r) el.scrollTop += r.top - el.clientHeight / 3
          } catch {}
          break
        }
        charCount += len
      }
    }
  }, [search, editorRef, matchCount])

  const syncMarkdown = useCallback(() => {
    if (!editorRef.current) return
    onChange(getMarkdown())
  }, [editorRef, getMarkdown, onChange])

  const handleReplace = useCallback(() => {
    if (!search || !editorRef.current) return
    const sel = window.getSelection()
    if (!sel || !sel.rangeCount) return
    const text = sel.toString()
    if (text.toLowerCase() === search.toLowerCase()) {
      sel.getRangeAt(0).deleteContents()
      sel.getRangeAt(0).insertNode(document.createTextNode(replace))
      sel.removeAllRanges()
      syncMarkdown()
      findNext(1)
    }
  }, [search, replace, editorRef, syncMarkdown, findNext])

  const replaceAll = useCallback(() => {
    if (!search || !editorRef.current) return
    const el = editorRef.current
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null)
    const nodes: { node: Text; idx: number }[] = []
    const q = search.toLowerCase()
    while (walk.nextNode()) {
      const node = walk.currentNode as Text
      const lower = (node.textContent || '').toLowerCase()
      let idx = lower.indexOf(q)
      while (idx !== -1) {
        nodes.push({ node, idx })
        idx = lower.indexOf(q, idx + q.length)
      }
    }
    for (const { node, idx } of nodes.reverse()) {
      const before = node.textContent?.slice(0, idx) || ''
      const after = node.textContent?.slice(idx + search.length) || ''
      node.textContent = before + replace + after
    }
    syncMarkdown()
  }, [search, replace, editorRef, syncMarkdown])

  useEffect(() => {
    if (!visible) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'Enter') {
        e.preventDefault()
        findNext(e.shiftKey ? -1 : 1)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [visible, onClose, findNext])

  if (!visible) return null

  return (
    <div className="search-bar">
      <div className="search-fields">
        <div className="search-input-wrap">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            ref={inputRef}
            className="search-input"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t.editor.find || 'Find...'}
          />
          {matchCount > 0 && <span className="search-count">{currentIdx}/{matchCount}</span>}
        </div>
        <div className="search-input-wrap">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
          </svg>
          <input
            className="search-input"
            value={replace}
            onChange={e => setReplace(e.target.value)}
            placeholder={t.editor.replace || 'Replace...'}
          />
        </div>
      </div>
      <div className="search-actions">
        <button className="search-btn" onClick={() => findNext(-1)} title="Previous (Shift+Enter)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <button className="search-btn" onClick={() => findNext(1)} title="Next (Enter)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
        <button className="search-btn search-btn-replace" onClick={handleReplace} disabled={!search || matchCount === 0}>
          {t.editor.replaceOne || 'Replace'}
        </button>
        <button className="search-btn" onClick={replaceAll} disabled={!search || matchCount === 0}>
          {t.editor.replaceAll || 'All'}
        </button>
        <button className="search-btn search-btn-close" onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>
  )
}
