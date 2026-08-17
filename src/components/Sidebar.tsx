import React, { useEffect, useMemo, useRef, useState } from 'react'
import { DeleteNoteResult, Note, NoteSummary, RenameNoteResult } from '../types'
import { useTranslation } from '../i18n'

type SidebarView = 'all' | 'recent' | 'favorite' | 'pinned'

const SIDEBAR_WIDTH_KEY = 'easymark-sidebar-width'
const SIDEBAR_DEFAULT_WIDTH = 278
const SIDEBAR_MIN_WIDTH = 220
const SIDEBAR_MAX_WIDTH = 420

function clampSidebarWidth(width: number): number {
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.round(width)))
}

function getInitialSidebarWidth(): number {
  try {
    const saved = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY))
    if (Number.isFinite(saved) && saved > 0) return clampSidebarWidth(saved)
  } catch {}
  return SIDEBAR_DEFAULT_WIDTH
}

type SidebarProps = {
  notes: NoteSummary[]
  totalNoteCount?: number
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

function PinIcon({ filled = false }: { filled?: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="m14 4 6 6-2.5 2.5-1-1-3.5 3.5v4l-2 2-1-6-6-1 2-2h4L14.5 8l-1-1L14 4Z" />
    </svg>
  )
}

function StarIcon({ filled = false }: { filled?: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" />
    </svg>
  )
}

function MoreIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="m5 12 4 4L19 6" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  )
}

