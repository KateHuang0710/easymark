import { useState, useEffect, useCallback, useRef } from 'react'
import { Note, NoteSummary, SaveStatus } from '../types'
import * as storage from '../services/storage'
import { LatestSaveQueue } from '../services/latestSaveQueue'
import type { SaveSnapshot } from '../services/latestSaveQueue'

const savedStatus = (): SaveStatus => ({ state: 'saved', savedAt: Date.now() })

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Could not save note'
}

export function useNotes() {
  const [notes, setNotes] = useState<NoteSummary[]>([])
  const [currentNote, setCurrentNote] = useState<Note | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ state: 'idle' })
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const currentNoteRef = useRef<Note | null>(null)
  const saveQueueRef = useRef<LatestSaveQueue | null>(null)
  const openRequestRef = useRef(0)
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
    const list = await storage.listNotes()
    setNotes(list)
    return list
  }, [])

  const flushAutoSave = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = undefined
    }
    return saveQueueRef.current!.flush()
  }, [])

  useEffect(() => {
    refreshList().catch(error => console.error('Failed to load notes:', error)).finally(() => setLoading(false))
  }, [refreshList])

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    void saveQueueRef.current?.flush().catch(error => console.error('Final auto-save failed:', error))
  }, [])

  const openNote = useCallback(async (note: NoteSummary) => {
    const requestId = ++openRequestRef.current
    await flushAutoSave()
    if (requestId !== openRequestRef.current) return
    const content = await storage.readNote(note.filename)
    if (requestId !== openRequestRef.current) return
    setCurrentNote(content === null ? null : { ...note, content })
    setSaveStatus(content === null ? { state: 'idle' } : savedStatus())
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
      setCurrentNote(note)
      setSaveStatus(savedStatus())
    }
    await refreshList()
    return note
  }, [flushAutoSave, refreshList])

  const deleteNote = useCallback(async (filename: string) => {
    const requestId = ++openRequestRef.current
    await flushAutoSave()
    await storage.deleteNote(filename)
    if (requestId === openRequestRef.current && currentNoteRef.current?.filename === filename) {
      setCurrentNote(null)
      setSaveStatus({ state: 'idle' })
    }
    await refreshList()
  }, [flushAutoSave, refreshList])

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
    if (requestId === openRequestRef.current && currentNoteRef.current?.filename === oldFilename) {
      setCurrentNote(prev => prev ? {
        ...prev,
        id: result.filename.slice(0, -3),
        filename: result.filename,
        title: result.title,
      } : null)
    }
    await refreshList()
    return result
  }, [flushAutoSave, refreshList])

  const filteredNotes = notes.filter(note => note.title.toLocaleLowerCase().includes(searchQuery.toLocaleLowerCase()))

  return {
    notes: filteredNotes,
    allNotes: notes,
    currentNote,
    saveStatus,
    loading,
    searchQuery,
    setSearchQuery,
    openNote,
    createNote,
    deleteNote,
    saveCurrentNote,
    autoSave,
    retrySave,
    renameNote,
    refreshList,
    setCurrentNote,
    replaceCurrentNoteContent,
    flushAutoSave,
  }
}
