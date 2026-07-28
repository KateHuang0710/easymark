import React, { useEffect, useRef, useState } from 'react'
import { DeleteNoteResult, Note, NoteSummary, RenameNoteResult } from '../types'
import { useTranslation } from '../i18n'

interface SidebarProps {
  notes: NoteSummary[]
  currentNote: Note | null
  searchQuery: string
  onSearchChange: (query: string) => void
  onNoteSelect: (note: NoteSummary) => void
  onNoteCreate: (title?: string) => void | Promise<unknown>
  onNoteDelete: (filename: string) => void | DeleteNoteResult | Promise<void | DeleteNoteResult>
  onNoteRename: (oldFilename: string, newTitle: string) => void | RenameNoteResult | Promise<void | RenameNoteResult>
  onTogglePinned: (filename: string) => void
  onToggleFavorite: (filename: string) => void
  loading: boolean
  loadError: string
  onRetryLoad: () => void | Promise<unknown>
  collapsed: boolean
  onToggle: () => void
  createRequestId?: number
}

export function Sidebar({
  notes,
  currentNote,
  searchQuery,
  onSearchChange,
  onNoteSelect,
  onNoteCreate,
  onNoteDelete,
  onNoteRename,
  onTogglePinned,
  onToggleFavorite,
  loading,
  loadError,
  onRetryLoad,
  collapsed,
  onToggle,
  createRequestId = 0,
}: SidebarProps) {
  const { t } = useTranslation()
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [operationPending, setOperationPending] = useState(false)
  const [operationError, setOperationError] = useState('')
  const renameCancelRef = useRef(false)

  const handleCreate = () => {
    setCreating(true)
    setNewTitle('')
  }

  const cancelCreate = () => {
    if (operationPending) return
    setCreating(false)
    setNewTitle('')
    setOperationError('')
  }

  useEffect(() => {
    if (!createRequestId) return
    setCreating(true)
    setNewTitle('')
    setOperationError('')
  }, [createRequestId])

  const confirmCreate = async () => {
    const title = newTitle.trim()
    if (!title || operationPending) return
    setOperationPending(true)
    setOperationError('')
    try {
      await onNoteCreate(title)
      setCreating(false)
      setNewTitle('')
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error))
    } finally {
      setOperationPending(false)
    }
  }

  const startRename = (note: NoteSummary) => {
    renameCancelRef.current = false
    setRenamingId(note.id)
    setRenameValue(note.title)
  }

  const confirmRename = async (note: NoteSummary) => {
    const title = renameValue.trim()
    if (operationPending) return
    if (!title || title === note.title) {
      setRenamingId(null)
      return
    }
    setOperationPending(true)
    setOperationError('')
    try {
      const result = await onNoteRename(note.filename, title)
      setRenamingId(null)
      if (result?.historyMigrationFailed) {
        setOperationError(t.sidebar.historyMigrationFailed)
      }
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error))
    } finally {
      setOperationPending(false)
    }
  }

  const formatDate = (ms: number) => {
    const d = new Date(ms)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    if (diff < 86400000) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    if (diff < 604800000) return d.toLocaleDateString(undefined, { weekday: 'short' })
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }

  if (collapsed) {
    return (
      <div className="sidebar sidebar-collapsed">
        <button className="sidebar-toggle-btn" onClick={onToggle} title={t.sidebar.expand}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div className="sidebar-collapsed-notes">
          {notes.slice(0, 8).map(n => (
            <button
              key={n.id}
              className={`sidebar-collapsed-item ${currentNote?.id === n.id ? 'active' : ''}`}
              onClick={() => onNoteSelect(n)}
              title={n.title}
            >
              {n.title.charAt(0).toUpperCase()}
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-header-row">
          <span className="sidebar-title">{t.sidebar.notes}</span>
          <div className="sidebar-header-actions">
            <button className="sidebar-btn" onClick={handleCreate} title={t.sidebar.newNote}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
            <button className="sidebar-btn" onClick={onToggle} title={t.sidebar.collapse}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        </div>
        <div className="sidebar-search">
          <svg className="sidebar-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder={t.sidebar.search}
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
            className="sidebar-search-input"
          />
        </div>
      </div>

      <div className="sidebar-list">
        {loadError ? (
          <div className="sidebar-load-error" role="alert">
            <strong>{t.sidebar.loadFailed}</strong>
            <span>{loadError}</span>
            <button
              className="sidebar-empty-btn"
              onClick={() => { void Promise.resolve(onRetryLoad()).catch(() => {}) }}
              disabled={loading}
            >
              {loading ? t.sidebar.loading : t.sidebar.retry}
            </button>
          </div>
        ) : loading && notes.length === 0 ? (
          <div className="sidebar-empty"><p>{t.sidebar.loading}</p></div>
        ) : notes.length === 0 && (
          <div className="sidebar-empty">
            <p>{t.sidebar.noNotes}</p>
            <button className="sidebar-empty-btn" onClick={handleCreate}>{t.sidebar.createFirst}</button>
          </div>
        )}

        {creating && (
          <div className="sidebar-creating">
            <input
              type="text"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); void confirmCreate() }
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelCreate() }
              }}
              onBlur={event => {
                if (!event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) cancelCreate()
              }}
              placeholder={t.sidebar.noteTitle}
              autoFocus
              className="sidebar-create-input"
            />
            <button type="button" className="sidebar-create-cancel" onClick={cancelCreate} title={t.editor.close} aria-label={t.editor.close}>×</button>
          </div>
        )}

        {notes.map(note => (
          <div
            key={note.id}
            className={`sidebar-note ${currentNote?.id === note.id ? 'active' : ''}`}
            role="button"
            tabIndex={0}
            aria-current={currentNote?.id === note.id ? 'page' : undefined}
            onClick={() => {
              if (renamingId !== note.id) onNoteSelect(note)
            }}
            onKeyDown={e => {
              if (renamingId === note.id) return
              // Ignore key events from child elements (e.g., input)
              if (e.target !== e.currentTarget) return
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onNoteSelect(note)
              }
            }}
          >
            <div className="sidebar-note-content">
              {renamingId === note.id ? (
                <input
                  type="text"
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); void confirmRename(note) }
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      renameCancelRef.current = true
                      setRenamingId(null)
                    }
                    e.stopPropagation()
                  }}
                  onBlur={() => {
                    if (!renameCancelRef.current) void confirmRename(note)
                    renameCancelRef.current = false
                  }}
                  autoFocus
                  className="sidebar-rename-input"
                  onClick={e => e.stopPropagation()}
                />
              ) : (
                <span className="sidebar-note-title" onDoubleClick={(e) => { e.stopPropagation(); startRename(note) }}>
                  {note.title}
                </span>
              )}
              <span className="sidebar-note-date">{formatDate(note.lastModified)}</span>
            </div>
            <div className="sidebar-note-markers">
              <button
                className={`sidebar-note-marker ${note.pinned ? 'active' : ''}`}
                onClick={event => { event.stopPropagation(); onTogglePinned(note.filename) }}
                title={note.pinned ? '取消置顶' : '置顶'}
                aria-pressed={Boolean(note.pinned)}
              >⌖</button>
              <button
                className={`sidebar-note-marker ${note.favorite ? 'active' : ''}`}
                onClick={event => { event.stopPropagation(); onToggleFavorite(note.filename) }}
                title={note.favorite ? '取消收藏' : '收藏'}
                aria-pressed={Boolean(note.favorite)}
              >☆</button>
            </div>
            <button
              className="sidebar-note-delete"
              onClick={e => {
                e.stopPropagation()
                if (!window.confirm(`${t.sidebar.deleteNote}: ${note.title}?`)) return
                setOperationError('')
                void Promise.resolve(onNoteDelete(note.filename)).then(result => {
                  if (result?.historyDeletionFailed) setOperationError(t.sidebar.historyDeletionFailed)
                }).catch(error => {
                  setOperationError(error instanceof Error ? error.message : String(error))
                })
              }}
              title={t.sidebar.deleteNote}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      {operationError && <div className="sidebar-operation-error" role="alert">{operationError}</div>}

      <div className="sidebar-footer">
        <span className="sidebar-footer-text">
          {(notes.length === 1 ? t.sidebar.noteCount : t.sidebar.noteCountPlural)
            .replace(/\{count\}/g, String(notes.length))}
        </span>
      </div>
    </div>
  )
}
