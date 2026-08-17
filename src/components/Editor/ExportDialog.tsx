import React, { useRef, useState } from 'react'
import { useTranslation } from '../../i18n'
import { useSettings } from '../../contexts/SettingsContext'
import { renderMarkdown } from '../../services/markdown'
import { useDialogFocus } from '../../hooks/useDialogFocus'

interface ExportDialogProps {
  visible: boolean
  onClose: () => void
  content: string
  title: string
}

export function ExportDialog({ visible, onClose, content, title }: ExportDialogProps) {
  const { t, locale } = useTranslation()
  const { settings } = useSettings()
  const [exporting, setExporting] = useState<'pdf' | 'docx' | null>(null)
  const [result, setResult] = useState<{ success: boolean; path?: string } | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  useDialogFocus(visible, dialogRef)
  const isZh = locale === 'zh'
  const isDark = settings.theme === 'dark'

  const handleExportPDF = async () => {
    setExporting('pdf')
    setResult(null)
    try {
      const html = `<html><head>
        <meta charset="utf-8">
        <style>
          body { font-family: 'Inter', -apple-system, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px; line-height: 1.7; color: ${isDark ? '#e0e0e0' : '#222'}; background: ${isDark ? '#1e1e1e' : '#fff'}; }
          h1 { font-size: 28px; border-bottom: 1px solid ${isDark ? '#444' : '#ddd'}; padding-bottom: 8px; color: ${isDark ? '#fff' : '#222'}; }
          h2 { font-size: 22px; margin-top: 28px; color: ${isDark ? '#eee' : '#222'}; }
          h3 { font-size: 18px; margin-top: 22px; color: ${isDark ? '#eee' : '#222'}; }
          code { background: ${isDark ? '#333' : '#f0f0f0'}; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; color: ${isDark ? '#e0e0e0' : '#222'}; }
          pre { background: ${isDark ? '#2d2d2d' : '#f5f5f5'}; padding: 16px; border-radius: 8px; overflow-x: auto; }
          pre code { background: none; padding: 0; }
          blockquote { border-left: 4px solid ${isDark ? '#555' : '#ddd'}; margin: 0; padding-left: 16px; color: ${isDark ? '#aaa' : '#666'}; }
          img { max-width: 100%; }
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid ${isDark ? '#444' : '#ddd'}; padding: 8px 12px; text-align: left; }
          th { background: ${isDark ? '#333' : '#f5f5f5'}; color: ${isDark ? '#e0e0e0' : '#222'}; }
          a { color: ${isDark ? '#64b5f6' : '#1976d2'}; }
        </style>
      </head><body>${renderMarkdown(content, settings.showCodeLangLabel)}</body></html>`

      const path = await window.electronAPI.exportPDF(html, title)
      if (path) {
        setResult({ success: true, path })
      } else {
        setResult(null)
      }
    } catch {
      setResult({ success: false })
    }
    setExporting(null)
  }

  const handleExportDOCX = async () => {
    setExporting('docx')
    setResult(null)
    try {
      const path = await window.electronAPI.exportDOCX(content, title)
      if (path) {
        setResult({ success: true, path })
      } else {
        setResult(null)
      }
    } catch {
      setResult({ success: false })
    }
    setExporting(null)
  }

  if (!visible) return null

  const handleClose = () => {
    onClose()
  }

  return (
    <div className="settings-overlay" onClick={handleClose}>
      <div
        ref={dialogRef}
        className="export-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t.editor.export}
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
      >
        <div className="settings-content-header">
          <h2>{t.editor.export}</h2>
          <button className="settings-close-btn" onClick={handleClose} aria-label={t.editor.close}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="export-options">
          <button
            className="export-btn"
            onClick={handleExportPDF}
            disabled={exporting !== null}
          >
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
              <polyline points="10 9 9 9 8 9"/>
            </svg>
            <span>{t.editor.exportPDF}</span>
            {exporting === 'pdf' && <span className="export-spinner" />}
          </button>
          <button
            className="export-btn"
            onClick={handleExportDOCX}
            disabled={exporting !== null}
          >
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
            <span>{t.editor.exportDOCX}</span>
            {exporting === 'docx' && <span className="export-spinner" />}
          </button>
        </div>
        {result && (
          <div className={`export-result ${result.success ? 'success' : 'error'}`}>
            {result.success
              ? (isZh ? `已导出到 ${result.path}` : `Saved to ${result.path}`)
              : (isZh ? '导出失败' : 'Export failed')}
          </div>
        )}
      </div>
    </div>
  )
}
