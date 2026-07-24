import React, { useState, useCallback, useRef, useEffect } from 'react'
import { useTranslation } from '../../i18n'
import { SearchResult } from '../../types'

interface SearchPanelProps {
  visible: boolean
  onClose: () => void
  onOpenNote: (filename: string) => void
}

export function SearchPanel({ visible, onClose, onOpenNote }: SearchPanelProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()
  const requestRef = useRef(0)

  useEffect(() => {
    if (visible && inputRef.current) {
      inputRef.current.focus()
    }
  }, [visible])

  const doSearch = useCallback(async (q: string) => {
    const requestId = ++requestRef.current
    if (!q.trim()) {
      setResults([])
      setActiveIndex(-1)
      setSearching(false)
      setError(false)
      return
    }
    setSearching(true)
    setError(false)
    try {
      const res = await window.electronAPI.searchAllNotes(q)
      if (requestId !== requestRef.current) return
      setResults(res)
      setActiveIndex(res.length > 0 ? 0 : -1)
    } catch {
      if (requestId !== requestRef.current) return
      setResults([])
      setActiveIndex(-1)
      setError(true)
    }
    if (requestId === requestRef.current) setSearching(false)
  }, [])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setQuery(val)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => doSearch(val), 300)
  }, [doSearch])

  useEffect(() => {
    return () => { requestRef.current += 1; if (timerRef.current) clearTimeout(timerRef.current) }
  }, [])

  useEffect(() => {
    if (!visible) {
      requestRef.current += 1
      if (timerRef.current) clearTimeout(timerRef.current)
      setSearching(false)
    }
  }, [visible])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
      return
    }
    if (e.key === 'ArrowDown' && results.length > 0) {
      e.preventDefault()
      setActiveIndex(prev => Math.min(prev + 1, results.length - 1))
      return
    }
    if (e.key === 'ArrowUp' && results.length > 0) {
      e.preventDefault()
      setActiveIndex(prev => Math.max(prev - 1, 0))
      return
    }
    if (e.key === 'Enter' && activeIndex >= 0 && results[activeIndex]) {
      e.preventDefault()
      onOpenNote(results[activeIndex].filename)
    }
  }, [activeIndex, onClose, onOpenNote, results])

  const highlightMatch = (text: string, q: string) => {
    if (!q.trim()) return text
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const parts = text.split(new RegExp(`(${escaped})`, 'gi'))
    return parts.map((part, i) =>
      part.toLowerCase() === q.toLowerCase()
        ? <mark key={i} className="search-highlight">{part}</mark>
        : part
    )
  }

  if (!visible) return null

  return (
    <div className="search-all-panel">
      <div className="search-all-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          ref={inputRef}
          className="search-all-input"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={t.editor.searchAllPlaceholder}
        />
        <button className="search-all-close" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div className="search-all-body">
        {searching && (
          <div className="search-all-loading">{t.ai.thinking}</div>
        )}
        {!searching && error && (
          <div className="search-all-empty" role="alert">
            <span>{t.editor.searchAllFailed}</span>
            <button className="sidebar-empty-btn" onClick={() => { void doSearch(query) }}>
              {t.sidebar.retry}
            </button>
          </div>
        )}
        {!searching && !error && query && results.length === 0 && (
          <div className="search-all-empty">{t.editor.searchAllNoResults}</div>
        )}
        {results.map((r, i) => (
          <div
            key={`${r.filename}-${i}`}
            className={`search-all-item ${activeIndex === i ? 'active' : ''}`}
            role="button"
            tabIndex={-1}
            onMouseEnter={() => setActiveIndex(i)}
            onClick={() => onOpenNote(r.filename)}
          >
            <div className="search-all-item-title">{highlightMatch(r.title, query)}</div>
            <div className="search-all-item-snippet">{highlightMatch(r.snippet, query)}</div>
            <div className="search-all-item-meta">
              <span>{r.filename}</span>
              <span>Match: {r.score}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