export function Sidebar({
  notes,
  totalNoteCount = notes.length,
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
  const searchInputRef = useRef<HTMLInputElement>(null)
  const activeNoteRef = useRef<HTMLDivElement>(null)
  const createAreaRef = useRef<HTMLDivElement>(null)
  const createButtonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null)
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [operationPending, setOperationPending] = useState(false)
  const [operationError, setOperationError] = useState('')
  const [menuNoteId, setMenuNoteId] = useState<string | null>(null)
  const [view, setView] = useState<SidebarView>('all')
  const [sidebarWidth, setSidebarWidth] = useState(getInitialSidebarWidth)
  const [resizing, setResizing] = useState(false)
  const renameCancelRef = useRef(false)
  const operationPendingRef = useRef(false)
  const resizeStartRef = useRef<{ pointerId: number; x: number; width: number } | null>(null)

  const collapsedNotes = useMemo(() => {
    const sorted = [...notes].sort((a, b) => {
      const aScore = a.pinned ? 3 : a.favorite ? 2 : a.lastOpened ? 1 : 0
      const bScore = b.pinned ? 3 : b.favorite ? 2 : b.lastOpened ? 1 : 0
      return bScore - aScore || (b.lastOpened || b.lastModified) - (a.lastOpened || a.lastModified)
    })
    const current = currentNote ? sorted.find((note) => note.id === currentNote.id) : undefined
    const shortlist = sorted.slice(0, 8)
    if (current && !shortlist.some((note) => note.id === current.id)) {
      shortlist[shortlist.length - 1] = current
    }
    return shortlist
  }, [currentNote, notes])

  const hasSearch = searchQuery.trim().length > 0
  const searchShortcut = typeof window !== 'undefined' && window.electronAPI?.platform === 'darwin' ? '⌘K' : 'Ctrl K'
  const viewCounts = useMemo(
    () => ({
      all: notes.length,
      recent: notes.filter((note) => note.lastOpened).length,
      favorite: notes.filter((note) => note.favorite).length,
      pinned: notes.filter((note) => note.pinned).length,
    }),
    [notes],
  )

  const visibleNotes = useMemo(() => {
    if (hasSearch) return notes
    if (view === 'favorite') return notes.filter((note) => note.favorite)
    if (view === 'pinned') return notes.filter((note) => note.pinned)
    if (view === 'recent') {
      return [...notes].filter((note) => note.lastOpened).sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0) || b.lastModified - a.lastModified)
    }
    return notes
  }, [hasSearch, notes, view])

  useEffect(() => {
    if (!creating) return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (createAreaRef.current?.contains(target) || createButtonRef.current?.contains(target)) return
      cancelCreate(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [creating])

  useEffect(() => {
    if (!menuNoteId) return
    if (collapsed || !visibleNotes.some((note) => note.id === menuNoteId)) {
      setMenuNoteId(null)
      return
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuNoteId(null)
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [collapsed, menuNoteId, visibleNotes])

  useEffect(() => {
    if (!menuNoteId) return
    const frame = requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLElement>('[role=\"menuitem\"]')?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [menuNoteId])

  const beginOperation = () => {
    if (operationPendingRef.current) return false
    operationPendingRef.current = true
    setOperationPending(true)
    return true
  }

  const endOperation = () => {
    operationPendingRef.current = false
    setOperationPending(false)
  }

  const handleCreate = () => {
    if (operationPendingRef.current) return
    if (creating) {
      cancelCreate(true)
      return
    }
    setMenuNoteId(null)
    renameCancelRef.current = true
    setRenamingId(null)
    setCreating(true)
    setNewTitle('')
    setOperationError('')
  }

  const cancelCreate = (restoreFocus = false) => {
    if (operationPendingRef.current) return
    setCreating(false)
    setNewTitle('')
    setOperationError('')
    if (restoreFocus) requestAnimationFrame(() => createButtonRef.current?.focus({ preventScroll: true }))
  }

  useEffect(() => {
    try { window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth)) } catch {}
  }, [sidebarWidth])

  useEffect(() => {
    if (!createRequestId || operationPendingRef.current) return
    renameCancelRef.current = true
    setRenamingId(null)
    setCreating(true)
    setNewTitle('')
    setMenuNoteId(null)
    setOperationError('')
  }, [createRequestId])

  const confirmCreate = async () => {
    const title = newTitle.trim()
    if (!title || !beginOperation()) return
    setOperationError('')
    try {
      await onNoteCreate(title)
      setCreating(false)
      setNewTitle('')
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error))
    } finally {
      endOperation()
    }
  }

  const startRename = (note: NoteSummary) => {
    if (operationPendingRef.current) return
    renameCancelRef.current = false
    setMenuNoteId(null)
    setRenamingId(note.id)
    setRenameValue(note.title)
  }

  const confirmRename = async (note: NoteSummary) => {
    const title = renameValue.trim()
    if (!title || title === note.title) {
      setRenamingId(null)
      return
    }
    if (!beginOperation()) return
    setOperationError('')
    try {
      const result = await onNoteRename(note.filename, title)
      setRenamingId(null)
      if (result?.historyMigrationFailed) setOperationError(t.sidebar.historyMigrationFailed)
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error))
    } finally {
      endOperation()
    }
  }

  const deleteNote = async (note: NoteSummary) => {
    if (operationPendingRef.current) return
    setMenuNoteId(null)
    if (!window.confirm(`${t.sidebar.deleteNote}: ${note.title}?`)) return
    if (!beginOperation()) return
    setOperationError('')
    try {
      const result = await onNoteDelete(note.filename)
      if (result?.historyDeletionFailed) setOperationError(t.sidebar.historyDeletionFailed)
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error))
    } finally {
      endOperation()
    }
  }

  const formatDate = (ms: number) => {
    const d = new Date(ms)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    if (diff < 86400000)
      return d.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      })
    if (diff < 604800000) return d.toLocaleDateString(undefined, { weekday: 'short' })
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }

  const viewLabel = (value: SidebarView) =>
    ({
      all: t.sidebar.allNotes,
      recent: t.sidebar.recent,
      favorite: t.sidebar.favorites,
      pinned: t.sidebar.pinned,
    })[value]

  const renderNote = (note: NoteSummary, index: number) => (
    <div
      key={note.id}
      className={`sidebar-note ${currentNote?.id === note.id ? 'active' : ''} ${menuNoteId === note.id ? 'menu-open' : ''} ${index >= visibleNotes.length - 2 ? 'sidebar-note-near-bottom' : ''}`}
      role="listitem"
      ref={currentNote?.id === note.id ? activeNoteRef : undefined}
      tabIndex={0}
      aria-current={currentNote?.id === note.id ? 'page' : undefined}
      onClick={() => {
        if (creating) cancelCreate()
        if (renamingId !== note.id) onNoteSelect(note)
      }}
      onKeyDown={(event) => {
        if (renamingId === note.id || event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onNoteSelect(note)
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
          event.preventDefault()
          const items = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role=\"listitem\"][tabindex=\"0\"]') || [])
          const currentIndex = items.indexOf(event.currentTarget)
          if (currentIndex < 0 || items.length === 0) return
          const nextIndex =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? items.length - 1
                : Math.max(0, Math.min(items.length - 1, currentIndex + (event.key === 'ArrowDown' ? 1 : -1)))
          items[nextIndex]?.focus()
        } else if (event.key === 'F2') {
          event.preventDefault()
          startRename(note)
        } else if (event.key === 'Delete') {
          event.preventDefault()
          void deleteNote(note)
        }
      }}
    >
      <div className="sidebar-note-content">
        {renamingId === note.id ? (
          <input
            type="text"
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                renameCancelRef.current = true
                void confirmRename(note)
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                renameCancelRef.current = true
                setRenamingId(null)
              }
              event.stopPropagation()
            }}
            onBlur={() => {
              if (!renameCancelRef.current) void confirmRename(note)
              renameCancelRef.current = false
            }}
            autoFocus
            className="sidebar-rename-input"
            onClick={(event) => event.stopPropagation()}
          />
        ) : (
          <span
            className="sidebar-note-title"
            onDoubleClick={(event) => {
              event.stopPropagation()
              startRename(note)
            }}
          >
            {note.title}
          </span>
        )}
        <span className="sidebar-note-date">{formatDate(note.lastModified)}</span>
      </div>
      <div
        className="sidebar-note-status"
        aria-label={[note.pinned && t.sidebar.pinned, note.favorite && t.sidebar.favorites].filter(Boolean).join(', ') || undefined}
      >
        {note.pinned && (
          <span title={t.sidebar.unpin}>
            <PinIcon filled />
          </span>
        )}
        {note.favorite && (
          <span title={t.sidebar.unfavorite}>
            <StarIcon filled />
          </span>
        )}
      </div>
      <button
        type="button"
        className="sidebar-note-more"
        disabled={operationPending}
        aria-label={`${t.sidebar.more}: ${note.title}`}
        aria-haspopup="menu"
        aria-expanded={menuNoteId === note.id}
        onClick={(event) => {
          event.stopPropagation()
          if (menuNoteId === note.id) {
            setMenuNoteId(null)
            menuTriggerRef.current?.focus()
          } else {
            menuTriggerRef.current = event.currentTarget
            setMenuNoteId(note.id)
          }
        }}
      >
        <MoreIcon />
      </button>
      {menuNoteId === note.id && (
        <div
          className="sidebar-note-menu"
          role="menu"
          ref={menuRef}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role=\"menuitem\"]:not(:disabled)') || [])
            const currentIndex = items.indexOf(event.target as HTMLElement)
            if (event.key === 'Escape') {
              event.preventDefault()
              setMenuNoteId(null)
              menuTriggerRef.current?.focus()
            } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && items.length) {
              event.preventDefault()
              const next = (currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
              items[next]?.focus()
            } else if ((event.key === 'Home' || event.key === 'End') && items.length) {
              event.preventDefault()
              items[event.key === 'Home' ? 0 : items.length - 1]?.focus()
            }
          }}
        >
          <button type="button" role="menuitem" onClick={() => startRename(note)} disabled={operationPending}>
            {t.sidebar.rename}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuNoteId(null)
              onTogglePinned(note.filename)
            }}
            disabled={operationPending}
          >
            {note.pinned ? t.sidebar.unpin : t.sidebar.pin}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuNoteId(null)
              onToggleFavorite(note.filename)
            }}
            disabled={operationPending}
          >
            {note.favorite ? t.sidebar.unfavorite : t.sidebar.favorite}
          </button>
          <div className="sidebar-note-menu-divider" />
          <button
            type="button"
            role="menuitem"
            className="danger"
            onClick={() => {
              void deleteNote(note)
            }}
            disabled={operationPending}
          >
            {t.sidebar.deleteNote}
          </button>
        </div>
      )}
    </div>
  )

  if (collapsed) {
    return (
      <div className="sidebar sidebar-collapsed" aria-busy={operationPending || undefined}>
        <button className="sidebar-toggle-btn" onClick={onToggle} title={t.sidebar.expand} aria-label={t.sidebar.expand}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <button
          ref={createButtonRef}
          className="sidebar-toggle-btn sidebar-collapsed-new"
          onClick={() => {
            onToggle()
            handleCreate()
          }}
          title={t.sidebar.newNote}
          aria-label={t.sidebar.newNote}
          disabled={operationPending}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        <div
          className="sidebar-collapsed-notes"
          role="list"
          aria-label={t.sidebar.notes}
          onKeyDown={(event) => {
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
            const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('.sidebar-collapsed-item'))
            const currentIndex = items.indexOf(event.target as HTMLButtonElement)
            if (currentIndex < 0 || !items.length) return
            event.preventDefault()
            const nextIndex =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? items.length - 1
                  : Math.max(0, Math.min(items.length - 1, currentIndex + (event.key === 'ArrowDown' ? 1 : -1)))
            items[nextIndex]?.focus()
          }}
        >
          {collapsedNotes.map((note) => (
            <button
              key={note.id}
              className={`sidebar-collapsed-item ${currentNote?.id === note.id ? 'active' : ''}`}
              onClick={() => onNoteSelect(note)}
              title={note.title}
              aria-label={note.title}
              aria-current={currentNote?.id === note.id ? 'page' : undefined}
            >
              {note.title.trim().charAt(0).toUpperCase() || '•'}
              {(note.pinned || note.favorite) && <span className="sidebar-collapsed-status" aria-hidden="true" />}
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div
      className={`sidebar ${resizing ? 'sidebar-resizing' : ''}`}
      style={{ width: sidebarWidth, minWidth: sidebarWidth }}
      aria-busy={operationPending || undefined}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
          event.preventDefault()
          searchInputRef.current?.focus()
          searchInputRef.current?.select()
        }
      }}
    >
      <div className="sidebar-header">
        <div className="sidebar-header-row">
          <div className="sidebar-heading">
            <span className="sidebar-title">{t.sidebar.notes}</span>
            <span className="sidebar-total-count">{totalNoteCount}</span>
          </div>
          <div className="sidebar-header-actions">
            <button
              ref={createButtonRef}
              className="sidebar-btn"
              onMouseDown={() => {
                renameCancelRef.current = true
              }}
              onClick={handleCreate}
              title={t.sidebar.newNote}
              aria-label={t.sidebar.newNote}
              disabled={operationPending}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
            <button className="sidebar-btn" onClick={onToggle} title={t.sidebar.collapse} aria-label={t.sidebar.collapse}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        </div>
        <div className="sidebar-search">
          <span className="sidebar-search-icon">
            <SearchIcon />
          </span>
          <input
            ref={searchInputRef}
            type="search"
            placeholder={t.sidebar.search}
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Escape' || !hasSearch) return
              event.preventDefault()
              event.stopPropagation()
              onSearchChange('')
            }}
            className="sidebar-search-input"
            aria-label={t.sidebar.search}
          />
          {hasSearch && (
            <button
              type="button"
              className="sidebar-search-clear"
              onClick={() => {
                onSearchChange('')
                requestAnimationFrame(() => searchInputRef.current?.focus({ preventScroll: true }))
              }}
              title={t.sidebar.clearSearch}
              aria-label={t.sidebar.clearSearch}
            >
              <CloseIcon />
            </button>
          )}
          <kbd className="sidebar-search-shortcut">{searchShortcut}</kbd>
        </div>
        {!hasSearch && (
          <nav
            className="sidebar-view-tabs"
            aria-label={t.sidebar.quickAccess}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
              const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('.sidebar-view-tab'))
              const currentIndex = tabs.indexOf(event.target as HTMLButtonElement)
              if (currentIndex < 0 || !tabs.length) return
              event.preventDefault()
              const nextIndex =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? tabs.length - 1
                    : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
              tabs[nextIndex]?.focus()
              tabs[nextIndex]?.click()
            }}
          >
            {(['all', 'recent', 'favorite', 'pinned'] as SidebarView[]).map((item) => (
              <button
                key={item}
                type="button"
                className={`sidebar-view-tab ${view === item ? 'active' : ''}`}
                onClick={() => setView(item)}
                aria-current={view === item ? 'page' : undefined}
                title={viewLabel(item)}
              >
                <span>{viewLabel(item)}</span>
                <span className="sidebar-view-count">{viewCounts[item]}</span>
              </button>
            ))}
          </nav>
        )}
      </div>

      <div className="sidebar-list">
        {loadError ? (
          <div className="sidebar-load-error" role="alert">
            <strong>{t.sidebar.loadFailed}</strong>
            <span>{loadError}</span>
            <button
              className="sidebar-empty-btn"
              onClick={() => {
                void Promise.resolve(onRetryLoad()).catch(() => {})
              }}
              disabled={loading}
            >
              {loading ? t.sidebar.loading : t.sidebar.retry}
            </button>
          </div>
        ) : loading && notes.length === 0 ? (
          <div className="sidebar-empty">
            <p>{t.sidebar.loading}</p>
          </div>
        ) : (
          <>
            {creating && (
              <div className="sidebar-creating" ref={createAreaRef}>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(event) => setNewTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void confirmCreate()
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      event.stopPropagation()
                      cancelCreate(true)
                    }
                    event.stopPropagation()
                  }}
                  placeholder={t.sidebar.noteTitle}
                  autoFocus
                  className="sidebar-create-input"
                  aria-label={t.sidebar.noteTitle}
                  disabled={operationPending}
                />
                <button
                  type="button"
                  className="sidebar-create-confirm"
                  onClick={() => {
                    void confirmCreate()
                  }}
                  title={t.sidebar.createNote}
                  aria-label={t.sidebar.createNote}
                  disabled={operationPending || !newTitle.trim()}
                >
                  <CheckIcon />
                </button>
                <button
                  type="button"
                  className="sidebar-create-cancel"
                  onClick={() => cancelCreate(true)}
                  title={t.sidebar.cancel}
                  aria-label={t.sidebar.cancel}
                  disabled={operationPending}
                >
                  <CloseIcon />
                </button>
              </div>
            )}
            {visibleNotes.length === 0 ? (
              <div className="sidebar-empty">
                <p>
                  {hasSearch
                    ? t.sidebar.noSearchResults
                    : view === 'favorite'
                      ? t.sidebar.noFavorites
                      : view === 'pinned'
                        ? t.sidebar.noPinned
                        : t.sidebar.noNotes}
                </p>
                {!hasSearch && view === 'all' && (
                  <button className="sidebar-empty-btn" onClick={handleCreate}>
                    {t.sidebar.createFirst}
                  </button>
                )}
                {!hasSearch && view !== 'all' && (
                  <button className="sidebar-empty-btn" onClick={() => setView('all')}>
                    {t.sidebar.showAllNotes}
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="sidebar-list-heading">
                  <span>{hasSearch ? t.sidebar.searchResults : viewLabel(view)}</span>
                  <span>{visibleNotes.length}</span>
                </div>
                <div className="sidebar-notes" role="list" aria-label={viewLabel(view)}>
                  {visibleNotes.map(renderNote)}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {operationError && (
        <div className="sidebar-operation-error" role="alert">
          {operationError}
        </div>
      )}

      <div className="sidebar-footer">
        <span className="sidebar-footer-text">
          {hasSearch
            ? t.sidebar.searchCount.replace(/\{shown\}/g, String(notes.length)).replace(/\{total\}/g, String(totalNoteCount))
            : (notes.length === 1 ? t.sidebar.noteCount : t.sidebar.noteCountPlural).replace(/\{count\}/g, String(notes.length))}
        </span>
        <span className="sidebar-footer-hint">{t.sidebar.keyboardHint}</span>
      </div>
      <div
        className="sidebar-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label={t.sidebar.resize}
        aria-valuemin={SIDEBAR_MIN_WIDTH}
        aria-valuemax={SIDEBAR_MAX_WIDTH}
        aria-valuenow={sidebarWidth}
        title={t.sidebar.resizeHint}
        tabIndex={0}
        onDoubleClick={() => setSidebarWidth(SIDEBAR_DEFAULT_WIDTH)}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          resizeStartRef.current = { pointerId: event.pointerId, x: event.clientX, width: sidebarWidth }
          event.currentTarget.setPointerCapture(event.pointerId)
          setResizing(true)
          event.preventDefault()
        }}
        onPointerMove={(event) => {
          const start = resizeStartRef.current
          if (!start || start.pointerId !== event.pointerId) return
          setSidebarWidth(clampSidebarWidth(start.width + event.clientX - start.x))
        }}
        onPointerUp={(event) => {
          if (resizeStartRef.current?.pointerId !== event.pointerId) return
          resizeStartRef.current = null
          setResizing(false)
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onPointerCancel={() => {
          resizeStartRef.current = null
          setResizing(false)
        }}
        onKeyDown={(event) => {
          let nextWidth = sidebarWidth
          if (event.key === 'ArrowLeft') nextWidth -= event.shiftKey ? 32 : 12
          else if (event.key === 'ArrowRight') nextWidth += event.shiftKey ? 32 : 12
          else if (event.key === 'Home') nextWidth = SIDEBAR_MIN_WIDTH
          else if (event.key === 'End') nextWidth = SIDEBAR_MAX_WIDTH
          else return
          event.preventDefault()
          event.stopPropagation()
          setSidebarWidth(clampSidebarWidth(nextWidth))
        }}
      />
    </div>
  )
}
