import { useState, useEffect, useCallback, useRef } from 'react'
import { Note, NoteSummary } from '../types'
import * as storage from '../services/storage'

interface PendingSave {
  filename: string
  content: string
}

export function useNotes() {
  const [notes, setNotes] = useState<NoteSummary[]>([])
  const [currentNote, setCurrentNote] = useState<Note | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const currentNoteRef = useRef<Note | null>(null)
  const pendingSaveRef = useRef<PendingSave | null>(null)
  const openRequestRef = useRef(0)
  currentNoteRef.current = currentNote

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
    const pending = pendingSaveRef.current
    if (!pending) return
    pendingSaveRef.current = null
    try {
      await storage.saveNote(pending.filename, pending.content)
    } catch (error) {
      if (!pendingSaveRef.current) pendingSaveRef.current = pending
      console.error('Auto-save failed:', error)
      throw error
    }
  }, [])

  useEffect(() => {
    refreshList().catch(error => console.error('Failed to load notes:', error)).finally(() => setLoading(false))
  }, [refreshList])

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    const pending = pendingSaveRef.current
    if (pending) void storage.saveNote(pending.filename, pending.content).catch(error => console.error('Final auto-save failed:', error))
  }, [])

  const openNote = useCallback(async (note: NoteSummary) => {
    const requestId = ++openRequestRef.current
    await flushAutoSave()
    if (requestId !== openRequestRef.current) return
    const content = await storage.readNote(note.filename)
    if (requestId !== openRequestRef.current) return
    setCurrentNote(content === null ? null : { ...note, content })
  }, [flushAutoSave])

  const createNote = useCallback(async (title?: string) => {
    await flushAutoSave()
    const result = await storage.createNote(title || 'untitled')
    const note: Note = {
      id: result.filename.slice(0, -3),
      title: result.title,
      filename: result.filename,
      lastModified: Date.now(),
      content: result.content,
    }
    setCurrentNote(note)
    await refreshList()
    return note
  }, [flushAutoSave, refreshList])

  const deleteNote = useCallback(async (filename: string) => {
    await flushAutoSave()
    await storage.deleteNote(filename)
    if (currentNoteRef.current?.filename === filename) setCurrentNote(null)
    await refreshList()
  }, [flushAutoSave, refreshList])

  const saveCurrentNote = useCallback(async (content: string) => {
    const note = currentNoteRef.current
    if (!note) return
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = undefined
    }
    // Keep the newest requested content pending until this particular write succeeds.
    // This avoids a slower manual save overwriting a later keystroke.
    const pending: PendingSave = { filename: note.filename, content }
    pendingSaveRef.current = pending
    try {
      await storage.saveNote(pending.filename, pending.content)
      if (pendingSaveRef.current === pending) pendingSaveRef.current = null
      setCurrentNote(prev => prev?.filename === pending.filename && prev.content === pending.content
        ? { ...prev, lastModified: Date.now() }
        : prev)
    } catch (error) {
      console.error('Manual save failed:', error)
      throw error
    }
  }, [])

  const autoSave = useCallback((content: string) => {
    const note = currentNoteRef.current
    if (!note) return
    pendingSaveRef.current = { filename: note.filename, content }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = undefined
      void flushAutoSave().catch(error => console.error('Scheduled auto-save failed:', error))
    }, 750)
  }, [flushAutoSave])

  const renameNote = useCallback(async (oldFilename: string, newTitle: string) => {
    await flushAutoSave()
    const result = await storage.renameNote(oldFilename, newTitle)
    if (currentNoteRef.current?.filename === oldFilename) {
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
    loading,
    searchQuery,
    setSearchQuery,
    openNote,
    createNote,
    deleteNote,
    saveCurrentNote,
    autoSave,
    renameNote,
    refreshList,
    setCurrentNote,
    flushAutoSave,
  }
}
