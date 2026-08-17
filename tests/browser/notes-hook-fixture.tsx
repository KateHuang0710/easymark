import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useNotes } from '../../src/hooks/useNotes'
import type { ElectronAPI, NoteSummary } from '../../src/types'

let files: NoteSummary[] = [{ id: 'body', title: 'Body', filename: 'body.md', lastModified: 1 }]
let listCalls = 0

const api: Partial<ElectronAPI> = {
  platform: 'darwin',
  listNotes: async () => {
    listCalls += 1
    if (listCalls > 1) throw new Error('simulated refresh failure')
    return files.map(note => ({ ...note }))
  },
  readNote: async () => 'Body',
  saveNote: async () => true,
  createNote: async title => {
    const note = { filename: `${title.toLowerCase()}.md`, title, content: '' }
    files = [...files, { id: title.toLowerCase(), title, filename: note.filename, lastModified: Date.now() }]
    return note
  },
  deleteNote: async filename => {
    files = files.filter(note => note.filename !== filename)
    return { deleted: true }
  },
  renameNote: async (_oldFilename, newTitle) => {
    const filename = `${newTitle.toLowerCase()}.md`
    files = files.map(note => note.filename === 'body.md'
      ? { ...note, id: newTitle.toLowerCase(), title: newTitle, filename }
      : note)
    return { filename, title: newTitle }
  },
}

;(window as unknown as { electronAPI: ElectronAPI }).electronAPI = api as ElectronAPI

function Fixture() {
  const { allNotes, loading, listError, createNote, deleteNote, renameNote } = useNotes()
  const [result, setResult] = useState('idle')
  const run = async (action: () => Promise<unknown>) => {
    setResult('pending')
    try { await action(); setResult('success') } catch { setResult('failed') }
  }
  return <>
    <div data-testid="loading">{String(loading)}</div>
    <div data-testid="result">{result}</div>
    <div data-testid="list-error">{listError}</div>
    <ul>{allNotes.map(note => <li key={note.filename}>{note.title}</li>)}</ul>
    <button onClick={() => void run(() => createNote('Created'))}>create</button>
    <button onClick={() => void run(() => renameNote('body.md', 'Renamed'))}>rename</button>
    <button onClick={() => void run(() => deleteNote('body.md'))}>delete</button>
  </>
}

createRoot(document.querySelector('#root')!).render(<Fixture />)
