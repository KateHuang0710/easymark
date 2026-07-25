import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { renderMarkdown } from '../../services/markdown'
import { useTranslation } from '../../i18n'
import { isConfigured, getSummary } from '../../services/ai'
import { useSettings } from '../../contexts/SettingsContext'

interface ReadingModeProps {
  content: string
  title: string
  onClose: () => void
  onEdit: () => void
}

function estimateReadingTime(text: string): number {
  const words = text.trim().split(/\s+/).length
  return Math.max(1, Math.ceil(words / 200))
}

export function ReadingMode({ content, title, onClose, onEdit }: ReadingModeProps) {
  const { t, locale } = useTranslation()
  const { settings } = useSettings()
  const [summary, setSummary] = useState('')
  const [summarizing, setSummarizing] = useState(false)
  const mountedRef = useRef(true)
  const summaryRequestRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    summaryRequestRef.current += 1
    setSummary('')
    setSummarizing(false)
  }, [content, title])
  const isZh = locale === 'zh'

  const readingTime = useMemo(() => estimateReadingTime(content), [content])

  const MAX_SUMMARY_CHARS = 4000

  const handleSummarize = useCallback(async () => {
    if (!isConfigured()) return
    const requestId = ++summaryRequestRef.current
    setSummarizing(true)
    try {
      const truncated = content.length > MAX_SUMMARY_CHARS
        ? content.slice(0, MAX_SUMMARY_CHARS) + '\n\n[...]'
        : content
      const result = await getSummary(truncated)
      if (mountedRef.current && requestId === summaryRequestRef.current) setSummary(result)
    } catch {
      if (mountedRef.current && requestId === summaryRequestRef.current) {
        setSummary(isZh ? '生成摘要失败' : 'Failed to generate summary')
      }
    }
    if (mountedRef.current && requestId === summaryRequestRef.current) setSummarizing(false)
  }, [content, isZh])

  return (
    <div className="reading-mode">
      <div className="reading-mode-toolbar">
        <button className="reading-mode-btn" onClick={onEdit} title={t.editor.edit}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          {t.editor.edit}
        </button>
        <div className="reading-mode-info">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
          <span>{readingTime} {t.editor.minRead}</span>
        </div>
        {isConfigured() && (
          <button className="reading-mode-btn" onClick={handleSummarize} disabled={summarizing}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              <line x1="9" y1="10" x2="15" y2="10"/><line x1="12" y1="7" x2="12" y2="13"/>
            </svg>
            {summarizing ? (isZh ? '生成中...' : 'Summarizing...') : t.editor.aiSummary}
          </button>
        )}
        <div className="reading-mode-spacer" />
        <button className="reading-mode-btn reading-mode-close" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div className="reading-mode-content">
        <h1 className="reading-mode-title">{title}</h1>
        {summary && (
          <div className="reading-mode-summary">
            <strong>{isZh ? 'AI 摘要' : 'AI Summary'}:</strong> {summary}
          </div>
        )}
        <div
          className="reading-mode-body editor-content"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(content, settings.showCodeLangLabel) }}
        />
      </div>
    </div>
  )
}
