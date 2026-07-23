import React, { useState } from 'react'
import { Note, NoteSummary } from '../types'
import { useTranslation } from '../i18n'

interface SidebarProps {
  notes: NoteSummary[]
  currentNote: Note | null
  searchQuery: string
  onSearchChange: (query: string) => void
  onNoteSelect: (note: NoteSummary) => void
  onNoteCreate: (title?: string) => void | Promise<unknown>
  onNoteDelete: (filename: string) => void | Promise<unknown>
  onNoteRename: (oldFilename: string, newTitle: string) => void | Promise<unknown>
  collapsed: boolean
  onToggle: () => void
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
  collapsed,
  onToggle,
}: SidebarProps) {
  const { t } = useTranslation()
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [operationPending, setOperationPending] = useState(false)
  const [operationError, setOperationError] = useState('')

  const handleCreate = () => {
    setCreating(true)
    setNewTitle('')
  }

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
      await onNoteRename(note.filename, title)
      setRenamingId(null)
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
        {notes.length === 0 && (
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
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void confirmCreate() }; if (e.key === 'Escape') setCreating(false) }}
              placeholder={t.sidebar.noteTitle}
              autoFocus
              className="sidebar-create-input"
            />
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
                    if (e.key === 'Escape') setRenamingId(null)
                    e.stopPropagation()
                  }}
                  onBlur={() => { void confirmRename(note) }}
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
            <button
              className="sidebar-note-delete"
              onClick={e => {
                e.stopPropagation()
                if (!window.confirm(`${t.sidebar.deleteNote}: ${note.title}?`)) return
                setOperationError('')
                void Promise.resolve(onNoteDelete(note.filename)).catch(error => {
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
          {t.sidebar.noteCount.replace(/\{count\}/g, String(notes.length))}
        </span>
      </div>
    </div>
  )
}
