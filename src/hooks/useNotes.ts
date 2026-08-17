import { useState, useEffect, useCallback, useRef } from 'react'
import { Note, NoteSummary, SaveStatus } from '../types'
import * as storage from '../services/storage'
import { LatestSaveQueue } from '../services/latestSaveQueue'
import type { SaveSnapshot } from '../services/latestSaveQueue'
import { decorateNotes, removeNoteMetadata, renameNoteMetadata, updateNoteMetadata } from '../services/noteMetadata'

const savedStatus = (): SaveStatus => ({ state: 'saved', savedAt: Date.now() })

function errorMessage(error: unknown, fallback = 'Could not save note'): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export function useNotes() {
  const [notes, setNotes] = useState<NoteSummary[]>([])
  const [currentNote, setCurrentNote] = useState<Note | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ state: 'idle' })
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState('')
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const currentNoteRef = useRef<Note | null>(null)
  const saveQueueRef = useRef<LatestSaveQueue | null>(null)
  const openRequestRef = useRef(0)
  const listRequestRef = useRef(0)
  currentNoteRef.current = currentNote

  if (!saveQueueRef.current) {
    saveQueueRef.current = new LatestSaveQueue(
      snapshot => storage.saveNote(snapshot.filename, snapshot.content),
      {
        onSaving: () => setSaveStatus({ state: 'saving' }),
        onSaved: (snapshot, hasPending) => {
          setSaveStatus(hasPending ? { state: 'saving' } : savedStatus())
          setCurrentNote(prev => prev?.filename === snapshot.filename && prev.content === snapshot.content
            ? { ...prev, lastModified: Date.now() }
            : prev)
        },
        onError: error => {
          setSaveStatus({ state: 'error', error: errorMessage(error) })
          console.error('Auto-save failed:', error)
        },
      },
    )
  }

  const refreshList = useCallback(async () => {
    const requestId = ++listRequestRef.current
    setLoading(true)
    setListError('')
    try {
      const list = decorateNotes(await storage.listNotes())
      if (requestId === listRequestRef.current) setNotes(list)
      return list
    } catch (error) {
      if (requestId === listRequestRef.current) {
        setListError(errorMessage(error, 'Could not load notes'))
      }
      throw error
    } finally {
      if (requestId === listRequestRef.current) setLoading(false)
    }
  }, [])

  const refreshAfterMutation = useCallback(async () => {
    try {
      await refreshList()
    } catch (error) {
      // The filesystem mutation already succeeded. Keep the optimistic UI
      // state and expose the refresh failure for the existing retry action; a
      // failed directory listing must not make create/rename/delete look like
      // failed operations to their callers.
      console.error('Failed to refresh notes after mutation:', error)
    }
  }, [refreshList])

  const flushAutoSave = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = undefined
    }
    return saveQueueRef.current!.flush()
  }, [])

  useEffect(() => {
    refreshList().catch(error => console.error('Failed to load notes:', error))
  }, [refreshList])

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    void saveQueueRef.current?.flush().catch(error => console.error('Final auto-save failed:', error))
  }, [])

  const openNote = useCallback(async (note: NoteSummary): Promise<Note | null> => {
    const requestId = ++openRequestRef.current
    await flushAutoSave()
    if (requestId !== openRequestRef.current) return null
    const content = await storage.readNote(note.filename)
    if (requestId !== openRequestRef.current) return null
    const metadata = updateNoteMetadata(note.filename, { lastOpened: Date.now() })
    const openedNote = content === null ? null : { ...note, ...metadata, content }
    setCurrentNote(openedNote)
    setNotes(prev => decorateNotes(prev.map(item => item.filename === note.filename ? { ...item, ...metadata } : item)))
    setSaveStatus(openedNote === null ? { state: 'idle' } : savedStatus())
    return openedNote
  }, [flushAutoSave])

  const createNote = useCallback(async (title?: string) => {
    const requestId = ++openRequestRef.current
    await flushAutoSave()
    const result = await storage.createNote(title || 'untitled')
    const note: Note = {
      id: result.filename.slice(0, -3),
      title: result.title,
      filename: result.filename,
      lastModified: Date.now(),
      content: result.content,
    }
    if (requestId === openRequestRef.current) {
      const metadata = updateNoteMetadata(note.filename, { lastOpened: Date.now() })
      const decorated = { ...note, ...metadata }
      setCurrentNote(decorated)
      setNotes(prev => decorateNotes([decorated, ...prev.filter(item => item.filename !== note.filename)]))
      setSaveStatus(savedStatus())
    }
    await refreshAfterMutation()
    return note
  }, [flushAutoSave, refreshAfterMutation])

  const deleteNote = useCallback(async (filename: string) => {
    const requestId = ++openRequestRef.current
    await flushAutoSave()
    const result = await storage.deleteNote(filename)
    if (result.deleted) {
      removeNoteMetadata(filename)
      setNotes(prev => prev.filter(item => item.filename !== filename))
    }
    if (requestId === openRequestRef.current && currentNoteRef.current?.filename === filename) {
      setCurrentNote(null)
      setSaveStatus({ state: 'idle' })
    }
    await refreshAfterMutation()
    return result
  }, [flushAutoSave, refreshAfterMutation])

  const saveCurrentNote = useCallback(async (content: string) => {
    const note = currentNoteRef.current
    if (!note) return
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = undefined
    }
    const pending: SaveSnapshot = { filename: note.filename, content }
    saveQueueRef.current!.enqueue(pending)
    setSaveStatus({ state: 'saving' })
    await saveQueueRef.current!.flush()
  }, [])

  const autoSave = useCallback((content: string) => {
    const note = currentNoteRef.current
    if (!note) return
    saveQueueRef.current!.enqueue({ filename: note.filename, content })
    setSaveStatus({ state: 'saving' })
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = undefined
      void flushAutoSave().catch(error => console.error('Scheduled auto-save failed:', error))
    }, 750)
  }, [flushAutoSave])

  const retrySave = useCallback(async () => {
    await flushAutoSave()
  }, [flushAutoSave])

  const replaceCurrentNoteContent = useCallback((filename: string, content: string) => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = undefined
    }
    saveQueueRef.current?.clearPending(filename)
    setCurrentNote(prev => prev?.filename === filename
      ? { ...prev, content, lastModified: Date.now() }
      : prev)
    setSaveStatus(savedStatus())
  }, [])

  const renameNote = useCallback(async (oldFilename: string, newTitle: string) => {
    const requestId = ++openRequestRef.current
    await flushAutoSave()
    const result = await storage.renameNote(oldFilename, newTitle)
    renameNoteMetadata(oldFilename, result.filename)
    setNotes(prev => decorateNotes(prev.map(item => item.filename === oldFilename
      ? { ...item, id: result.filename.slice(0, -3), filename: result.filename, title: result.title }
      : item)))
    if (requestId === openRequestRef.current && currentNoteRef.current?.filename === oldFilename) {
      setCurrentNote(prev => prev ? {
        ...prev,
        id: result.filename.slice(0, -3),
        filename: result.filename,
        title: result.title,
      } : null)
    }
    await refreshAfterMutation()
    return result
  }, [flushAutoSave, refreshAfterMutation])

  const adoptImportedNote = useCallback(async (result: { filename: string; title: string; content: string } | null) => {
    if (!result) return null
    const requestId = ++openRequestRef.current
    await flushAutoSave()
    const metadata = updateNoteMetadata(result.filename, { lastOpened: Date.now() })
    const note: Note = {
      id: result.filename.slice(0, -3),
      title: result.title,
      filename: result.filename,
      lastModified: Date.now(),
      content: result.content,
      ...metadata,
    }
    if (requestId === openRequestRef.current) {
      setCurrentNote(note)
      setNotes(prev => decorateNotes([note, ...prev.filter(item => item.filename !== note.filename)]))
      setSaveStatus(savedStatus())
    }
    await refreshAfterMutation()
    return note
  }, [flushAutoSave, refreshAfterMutation])

  const importMarkdownFile = useCallback(async (filePath: string) => {
    return adoptImportedNote(await storage.importMarkdownFile(filePath))
  }, [adoptImportedNote])

  const chooseAndImportMarkdownFile = useCallback(async () => {
    return adoptImportedNote(await storage.chooseAndImportMarkdownFile())
  }, [adoptImportedNote])

  const filteredNotes = notes.filter(note => note.title.toLocaleLowerCase().includes(searchQuery.toLocaleLowerCase()))

  const updateMetadata = useCallback((filename: string, patch: { pinned?: boolean; favorite?: boolean }) => {
    const metadata = updateNoteMetadata(filename, patch)
    setNotes(prev => decorateNotes(prev.map(note => note.filename === filename ? { ...note, ...metadata } : note)))
    setCurrentNote(prev => prev?.filename === filename ? { ...prev, ...metadata } : prev)
  }, [])

  const togglePinned = useCallback((filename: string) => {
    const note = notes.find(item => item.filename === filename)
    updateMetadata(filename, { pinned: !note?.pinned })
  }, [notes, updateMetadata])

  const toggleFavorite = useCallback((filename: string) => {
    const note = notes.find(item => item.filename === filename)
    updateMetadata(filename, { favorite: !note?.favorite })
  }, [notes, updateMetadata])

  return {
    notes: filteredNotes,
    allNotes: notes,
    currentNote,
    saveStatus,
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
    importMarkdownFile,
    chooseAndImportMarkdownFile,
    togglePinned,
    toggleFavorite,
    refreshList,
    setCurrentNote,
    replaceCurrentNoteContent,
    flushAutoSave,
  }
}
