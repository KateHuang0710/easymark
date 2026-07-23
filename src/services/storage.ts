import { DeleteNoteResult, NoteSummary, NoteVersion, RenameNoteResult } from '../types'

const api = () => window.electronAPI

export const listNotes = (): Promise<NoteSummary[]> => api().listNotes()
export const readNote = (filename: string): Promise<string | null> => api().readNote(filename)
export const saveNote = (filename: string, content: string): Promise<boolean> => api().saveNote(filename, content)
export const listNoteVersions = (filename: string): Promise<NoteVersion[]> => api().listNoteVersions(filename)
export const readNoteVersion = (filename: string, versionId: string): Promise<string> => api().readNoteVersion(filename, versionId)
export const restoreNoteVersion = (filename: string, versionId: string): Promise<string> => api().restoreNoteVersion(filename, versionId)
export const createNote = (title: string): Promise<{ filename: string; title: string; content: string }> => api().createNote(title)
export const deleteNote = (filename: string): Promise<DeleteNoteResult> => api().deleteNote(filename)
export const renameNote = (oldFilename: string, newTitle: string): Promise<RenameNoteResult> => api().renameNote(oldFilename, newTitle)
