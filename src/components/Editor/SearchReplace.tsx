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

export function countOccurrences(text: string, query: string): number {
  if (!query) return 0
  let count = 0
  let index = text.indexOf(query)
  while (index !== -1) {
    count += 1
    index = text.indexOf(query, index + query.length)
  }
  return count
}

export function createTextRange(root: HTMLElement, start: number, length: number): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let traversed = 0
  let startNode: Node | null = null
  let startOffset = 0
  let endNode: Node | null = null
  let endOffset = 0
  const end = start + length

  while (walker.nextNode()) {
    const node = walker.currentNode
    const nodeLength = node.textContent?.length || 0
    const nodeEnd = traversed + nodeLength
    if (!startNode && start < nodeEnd) {
      startNode = node
      startOffset = start - traversed
    }
    if (startNode && end <= nodeEnd) {
      endNode = node
      endOffset = end - traversed
      break
    }
    traversed = nodeEnd
  }

  if (!startNode || !endNode) return null
  const range = document.createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  return range
}

export function replaceAllTextMatches(root: HTMLElement, query: string, replacement: string): number {
  if (!query) return 0
  const text = root.textContent || ''
  const lower = text.toLowerCase()
  const needle = query.toLowerCase()
  const matches: number[] = []
  let index = lower.indexOf(needle)
  while (index !== -1) {
    matches.push(index)
    index = lower.indexOf(needle, index + needle.length)
  }
  for (const start of matches.reverse()) {
    const range = createTextRange(root, start, query.length)
    if (!range) continue
    replaceRangeText(range, replacement)
  }
  return matches.length
}

export function replaceRangeText(range: Range, replacement: string): void {
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  if (typeof document.execCommand === 'function' && document.execCommand('insertText', false, replacement)) return
  range.deleteContents()
  const textNode = document.createTextNode(replacement)
  range.insertNode(textNode)
  range.setStartAfter(textNode)
  range.collapse(true)
  selection?.removeAllRanges()
  selection?.addRange(range)
}

export function findMatchIndex(
  text: string,
  query: string,
  start: number,
  direction: 1 | -1,
  selectionMatches = false,
): number {
  if (!query) return -1
  const lower = text.toLowerCase()
  const q = query.toLowerCase()
  const found = direction === 1
    ? lower.indexOf(q, start + (selectionMatches ? query.length : 0))
    : start <= 0 ? -1 : lower.lastIndexOf(q, start - 1)
  return found !== -1
    ? found
    : direction === 1
      ? lower.indexOf(q)
      : lower.lastIndexOf(q)
}

export function SearchReplace({ editorRef, getMarkdown, onChange, visible, onClose }: SearchReplaceProps) {
  const { t } = useTranslation()
  const [search, setSearch] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) || '' } catch { return '' }
  })
  const [replace, setReplace] = useState('')
  const [matchCount, setMatchCount] = useState(0)
  const [currentIdx, setCurrentIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!visible) return
    try { localStorage.setItem(STORAGE_KEY, search) } catch {}
    const timer = window.setTimeout(() => inputRef.current?.focus(), 50)
    return () => window.clearTimeout(timer)
  }, [visible, search])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const updateCount = () => {
      const count = countOccurrences((editor.textContent || '').toLowerCase(), search.toLowerCase())
      setMatchCount(count)
      setCurrentIdx(prev => count > 0 ? Math.min(prev || 1, count) : 0)
    }
    updateCount()
    const observer = new MutationObserver(updateCount)
    observer.observe(editor, { childList: true, characterData: true, subtree: true })
    return () => observer.disconnect()
  }, [editorRef, search])

  const findNext = useCallback((dir: 1 | -1 = 1) => {
    if (!search || !editorRef.current) return
    const el = editorRef.current
    const text = el.textContent || ''
    const q = search.toLowerCase()
    const sel = window.getSelection()
    let start = 0
    if (sel && sel.rangeCount && sel.anchorNode && el.contains(sel.anchorNode)) {
      const activeRange = sel.getRangeAt(0)
      const pre = document.createRange()
      pre.selectNodeContents(el)
      pre.setEnd(activeRange.startContainer, activeRange.startOffset)
      start = pre.toString().length
    }
    const selectionMatches = sel?.toString().toLowerCase() === q
    const foundIdx = findMatchIndex(text, search, start, dir, selectionMatches)
    if (foundIdx !== -1) {
      const range = createTextRange(el, foundIdx, search.length)
      if (!range) return
      let ordinal = 1
      const lower = text.toLowerCase()
      let occurrence = lower.indexOf(q)
      while (occurrence !== -1 && occurrence < foundIdx) {
        ordinal += 1
        occurrence = lower.indexOf(q, occurrence + q.length)
      }
      setCurrentIdx(ordinal)
      sel?.removeAllRanges()
      sel?.addRange(range)
      try {
        const r = range.getBoundingClientRect()
        if (r) el.scrollTop += r.top - el.clientHeight / 3
      } catch {}
    }
  }, [search, editorRef])

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
      replaceRangeText(sel.getRangeAt(0), replace)
      syncMarkdown()
      findNext(1)
    }
  }, [search, replace, editorRef, syncMarkdown, findNext])

  const replaceAll = useCallback(() => {
    if (!search || !editorRef.current) return
    replaceAllTextMatches(editorRef.current, search, replace)
    syncMarkdown()
  }, [search, replace, editorRef, syncMarkdown])

  useEffect(() => {
    if (!visible) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'Enter') {
        const target = e.target
        if (!(target instanceof HTMLInputElement) || !target.closest('.search-bar')) return
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
