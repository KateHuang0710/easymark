import { NoteSummary } from '../types'

export interface NoteMetadata {
  pinned?: boolean
  favorite?: boolean
  lastOpened?: number
}

const STORAGE_KEY = 'easymark-note-metadata-v1'

function readAll(): Record<string, NoteMetadata> {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function writeAll(metadata: Record<string, NoteMetadata>): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(metadata)) } catch {}
}

export function decorateNotes(notes: NoteSummary[]): NoteSummary[] {
  const metadata = readAll()
  return notes.map(note => ({ ...note, ...metadata[note.filename] })).sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1
    if (Boolean(a.favorite) !== Boolean(b.favorite)) return a.favorite ? -1 : 1
    return b.lastModified - a.lastModified
  })
}

export function updateNoteMetadata(filename: string, patch: NoteMetadata): NoteMetadata {
  const all = readAll()
  const next = { ...(all[filename] || {}), ...patch }
  all[filename] = next
  writeAll(all)
  return next
}

export function removeNoteMetadata(filename: string): void {
  const all = readAll()
  delete all[filename]
  writeAll(all)
}

export function renameNoteMetadata(oldFilename: string, newFilename: string): void {
  if (oldFilename === newFilename) return
  const all = readAll()
  if (all[oldFilename]) all[newFilename] = { ...(all[newFilename] || {}), ...all[oldFilename] }
  delete all[oldFilename]
  writeAll(all)
}
