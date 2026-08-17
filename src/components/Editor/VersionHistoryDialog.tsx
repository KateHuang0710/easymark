import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from '../../i18n'
import * as storage from '../../services/storage'
import { NoteVersion } from '../../types'
import { useDialogFocus } from '../../hooks/useDialogFocus'

interface VersionHistoryDialogProps {
  visible: boolean
  filename: string | null
  title: string
  onClose: () => void
  onRestored: (content: string) => void
}

function formatSize(template: string, bytes: number): string {
  return template.replace('{size}', Math.max(0.1, bytes / 1024).toFixed(1))
}

export function VersionHistoryDialog({ visible, filename, title, onClose, onRestored }: VersionHistoryDialogProps) {
  const { t, locale } = useTranslation()
  const [versions, setVersions] = useState<NoteVersion[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [preview, setPreview] = useState('')
  const [loading, setLoading] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [restored, setRestored] = useState(false)
  const listRequestRef = useRef(0)
  const previewRequestRef = useRef(0)
  const dialogRef = useRef<HTMLDivElement>(null)
  useDialogFocus(visible && Boolean(filename), dialogRef)

  const loadVersions = useCallback(async (noteFilename: string) => {
    const requestId = ++listRequestRef.current
    setLoading(true)
    setError(null)
    try {
      const result = await storage.listNoteVersions(noteFilename)
      if (requestId !== listRequestRef.current) return
      setVersions(result)
      setSelectedId(current => result.some(version => version.id === current) ? current : result[0]?.id || null)
    } catch (loadError) {
      if (requestId !== listRequestRef.current) return
      console.error('Failed to load note history:', loadError)
      setVersions([])
      setSelectedId(null)
      setError(t.editor.historyLoadFailed)
    } finally {
      if (requestId === listRequestRef.current) setLoading(false)
    }
  }, [t.editor.historyLoadFailed])

  useEffect(() => {
    if (!visible || !filename) return
    setVersions([])
    setSelectedId(null)
    setPreview('')
    setRestored(false)
    void loadVersions(filename)
    return () => {
      listRequestRef.current += 1
      previewRequestRef.current += 1
    }
  }, [visible, filename, loadVersions])

  useEffect(() => {
    if (!visible || !filename || !selectedId) {
      setPreview('')
      return
    }
    const requestId = ++previewRequestRef.current
    setPreviewLoading(true)
    setError(null)
    void storage.readNoteVersion(filename, selectedId).then(content => {
      if (requestId === previewRequestRef.current) setPreview(content)
    }).catch(previewError => {
      if (requestId !== previewRequestRef.current) return
      console.error('Failed to read note version:', previewError)
      setPreview('')
      setError(t.editor.historyLoadFailed)
    }).finally(() => {
      if (requestId === previewRequestRef.current) setPreviewLoading(false)
    })
  }, [visible, filename, selectedId, t.editor.historyLoadFailed])

  useEffect(() => {
    if (!visible) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !restoring) onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [visible, restoring, onClose])

  const handleRestore = async () => {
    if (!filename || !selectedId || restoring || !window.confirm(t.editor.restoreConfirm)) return
    setRestoring(true)
    setError(null)
    setRestored(false)
    try {
      const content = await storage.restoreNoteVersion(filename, selectedId)
      onRestored(content)
      setRestored(true)
      await loadVersions(filename)
    } catch (restoreError) {
      console.error('Failed to restore note version:', restoreError)
      setError(t.editor.restoreFailed)
    } finally {
      setRestoring(false)
    }
  }

  if (!visible || !filename) return null

  const dateFormatter = new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  return (
    <div className="settings-overlay" onClick={() => { if (!restoring) onClose() }}>
      <div
        ref={dialogRef}
        className="version-history-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`${t.editor.versionHistory}: ${title}`}
        tabIndex={-1}
        onClick={event => event.stopPropagation()}
      >
        <div className="version-history-header">
          <div>
            <h2>{t.editor.versionHistory}</h2>
            <span>{title}</span>
          </div>
          <button className="settings-close-btn" onClick={onClose} disabled={restoring} title={t.editor.close} aria-label={t.editor.close}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="version-history-body">
          <aside className="version-history-list" aria-label={t.editor.versionHistory}>
            {loading ? (
              <div className="version-history-empty">{t.editor.loadingHistory}</div>
            ) : versions.length === 0 ? (
              <div className="version-history-empty">{error || t.editor.noVersions}</div>
            ) : versions.map(version => (
              <button
                key={version.id}
                className={`version-history-item ${selectedId === version.id ? 'active' : ''}`}
                onClick={() => { setRestored(false); setSelectedId(version.id) }}
              >
                <strong>{dateFormatter.format(new Date(version.createdAt))}</strong>
                <span>{formatSize(t.editor.versionSize, version.size)}</span>
              </button>
            ))}
          </aside>

          <section className="version-history-preview" aria-label={t.editor.versionPreview}>
            <div className="version-history-preview-title">{t.editor.versionPreview}</div>
            {previewLoading ? (
              <div className="version-history-empty">{t.editor.loadingHistory}</div>
            ) : selectedId ? (
              <pre>{preview}</pre>
            ) : (
              <div className="version-history-empty">{t.editor.noVersions}</div>
            )}
          </section>
        </div>

        <div className="version-history-footer">
          <div className="version-history-message" role="status">
            {error || (restored ? t.editor.restored : '')}
          </div>
          <button
            className="version-history-restore"
            onClick={() => { void handleRestore() }}
            disabled={!selectedId || previewLoading || restoring}
          >
            {restoring ? t.editor.saving : t.editor.restoreVersion}
          </button>
        </div>
      </div>
    </div>
  )
}
