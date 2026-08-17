import React, { lazy, Suspense, useState, useCallback, useEffect, useRef } from 'react'
import { I18nProvider, useTranslation } from './i18n'
import { SettingsProvider, useSettings } from './contexts/SettingsContext'
import { TitleBar } from './components/TitleBar'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Sidebar } from './components/Sidebar'
import { MarkdownEditor } from './components/Editor/MarkdownEditor'
const AIAssistant = lazy(() => import('./components/AIAssistant').then(module => ({ default: module.AIAssistant })))
const SettingsDialog = lazy(() => import('./components/SettingsDialog').then(module => ({ default: module.SettingsDialog })))
const ReadingMode = lazy(() => import('./components/Editor/ReadingMode').then(module => ({ default: module.ReadingMode })))
const ExportDialog = lazy(() => import('./components/Editor/ExportDialog').then(module => ({ default: module.ExportDialog })))
const VersionHistoryDialog = lazy(() => import('./components/Editor/VersionHistoryDialog').then(module => ({ default: module.VersionHistoryDialog })))
const SearchPanel = lazy(() => import('./components/Editor/SearchPanel').then(module => ({ default: module.SearchPanel })))
import { useNotes } from './hooks/useNotes'
import { Note, NoteSummary, SaveStatus } from './types'
import * as storage from './services/storage'
import { LatestSaveQueue } from './services/latestSaveQueue'
const CommandPalette = lazy(() => import('./components/CommandPalette').then(module => ({ default: module.CommandPalette })))
import type { AppCommand } from './components/CommandPalette'
const BacklinksPanel = lazy(() => import('./components/BacklinksPanel').then(module => ({ default: module.BacklinksPanel })))
const GitPanel = lazy(() => import('./components/GitPanel').then(module => ({ default: module.GitPanel })))

function saveErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Could not save note'
}

const DEFAULT_COMPARE_SPLIT = 50
const MIN_COMPARE_SPLIT = 28
const MAX_COMPARE_SPLIT = 72

function clampCompareSplit(value: number): number {
  return Math.min(MAX_COMPARE_SPLIT, Math.max(MIN_COMPARE_SPLIT, value))
}

