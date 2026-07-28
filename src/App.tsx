import React, { useState, useCallback, useEffect, useRef } from 'react'
import { I18nProvider, useTranslation } from './i18n'
import { SettingsProvider, useSettings } from './contexts/SettingsContext'
import { TitleBar } from './components/TitleBar'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Sidebar } from './components/Sidebar'
import { MarkdownEditor } from './components/Editor/MarkdownEditor'
import { AIAssistant } from './components/AIAssistant'
import { SettingsDialog } from './components/SettingsDialog'
import { ReadingMode } from './components/Editor/ReadingMode'
import { ExportDialog } from './components/Editor/ExportDialog'
import { VersionHistoryDialog } from './components/Editor/VersionHistoryDialog'
import { SearchPanel } from './components/Editor/SearchPanel'
import { useNotes } from './hooks/useNotes'
import { Note, NoteSummary, SaveStatus } from './types'
import * as storage from './services/storage'
import { LatestSaveQueue } from './services/latestSaveQueue'
import { CommandPalette, AppCommand } from './components/CommandPalette'
import { BacklinksPanel } from './components/BacklinksPanel'
import { GitPanel } from './components/GitPanel'

function saveErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Could not save note'
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
  const [historyTarget, setHistoryTarget] = useState<{ pane: 'primary' | 'secondary'; filename: string; title: string } | null>(null)
  const [createRequestId, setCreateRequestId] = useState(0)
  const [commandPaletteVisible, setCommandPaletteVisible] = useState(false)
  const [gitPanelVisible, setGitPanelVisible] = useState(false)
  const [dropActive, setDropActive] = useState(false)
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

  const handleSplitRight = useCallback(() => {
    if (!settings.dualPane && currentNote) {
      secondOpenRequestRef.current += 1
      // Use in-memory content (currentNote.content) which is always up-to-date,
      // not disk content which may be stale due to auto-save debounce (1s).
      setSecondNote({ ...currentNote })
      setSecondSaveStatus(saveStatus)
      setDualPane(true)
    }
  }, [settings.dualPane, currentNote, saveStatus, setDualPane])

  const handleDeleteNote = useCallback(async (filename: string) => {
    secondOpenRequestRef.current += 1
    await flushSecondSave()
    const result = await deleteNote(filename)
    if (secondNote?.filename === filename) {
      setSecondNote(null)
      setSecondSaveStatus({ state: 'idle' })
    }
    return result
  }, [deleteNote, flushSecondSave, secondNote])

  const handlePrimaryNoteSelect = useCallback(async (note: NoteSummary) => {
    await flushSecondSave()
    await openNote(note)
  }, [flushSecondSave, openNote])

  const handleCreateNote = useCallback(async (title?: string) => {
    secondOpenRequestRef.current += 1
    await flushSecondSave()
    return createNote(title)
  }, [flushSecondSave, createNote])

  useEffect(() => {
    const handleGlobalShortcut = (event: KeyboardEvent) => {
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
  }, [])

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
        void chooseAndImportMarkdownFile().catch(error => console.error('Failed to import Markdown:', error))
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
    const handleDragOver = (event: DragEvent) => {
      if (!Array.from(event.dataTransfer?.items || []).some(item => item.kind === 'file')) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
      setDropActive(true)
    }
    const handleDragLeave = (event: DragEvent) => {
      if (!event.relatedTarget) setDropActive(false)
    }
    const handleDrop = (event: DragEvent) => {
      event.preventDefault()
      setDropActive(false)
      const file = Array.from(event.dataTransfer?.files || []).find(item => item.name.toLocaleLowerCase().endsWith('.md'))
      if (!file) return
      let filePath = ''
      try { filePath = window.electronAPI.getPathForFile(file) } catch (error) { console.error('Could not resolve dropped Markdown path:', error) }
      if (!filePath) return
      void importMarkdownFile(filePath).catch(error => console.error('Failed to import dropped Markdown:', error))
    }
    window.addEventListener('dragover', handleDragOver)
    window.addEventListener('dragleave', handleDragLeave)
    window.addEventListener('drop', handleDrop)
    return () => {
      window.removeEventListener('dragover', handleDragOver)
      window.removeEventListener('dragleave', handleDragLeave)
      window.removeEventListener('drop', handleDrop)
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
    }).catch(error => console.error('Could not close second pane because saving failed:', error))
  }, [flushSecondSave, setDualPane])

  const handleSecondNoteSelect = useCallback(async (filename: string) => {
    const requestId = ++secondOpenRequestRef.current
    await flushSecondSave()
    if (requestId !== secondOpenRequestRef.current) return
    const summary = allNotes.find(note => note.filename === filename)
    if (!summary) return
    if (currentNote?.filename === filename) {
      setSecondNote({ ...currentNote })
      setSecondSaveStatus(saveStatus)
      return
    }
    const content = await storage.readNote(filename)
    if (requestId !== secondOpenRequestRef.current) return
    if (content !== null) {
      setSecondNote({ ...summary, content })
      setSecondSaveStatus({ state: 'saved', savedAt: Date.now() })
    }
  }, [allNotes, currentNote, flushSecondSave, saveStatus])

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
            <ReadingMode
              content={currentNote.content}
              title={currentNote.title}
              onClose={() => setReadingModeActive(false)}
              onEdit={() => setReadingModeActive(false)}
            />
          ) : settings.dualPane && currentNote && secondNote ? (
            <div className="dual-pane">
              <div className="dual-pane-panel">
                <div className="dual-pane-header">
                  <span className="dual-pane-title">{currentNote.title}</span>
                  <button className="dual-pane-close" onClick={handleClosePane} title={t.editor.closePane}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                </div>
                <MarkdownEditor
                  content={currentNote.content}
                  onChange={handleContentChange}
                  onSave={handleSave}
                  dualPaneMode={true}
                  saveStatus={saveStatus}
                  onRetrySave={retrySave}
                  onOpenHistory={() => { void handleOpenHistory('primary').catch(error => console.error('Failed to open note history:', error)) }}
                />
              </div>
              <div className="dual-pane-divider" />
              <div className="dual-pane-panel">
                <div className="dual-pane-header">
                  <select
                    className="dual-pane-select"
                    value={secondNote.filename}
                    onChange={e => { void handleSecondNoteSelect(e.target.value).catch(error => console.error('Failed to open second pane note:', error)) }}
                  >
                    {allNotes.map(n => (
                      <option key={n.filename} value={n.filename}>{n.title}</option>
                    ))}
                  </select>
                </div>
                <MarkdownEditor
                  content={secondNote.content}
                  onChange={handleSecondContentChange}
                  onSave={handleSecondSave}
                  dualPaneMode={true}
                  saveStatus={secondNote.filename === currentNote.filename ? saveStatus : secondSaveStatus}
                  onRetrySave={secondNote.filename === currentNote.filename ? retrySave : flushSecondSave}
                  onOpenHistory={() => { void handleOpenHistory('secondary').catch(error => console.error('Failed to open note history:', error)) }}
                />
              </div>
            </div>
          ) : currentNote ? (
            <div className="single-note-workspace">
              <MarkdownEditor
                content={currentNote.content}
                onChange={handleContentChange}
                onSave={handleSave}
                onSplitRight={handleSplitRight}
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
              <BacklinksPanel title={currentNote.title} content={currentNote.content} notes={allNotes} onOpenNote={filename => { void handleOpenNoteByFilename(filename) }} />
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
          <SearchPanel
            visible={searchAllVisible}
            onClose={() => setSearchAllVisible(false)}
            onOpenNote={filename => { void handleOpenNoteFromSearch(filename).catch(error => console.error('Failed to open search result:', error)) }}
          />
        </main>
        <AIAssistant
          visible={aiVisible}
          onClose={() => { setAIInitialTab('complete'); setAIVisible(false) }}
          noteContent={currentNote?.content || ''}
          onOpenNote={filename => { void handleOpenNoteByFilename(filename) }}
          initialTab={aiInitialTab}
        />
        <SettingsDialog
          visible={settingsVisible}
          onClose={() => setSettingsVisible(false)}
        />
        {currentNote && (
          <ExportDialog
            visible={exportVisible}
            onClose={() => setExportVisible(false)}
            content={currentNote.content}
            title={currentNote.title}
          />
        )}
        <VersionHistoryDialog
          visible={Boolean(historyTarget)}
          filename={historyTarget?.filename || null}
          title={historyTarget?.title || ''}
          onClose={() => setHistoryTarget(null)}
          onRestored={handleVersionRestored}
        />
        <CommandPalette
          visible={commandPaletteVisible}
          notes={allNotes}
          onClose={() => setCommandPaletteVisible(false)}
          onOpenNote={note => { void handlePrimaryNoteSelect(note) }}
          onCommand={runAppCommand}
        />
        <GitPanel visible={gitPanelVisible} onClose={() => setGitPanelVisible(false)} />
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
