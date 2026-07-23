import React, { useState, useCallback, useRef, useEffect } from 'react'

interface InlineSuggestionProps {
  editorRef: React.RefObject<HTMLDivElement>
  getTextBeforeCursor: () => string
  onAccept: (text: string) => void
  enabled: boolean
  getSuggestion: (text: string) => Promise<string>
}

export function InlineSuggestion({ editorRef, getTextBeforeCursor, onAccept, enabled, getSuggestion }: InlineSuggestionProps) {
  const [suggestion, setSuggestion] = useState('')
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const [visible, setVisible] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()
  const lastTextRef = useRef('')
  const requestIdRef = useRef(0)
  const suggestionRef = useRef('')
  const getTextBeforeCursorRef = useRef(getTextBeforeCursor)
  getTextBeforeCursorRef.current = getTextBeforeCursor
  const getSuggestionRef = useRef(getSuggestion)
  getSuggestionRef.current = getSuggestion
  const onAcceptRef = useRef(onAccept)
  onAcceptRef.current = onAccept
  const editorRefRef = useRef(editorRef)
  editorRefRef.current = editorRef

  const updatePosition = useCallback(() => {
    const ed = editorRefRef.current.current
    if (!ed) return
    const sel = window.getSelection()
    if (!sel || !sel.rangeCount) return
    const range = sel.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    if (rect && rect.top > 0) {
      const wrapper = ed.parentElement
      const editorRect = wrapper ? wrapper.getBoundingClientRect() : ed.getBoundingClientRect()
      setPosition({
        top: rect.top - editorRect.top + rect.height + 2,
        left: rect.left - editorRect.left,
      })
    }
  }, [])

  const debouncedCompletion = useCallback(() => {
    if (!enabled) return
    const text = getTextBeforeCursorRef.current()
    if (!text.trim() || text === lastTextRef.current) return
    lastTextRef.current = text

    if (timerRef.current) clearTimeout(timerRef.current)
    const requestId = ++requestIdRef.current
    timerRef.current = setTimeout(async () => {
      const words = text.trim().split(/\s+/)
      if (words.length < 3) return
      const lastChar = text.trim().slice(-1)
      if (!/[a-zA-Z\u4e00-\u9fff0-9)}\]>]/.test(lastChar)) return

      let result = ''
      try {
        result = await getSuggestionRef.current(text)
      } catch {
        return
      }
      if (requestId !== requestIdRef.current || getTextBeforeCursorRef.current() !== text) return
      if (result && !result.includes('```') && result.length < 100) {
        suggestionRef.current = result
        setSuggestion(result)
        setVisible(true)
        requestAnimationFrame(updatePosition)
      }
    }, 600)
  }, [enabled, updatePosition])

  const handleAccept = useCallback(() => {
    if (!suggestionRef.current) return false
    onAcceptRef.current(suggestionRef.current)
    setVisible(false)
    setSuggestion('')
    suggestionRef.current = ''
    return true
  }, [])

  const dismiss = useCallback(() => {
    requestIdRef.current += 1
    if (timerRef.current) clearTimeout(timerRef.current)
    setVisible(false)
    setSuggestion('')
    suggestionRef.current = ''
  }, [])

  useEffect(() => {
    if (!enabled) dismiss()
  }, [enabled, dismiss])

  useEffect(() => () => {
    requestIdRef.current += 1
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  useEffect(() => {
    const el = editorRefRef.current.current
    if (!el) return
    const handler = () => {
      debouncedCompletion()
    }
    el.addEventListener('input', handler)
    return () => el.removeEventListener('input', handler)
  }, [debouncedCompletion])

  useEffect(() => {
    if (visible) {
      const handler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          dismiss()
        } else if (e.key === 'Tab' && visible && suggestionRef.current) {
          const editor = editorRefRef.current.current
          if (!editor || (document.activeElement !== editor && !editor.contains(document.activeElement))) return
          e.preventDefault()
          e.stopPropagation()
          handleAccept()
        } else {
          if (!e.ctrlKey && !e.metaKey && e.key.length === 1) {
            dismiss()
          }
        }
      }
      document.addEventListener('keydown', handler, true)
      return () => document.removeEventListener('keydown', handler, true)
    }
  }, [visible, handleAccept, dismiss])

  if (!visible) return null

  return (
    <div
      className="inline-suggestion"
      style={{ top: position.top, left: position.left }}
    >
      <span className="inline-suggestion-text">{suggestion}</span>
      <span className="inline-suggestion-hint">Tab</span>
    </div>
  )
}