function AppContent() {
  const { t, locale } = useTranslation()
  const { settings, setTheme, setDualPane } = useSettings()
  const {
    notes,
    currentNote,
    saveStatus,
    allNotes,
    loading,
    listError,
    searchQuery,
    setSearchQuery,
    openNote,
    createNote,
    deleteNote,
    saveCurrentNote,
    autoSave,
    retrySave,
    renameNote,
    togglePinned,
    toggleFavorite,
    importMarkdownFile,
    chooseAndImportMarkdownFile,
    setCurrentNote,
    replaceCurrentNoteContent,
    flushAutoSave,
    refreshList,
  } = useNotes()

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [aiVisible, setAIVisible] = useState(false)
  const [aiInitialTab, setAIInitialTab] = useState<'complete' | 'chat' | 'knowledge'>('complete')
  const [settingsVisible, setSettingsVisible] = useState(false)
  const [readingModeActive, setReadingModeActive] = useState(false)
  const [exportVisible, setExportVisible] = useState(false)
  const [searchAllVisible, setSearchAllVisible] = useState(false)
  const [secondNote, setSecondNote] = useState<Note | null>(null)
  const [secondSaveStatus, setSecondSaveStatus] = useState<SaveStatus>({ state: 'idle' })
  const [compareSplit, setCompareSplit] = useState(DEFAULT_COMPARE_SPLIT)
  const [compareResizing, setCompareResizing] = useState(false)
  const [historyTarget, setHistoryTarget] = useState<{ pane: 'primary' | 'secondary'; filename: string; title: string } | null>(null)
  const [createRequestId, setCreateRequestId] = useState(0)
  const [commandPaletteVisible, setCommandPaletteVisible] = useState(false)
  const [gitPanelVisible, setGitPanelVisible] = useState(false)
  const [dropActive, setDropActive] = useState(false)
  const [primaryFocusRequestId, setPrimaryFocusRequestId] = useState(0)
  const [secondaryFocusRequestId, setSecondaryFocusRequestId] = useState(0)
  const dragDepthRef = useRef(0)
  const compareContainerRef = useRef<HTMLDivElement>(null)
  const comparePointerRef = useRef<number | null>(null)
  const secondSaveTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const secondSaveQueueRef = useRef<LatestSaveQueue | null>(null)
  const secondOpenRequestRef = useRef(0)

  useEffect(() => {
    if (!settings.readingMode) setReadingModeActive(false)
  }, [settings.readingMode])

  if (!secondSaveQueueRef.current) {
    secondSaveQueueRef.current = new LatestSaveQueue(
      snapshot => storage.saveNote(snapshot.filename, snapshot.content),
      {
        onSaving: () => setSecondSaveStatus({ state: 'saving' }),
        onSaved: (snapshot, hasPending) => {
          setSecondSaveStatus(hasPending ? { state: 'saving' } : { state: 'saved', savedAt: Date.now() })
          setSecondNote(prev => prev?.filename === snapshot.filename && prev.content === snapshot.content
            ? { ...prev, lastModified: Date.now() }
            : prev)
        },
        onError: error => {
          setSecondSaveStatus({ state: 'error', error: saveErrorMessage(error) })
          console.error('Second pane auto-save failed:', error)
        },
      },
    )
  }

  const flushSecondSave = useCallback(async () => {
    if (secondSaveTimerRef.current) {
      clearTimeout(secondSaveTimerRef.current)
      secondSaveTimerRef.current = undefined
    }
    return secondSaveQueueRef.current!.flush()
  }, [])

  useEffect(() => () => {
    if (secondSaveTimerRef.current) clearTimeout(secondSaveTimerRef.current)
    void secondSaveQueueRef.current?.flush().catch(error => console.error('Final second pane save failed:', error))
  }, [])

  useEffect(() => window.electronAPI.onBeforeClose(() => {
    void Promise.all([flushAutoSave(), flushSecondSave()])
      .then(() => window.electronAPI.confirmClose())
      .catch(error => {
        console.error('Could not close EasyMark because saving failed:', error)
        window.electronAPI.cancelClose()
      })
  }), [flushAutoSave, flushSecondSave])

  const handleContentChange = useCallback((content: string) => {
    if (!currentNote) return
    setCurrentNote(prev => prev ? { ...prev, content } : null)
    if (secondNote?.filename === currentNote.filename) {
      setSecondNote(prev => prev ? { ...prev, content } : null)
    }
    autoSave(content)
  }, [currentNote, secondNote?.filename, autoSave, setCurrentNote])

  const handleSecondContentChange = useCallback((content: string) => {
    setSecondNote(prev => prev ? { ...prev, content } : null)
    if (!secondNote) return
    if (currentNote?.filename === secondNote.filename) {
      setCurrentNote(prev => prev ? { ...prev, content } : null)
      autoSave(content)
      return
    }
    secondSaveQueueRef.current!.enqueue({ filename: secondNote.filename, content })
    setSecondSaveStatus({ state: 'saving' })
    if (secondSaveTimerRef.current) clearTimeout(secondSaveTimerRef.current)
    secondSaveTimerRef.current = setTimeout(() => {
      secondSaveTimerRef.current = undefined
      void flushSecondSave().catch(error => console.error('Scheduled second pane save failed:', error))
    }, 750)
  }, [secondNote, currentNote?.filename, autoSave, flushSecondSave, setCurrentNote])

  const handleSave = useCallback(async (content: string) => {
    await saveCurrentNote(content)
  }, [saveCurrentNote])

  const handleSecondSave = useCallback(async (content: string) => {
    if (!secondNote) return
    if (currentNote?.filename === secondNote.filename) {
      await flushAutoSave()
      return
    }
    secondSaveQueueRef.current!.enqueue({ filename: secondNote.filename, content })
    setSecondSaveStatus({ state: 'saving' })
    await flushSecondSave()
  }, [secondNote, currentNote?.filename, flushAutoSave, flushSecondSave])

  const handleSwapPanes = useCallback(async () => {
    if (!currentNote || !secondNote || currentNote.filename === secondNote.filename) return
    const requestId = ++secondOpenRequestRef.current
    const previousPrimary = { ...currentNote }
    const nextPrimary = allNotes.find(note => note.filename === secondNote.filename) ?? secondNote

    await Promise.all([flushAutoSave(), flushSecondSave()])
    if (requestId !== secondOpenRequestRef.current) return

    const openedNote = await openNote(nextPrimary)
    if (requestId !== secondOpenRequestRef.current || !openedNote) return

    setSecondNote(previousPrimary)
    setSecondSaveStatus({ state: 'saved', savedAt: Date.now() })
    setPrimaryFocusRequestId(id => id + 1)
  }, [allNotes, currentNote, secondNote, flushAutoSave, flushSecondSave, openNote])

  const handleSplitRight = useCallback(async () => {
    if (settings.dualPane || !currentNote) return
    const candidate = allNotes.find(note => note.filename !== currentNote.filename)
    if (!candidate) return

    const requestId = ++secondOpenRequestRef.current
    await Promise.all([flushAutoSave(), flushSecondSave()])
    if (requestId !== secondOpenRequestRef.current) return

    const content = await storage.readNote(candidate.filename)
    if (requestId !== secondOpenRequestRef.current || content === null) return

    setSecondNote({ ...candidate, content })
    setSecondSaveStatus({ state: 'saved', savedAt: Date.now() })
    setCompareSplit(DEFAULT_COMPARE_SPLIT)
    setDualPane(true)
    setSecondaryFocusRequestId(id => id + 1)
  }, [settings.dualPane, currentNote, allNotes, flushAutoSave, flushSecondSave, setDualPane])

  const handleDeleteNote = useCallback(async (filename: string) => {
    const requestId = ++secondOpenRequestRef.current
    await flushSecondSave()
    if (requestId !== secondOpenRequestRef.current) return { deleted: false }

    const deletedPrimary = settings.dualPane && currentNote?.filename === filename ? secondNote : null
    const result = await deleteNote(filename)
    if (!result.deleted || requestId !== secondOpenRequestRef.current) return result

    if (secondNote?.filename === filename) {
      setDualPane(false)
      setSecondNote(null)
      setSecondSaveStatus({ state: 'idle' })
      setCompareSplit(DEFAULT_COMPARE_SPLIT)
      setPrimaryFocusRequestId(id => id + 1)
    } else if (deletedPrimary) {
      const promoted = await openNote(deletedPrimary)
      if (requestId !== secondOpenRequestRef.current) return result
      setDualPane(false)
      setSecondNote(null)
      setSecondSaveStatus({ state: 'idle' })
      setCompareSplit(DEFAULT_COMPARE_SPLIT)
      if (promoted) setPrimaryFocusRequestId(id => id + 1)
    }
    return result
  }, [currentNote?.filename, deleteNote, flushSecondSave, openNote, secondNote, settings.dualPane, setDualPane])

  const handlePrimaryNoteSelect = useCallback(async (note: NoteSummary) => {
    if (currentNote?.filename === note.filename) {
      setPrimaryFocusRequestId(id => id + 1)
      return
    }
    if (settings.dualPane && secondNote?.filename === note.filename) {
      await handleSwapPanes()
      return
    }

    const requestId = ++secondOpenRequestRef.current
    await flushSecondSave()
    if (requestId !== secondOpenRequestRef.current) return
    const openedNote = await openNote(note)
    if (requestId === secondOpenRequestRef.current && openedNote) {
      setPrimaryFocusRequestId(id => id + 1)
    }
  }, [currentNote?.filename, settings.dualPane, secondNote?.filename, handleSwapPanes, flushSecondSave, openNote])

  const handleCreateNote = useCallback(async (title?: string) => {
    secondOpenRequestRef.current += 1
    await flushSecondSave()
    const note = await createNote(title)
    setPrimaryFocusRequestId(requestId => requestId + 1)
    return note
  }, [flushSecondSave, createNote])

  useEffect(() => {
    const handleGlobalShortcut = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Close the top-most app-level surface even while its lazy chunk is
        // still loading. This keeps a fast click-then-Escape interaction
        // reliable instead of leaving an invisible pending dialog behind.
        if (commandPaletteVisible) setCommandPaletteVisible(false)
        else if (settingsVisible) setSettingsVisible(false)
        else if (aiVisible) setAIVisible(false)
        else if (searchAllVisible) setSearchAllVisible(false)
        else if (historyTarget) setHistoryTarget(null)
        else if (exportVisible) setExportVisible(false)
        else if (gitPanelVisible) setGitPanelVisible(false)
        else if (readingModeActive) setReadingModeActive(false)
        else return
        event.preventDefault()
        return
      }

      if (!(event.ctrlKey || event.metaKey)) return
      if (event.key.toLowerCase() === 'n') {
        event.preventDefault()
        setSidebarCollapsed(false)
        setCreateRequestId(current => current + 1)
      }
      if (event.key.toLowerCase() === 'p') {
        event.preventDefault()
        setCommandPaletteVisible(true)
      }
    }
    window.addEventListener('keydown', handleGlobalShortcut)
    return () => window.removeEventListener('keydown', handleGlobalShortcut)
  }, [aiVisible, commandPaletteVisible, exportVisible, gitPanelVisible, historyTarget, readingModeActive, searchAllVisible, settingsVisible])

  const handleOpenNoteByFilename = useCallback(async (filename: string) => {
    const note = allNotes.find(item => item.filename === filename)
    if (note) await handlePrimaryNoteSelect(note)
  }, [allNotes, handlePrimaryNoteSelect])

  const handleShareNote = useCallback(async () => {
    if (!currentNote) return
    await flushAutoSave()
    await window.electronAPI.shareNote(currentNote.title, currentNote.content)
  }, [currentNote, flushAutoSave])

  const runAppCommand = useCallback((command: AppCommand | string) => {
    switch (command) {
      case 'new-note':
        setSidebarCollapsed(false)
        setCreateRequestId(current => current + 1)
        break
      case 'open-markdown':
        void chooseAndImportMarkdownFile()
          .then(note => { if (note) setPrimaryFocusRequestId(requestId => requestId + 1) })
          .catch(error => console.error('Failed to import Markdown:', error))
        break
      case 'search-all': setSearchAllVisible(true); break
      case 'toggle-ai': setAIInitialTab('complete'); setAIVisible(true); break
      case 'ask-notes': setAIInitialTab('knowledge'); setAIVisible(true); break
      case 'share-note': void handleShareNote().catch(error => console.error('Failed to share note:', error)); break
      case 'export-note': if (currentNote) { setSettingsVisible(false); setExportVisible(true) }; break
      case 'git-panel': setGitPanelVisible(true); break
      case 'toggle-pin': if (currentNote) togglePinned(currentNote.filename); break
      case 'toggle-favorite': if (currentNote) toggleFavorite(currentNote.filename); break
      case 'command-palette': setCommandPaletteVisible(true); break
    }
  }, [chooseAndImportMarkdownFile, currentNote, handleShareNote, toggleFavorite, togglePinned])

  useEffect(() => window.electronAPI.onMenuCommand(runAppCommand), [runAppCommand])

  useEffect(() => {
    const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.items || []).some(item => item.kind === 'file')
    const resetDragState = () => {
      dragDepthRef.current = 0
      setDropActive(false)
    }
    const handleDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      dragDepthRef.current += 1
      setDropActive(true)
    }
    const handleDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
      setDropActive(true)
    }
    const handleDragLeave = (event: DragEvent) => {
      if (dragDepthRef.current === 0) return
      if (!event.relatedTarget) {
        resetDragState()
        return
      }
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
      if (dragDepthRef.current === 0) setDropActive(false)
    }
    const handleDrop = (event: DragEvent) => {
      const fileDrag = dragDepthRef.current > 0 || hasFiles(event)
      if (!fileDrag) return
      event.preventDefault()
      resetDragState()
      const file = Array.from(event.dataTransfer?.files || []).find(item => item.name.toLocaleLowerCase().endsWith('.md'))
      if (!file) return
      let filePath = ''
      try { filePath = window.electronAPI.getPathForFile(file) } catch (error) { console.error('Could not resolve dropped Markdown path:', error) }
      if (!filePath) return
      void importMarkdownFile(filePath)
        .then(note => { if (note) setPrimaryFocusRequestId(requestId => requestId + 1) })
        .catch(error => console.error('Failed to import dropped Markdown:', error))
    }
    window.addEventListener('dragenter', handleDragEnter)
    window.addEventListener('dragover', handleDragOver)
    window.addEventListener('dragleave', handleDragLeave)
    window.addEventListener('drop', handleDrop)
    window.addEventListener('dragend', resetDragState)
    window.addEventListener('blur', resetDragState)
    return () => {
      window.removeEventListener('dragenter', handleDragEnter)
      window.removeEventListener('dragover', handleDragOver)
      window.removeEventListener('dragleave', handleDragLeave)
      window.removeEventListener('drop', handleDrop)
      window.removeEventListener('dragend', resetDragState)
      window.removeEventListener('blur', resetDragState)
      dragDepthRef.current = 0
    }
  }, [importMarkdownFile])

  const handleRenameNote = useCallback(async (oldFilename: string, newTitle: string) => {
    secondOpenRequestRef.current += 1
    await flushSecondSave()
    const result = await renameNote(oldFilename, newTitle)
    if (secondNote?.filename === oldFilename) {
      setSecondNote(prev => prev ? { ...prev, id: result.filename.slice(0, -3), filename: result.filename, title: result.title } : null)
    }
    return result
  }, [flushSecondSave, renameNote, secondNote])

  const handleClosePane = useCallback(() => {
    secondOpenRequestRef.current += 1
    void flushSecondSave().then(() => {
      setDualPane(false)
      setSecondNote(null)
      setSecondSaveStatus({ state: 'idle' })
      setCompareSplit(DEFAULT_COMPARE_SPLIT)
      setPrimaryFocusRequestId(id => id + 1)
    }).catch(error => console.error('Could not close note comparison because saving failed:', error))
  }, [flushSecondSave, setDualPane])

  const handleSecondNoteSelect = useCallback(async (filename: string) => {
    if (!currentNote || filename === currentNote.filename || filename === secondNote?.filename) return
    const requestId = ++secondOpenRequestRef.current
    await flushSecondSave()
    if (requestId !== secondOpenRequestRef.current) return
    const summary = allNotes.find(note => note.filename === filename)
    if (!summary) return
    const content = await storage.readNote(filename)
    if (requestId !== secondOpenRequestRef.current || content === null) return
    setSecondNote({ ...summary, content })
    setSecondaryFocusRequestId(id => id + 1)
    setSecondSaveStatus({ state: 'saved', savedAt: Date.now() })
  }, [allNotes, currentNote, secondNote?.filename, flushSecondSave])

  const updateCompareSplitFromPointer = useCallback((clientX: number) => {
    const bounds = compareContainerRef.current?.getBoundingClientRect()
    if (!bounds || bounds.width <= 0) return
    setCompareSplit(clampCompareSplit(((clientX - bounds.left) / bounds.width) * 100))
  }, [])

  const handleCompareDividerPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    comparePointerRef.current = event.pointerId
    event.currentTarget.setPointerCapture(event.pointerId)
    setCompareResizing(true)
    updateCompareSplitFromPointer(event.clientX)
    event.preventDefault()
  }, [updateCompareSplitFromPointer])

  const handleCompareDividerPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (comparePointerRef.current !== event.pointerId) return
    updateCompareSplitFromPointer(event.clientX)
  }, [updateCompareSplitFromPointer])

  const finishCompareResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (comparePointerRef.current !== event.pointerId) return
    comparePointerRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setCompareResizing(false)
  }, [])

  const handleCompareDividerKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 5 : 2
    if (event.key === 'ArrowLeft') setCompareSplit(value => clampCompareSplit(value - step))
    else if (event.key === 'ArrowRight') setCompareSplit(value => clampCompareSplit(value + step))
    else if (event.key === 'Home') setCompareSplit(MIN_COMPARE_SPLIT)
    else if (event.key === 'End') setCompareSplit(MAX_COMPARE_SPLIT)
    else if (event.key === 'Enter' || event.key === ' ') setCompareSplit(DEFAULT_COMPARE_SPLIT)
    else return
    event.preventDefault()
  }, [])

  const handleOpenHistory = useCallback(async (pane: 'primary' | 'secondary') => {
    const note = pane === 'primary' ? currentNote : secondNote
    if (!note) return
    if (pane === 'primary' || note.filename === currentNote?.filename) await flushAutoSave()
    else await flushSecondSave()
    setHistoryTarget({ pane, filename: note.filename, title: note.title })
  }, [currentNote, secondNote, flushAutoSave, flushSecondSave])

  const handleVersionRestored = useCallback((content: string) => {
    if (!historyTarget) return
    if (historyTarget.pane === 'primary' || historyTarget.filename === currentNote?.filename) {
      replaceCurrentNoteContent(historyTarget.filename, content)
    }
    if (secondNote?.filename === historyTarget.filename) {
      secondSaveQueueRef.current?.clearPending(historyTarget.filename)
      if (secondSaveTimerRef.current) {
        clearTimeout(secondSaveTimerRef.current)
        secondSaveTimerRef.current = undefined
      }
      setSecondNote(prev => prev ? { ...prev, content, lastModified: Date.now() } : null)
      setSecondSaveStatus({ state: 'saved', savedAt: Date.now() })
    }
  }, [historyTarget, currentNote?.filename, secondNote?.filename, replaceCurrentNoteContent])

  const handleOpenNoteFromSearch = useCallback(async (filename: string) => {
    const note = allNotes.find(n => n.filename === filename)
    if (note) {
      await handlePrimaryNoteSelect(note)
    }
    setSearchAllVisible(false)
  }, [allNotes, handlePrimaryNoteSelect])

  const handleReadingMode = useCallback(() => {
    if (currentNote) {
      setReadingModeActive(true)
    }
  }, [currentNote])

  const comparisonNotes = currentNote
    ? allNotes.filter(note => note.filename !== currentNote.filename)
    : []
  const canCompareNotes = comparisonNotes.length > 0

  return (
    <div className={`app platform-${window.electronAPI.platform} theme-${settings.theme} scheme-${settings.colorScheme}`}>
      <TitleBar
        onToggleTheme={() => setTheme(settings.theme === 'dark' ? 'light' : 'dark')}
        onOpenSettings={() => { setExportVisible(false); setSettingsVisible(true) }}
        onToggleAI={() => { setAIInitialTab('complete'); setAIVisible(prev => !prev) }}
      />
      <div className="app-body">
        <Sidebar
          notes={notes}
          totalNoteCount={allNotes.length}
          currentNote={currentNote}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onNoteSelect={note => { void handlePrimaryNoteSelect(note).catch(error => console.error('Failed to open note:', error)) }}
          onNoteCreate={async title => { await handleCreateNote(title) }}
          onNoteDelete={filename => handleDeleteNote(filename)}
          onNoteRename={(filename, title) => handleRenameNote(filename, title)}
          onTogglePinned={togglePinned}
          onToggleFavorite={toggleFavorite}
          loading={loading}
          loadError={listError}
          onRetryLoad={refreshList}
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(prev => !prev)}
          createRequestId={createRequestId}
        />
        <main className="app-main">
          {readingModeActive && currentNote ? (
            <Suspense fallback={<div className="app-loading" role="status">{locale === 'zh' ? '加载中…' : 'Loading…'}</div>}>
              <ReadingMode
                content={currentNote.content}
                title={currentNote.title}
                onClose={() => setReadingModeActive(false)}
                onEdit={() => setReadingModeActive(false)}
              />
            </Suspense>
          ) : settings.dualPane && currentNote && secondNote ? (
            <div
              ref={compareContainerRef}
              className={`dual-pane${compareResizing ? ' is-resizing' : ''}`}
              aria-label={t.editor.dualPane}
              data-split={Math.round(compareSplit)}
            >
              <div
                className="dual-pane-panel dual-pane-panel-primary"
                style={{ flexBasis: `calc(${compareSplit}% - 5px)` }}
              >
                <div className="dual-pane-header">
                  <div className="dual-pane-heading">
                    <span className="dual-pane-label">{t.editor.compareCurrent}</span>
                    <span className="dual-pane-title" title={currentNote.title}>{currentNote.title}</span>
                  </div>
                </div>
                <MarkdownEditor
                  noteId={currentNote.filename}
                  focusRequestId={primaryFocusRequestId}
                  content={currentNote.content}
                  onChange={handleContentChange}
                  onSave={handleSave}
                  dualPaneMode={true}
                  saveStatus={saveStatus}
                  onRetrySave={retrySave}
                  onOpenHistory={() => { void handleOpenHistory('primary').catch(error => console.error('Failed to open note history:', error)) }}
                />
              </div>
              <div
                className="dual-pane-divider"
                role="separator"
                aria-label={t.editor.resizeComparison}
                aria-orientation="vertical"
                aria-valuemin={MIN_COMPARE_SPLIT}
                aria-valuemax={MAX_COMPARE_SPLIT}
                aria-valuenow={Math.round(compareSplit)}
                tabIndex={0}
                title={t.editor.resizeComparisonHint}
                onPointerDown={handleCompareDividerPointerDown}
                onPointerMove={handleCompareDividerPointerMove}
                onPointerUp={finishCompareResize}
                onPointerCancel={finishCompareResize}
                onLostPointerCapture={() => { comparePointerRef.current = null; setCompareResizing(false) }}
                onDoubleClick={() => setCompareSplit(DEFAULT_COMPARE_SPLIT)}
                onKeyDown={handleCompareDividerKeyDown}
              >
                <span className="dual-pane-divider-grip" aria-hidden="true" />
              </div>
              <div className="dual-pane-panel dual-pane-panel-secondary">
                <div className="dual-pane-header dual-pane-header-secondary">
                  <div className="dual-pane-heading dual-pane-heading-select">
                    <label className="dual-pane-label" htmlFor="comparison-note-select">{t.editor.compareWith}</label>
                    <select
                      id="comparison-note-select"
                      className="dual-pane-select"
                      aria-label={t.editor.compareWith}
                      value={secondNote.filename}
                      onChange={e => { void handleSecondNoteSelect(e.target.value).catch(error => console.error('Failed to open comparison note:', error)) }}
                    >
                      {comparisonNotes.map(note => (
                        <option key={note.filename} value={note.filename}>{note.title}</option>
                      ))}
                    </select>
                  </div>
                  <div className="dual-pane-actions">
                    <button
                      type="button"
                      className="dual-pane-action"
                      onClick={() => { void handleSwapPanes().catch(error => console.error('Failed to swap comparison notes:', error)) }}
                      title={t.editor.swapPanes}
                      aria-label={t.editor.swapPanes}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M7 7h11l-3-3"/><path d="m18 7-3 3"/><path d="M17 17H6l3 3"/><path d="m6 17 3-3"/>
                      </svg>
                    </button>
                    <button type="button" className="dual-pane-action" onClick={handleClosePane} title={t.editor.closePane} aria-label={t.editor.closePane}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                      </svg>
                    </button>
                  </div>
                </div>
                <MarkdownEditor
                  noteId={secondNote.filename}
                  focusRequestId={secondaryFocusRequestId}
                  content={secondNote.content}
                  onChange={handleSecondContentChange}
                  onSave={handleSecondSave}
                  dualPaneMode={true}
                  saveStatus={secondSaveStatus}
                  onRetrySave={flushSecondSave}
                  onOpenHistory={() => { void handleOpenHistory('secondary').catch(error => console.error('Failed to open note history:', error)) }}
                />
              </div>
            </div>
          ) : currentNote ? (
            <div className="single-note-workspace">
              <MarkdownEditor
                noteId={currentNote.filename}
                focusRequestId={primaryFocusRequestId}
                content={currentNote.content}
                onChange={handleContentChange}
                onSave={handleSave}
                onSplitRight={() => { void handleSplitRight().catch(error => console.error('Failed to open note comparison:', error)) }}
                canSplitRight={canCompareNotes}
                onExport={() => { setSettingsVisible(false); setExportVisible(true) }}
                onSearchAll={() => setSearchAllVisible(true)}
                onReadingMode={settings.readingMode ? handleReadingMode : undefined}
                saveStatus={saveStatus}
                onRetrySave={retrySave}
                onOpenHistory={() => { void handleOpenHistory('primary').catch(error => console.error('Failed to open note history:', error)) }}
                onOpenWikiLink={title => {
                  const note = allNotes.find(item => item.title.toLocaleLowerCase() === title.toLocaleLowerCase())
                  if (note) void handlePrimaryNoteSelect(note)
                }}
                onShare={() => { void handleShareNote().catch(error => console.error('Failed to share note:', error)) }}
              />
              <Suspense fallback={<div className="surface-loading" role="status" aria-live="polite">{t.app.loadingSurface}</div>}>
                <BacklinksPanel title={currentNote.title} content={currentNote.content} notes={allNotes} onOpenNote={filename => { void handleOpenNoteByFilename(filename) }} />
              </Suspense>
            </div>
          ) : (
            <div className="app-welcome">
              <div className="app-welcome-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                  <path d="M8 7h8M8 11h6M8 15h4" />
                </svg>
              </div>
              <h1>{t.welcome.title}</h1>
              <p>{t.welcome.subtitle}</p>
              <button className="app-welcome-btn" onClick={() => { void handleCreateNote().catch(error => console.error('Failed to create note:', error)) }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                {t.welcome.newNote}
              </button>
            </div>
          )}
          {searchAllVisible && (
            <Suspense fallback={<div className="surface-loading" role="status" aria-live="polite">{t.app.loadingSurface}</div>}>
              <SearchPanel
                visible
                onClose={() => setSearchAllVisible(false)}
                onOpenNote={filename => { void handleOpenNoteFromSearch(filename).catch(error => console.error('Failed to open search result:', error)) }}
              />
            </Suspense>
          )}
        </main>
        {aiVisible && (
          <Suspense fallback={<div className="surface-loading" role="status" aria-live="polite">{t.app.loadingSurface}</div>}>
            <AIAssistant
              visible
              onClose={() => { setAIInitialTab('complete'); setAIVisible(false) }}
              noteContent={currentNote?.content || ''}
              onOpenNote={filename => { void handleOpenNoteByFilename(filename) }}
              initialTab={aiInitialTab}
            />
          </Suspense>
        )}
        {settingsVisible && (
          <Suspense fallback={<div className="surface-loading" role="status" aria-live="polite">{t.app.loadingSurface}</div>}>
            <SettingsDialog visible onClose={() => setSettingsVisible(false)} />
          </Suspense>
        )}
        {currentNote && exportVisible && (
          <Suspense fallback={<div className="surface-loading" role="status" aria-live="polite">{t.app.loadingSurface}</div>}>
            <ExportDialog
              visible
              onClose={() => setExportVisible(false)}
              content={currentNote.content}
              title={currentNote.title}
            />
          </Suspense>
        )}
        {historyTarget && (
          <Suspense fallback={<div className="surface-loading" role="status" aria-live="polite">{t.app.loadingSurface}</div>}>
            <VersionHistoryDialog
              visible
              filename={historyTarget.filename}
              title={historyTarget.title}
              onClose={() => setHistoryTarget(null)}
              onRestored={handleVersionRestored}
            />
          </Suspense>
        )}
        {commandPaletteVisible && (
          <Suspense fallback={<div className="surface-loading" role="status" aria-live="polite">{t.app.loadingSurface}</div>}>
            <CommandPalette
              visible
              notes={allNotes}
              onClose={() => setCommandPaletteVisible(false)}
              onOpenNote={note => { void handlePrimaryNoteSelect(note) }}
              onCommand={runAppCommand}
            />
          </Suspense>
        )}
        {gitPanelVisible && (
          <Suspense fallback={<div className="surface-loading" role="status" aria-live="polite">{t.app.loadingSurface}</div>}>
            <GitPanel visible onClose={() => setGitPanelVisible(false)} />
          </Suspense>
        )}
        {dropActive && <div className="markdown-drop-overlay"><strong>{t.editor.placeholder}</strong><span>{locale === 'zh' ? '拖放 .md 文件以导入并查看' : 'Drop a .md file to import and view'}</span></div>}
      </div>
    </div>
  )
}

export function App() {
  return (
    <I18nProvider>
      <SettingsProvider>
        <ErrorBoundary><AppContent /></ErrorBoundary>
      </SettingsProvider>
    </I18nProvider>
  )
}
