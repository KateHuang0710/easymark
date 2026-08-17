import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider } from '../../src/i18n'
import { Sidebar } from '../../src/components/Sidebar'
import type { Note, NoteSummary } from '../../src/types'
import '../../src/styles/global.css'
import '../../src/styles/ui-polish.css'

localStorage.setItem('easymark-locale', 'zh')
window.confirm = () => true

const initialNotes: NoteSummary[] = [
  { id: 'project', title: 'Project Plan', filename: 'project.md', lastModified: Date.now() - 60_000, lastOpened: Date.now() - 10_000, pinned: true },
  { id: 'ideas', title: 'Ideas', filename: 'ideas.md', lastModified: Date.now() - 86_400_000, lastOpened: Date.now() - 20_000, favorite: true },
  { id: 'meeting', title: 'Meeting Notes', filename: 'meeting.md', lastModified: Date.now() - 172_800_000 },
  { id: 'archive', title: 'Archived Draft', filename: 'archive.md', lastModified: Date.now() - 259_200_000 },
]

function Fixture() {
  const [notes, setNotes] = useState(initialNotes)
  const [query, setQuery] = useState('')
  const [currentNote, setCurrentNote] = useState<Note | null>(null)
  const [deleteCalls, setDeleteCalls] = useState(0)
  const [collapsed, setCollapsed] = useState(false)
  const filteredNotes = notes.filter(note => note.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()))

  const updateNote = (filename: string, patch: Partial<NoteSummary>) => {
    setNotes(previous => previous.map(note => note.filename === filename ? { ...note, ...patch } : note))
  }

  return (
    <I18nProvider>
      <span data-testid="delete-count" hidden>{deleteCalls}</span>
      <Sidebar
        notes={filteredNotes}
        totalNoteCount={notes.length}
        currentNote={currentNote}
        searchQuery={query}
        onSearchChange={setQuery}
        onNoteSelect={note => setCurrentNote({ ...note, content: '' })}
        onNoteCreate={async title => {
          const id = title!.toLowerCase().replace(/\s+/g, '-')
          const note = { id, title: title!, filename: `${id}.md`, lastModified: Date.now() }
          setNotes(previous => [note, ...previous])
        }}
        onNoteDelete={async filename => {
          setDeleteCalls(count => count + 1)
          await new Promise(resolve => setTimeout(resolve, 750))
          setNotes(previous => previous.filter(note => note.filename !== filename))
        }}
        onNoteRename={async (filename, title) => {
          const nextFilename = `${title.toLowerCase().replace(/\s+/g, '-')}.md`
          setNotes(previous => previous.map(note => note.filename === filename ? { ...note, id: nextFilename.slice(0, -3), filename: nextFilename, title } : note))
          return { filename: nextFilename, title }
        }}
        onTogglePinned={filename => {
          const note = notes.find(item => item.filename === filename)
          updateNote(filename, { pinned: !note?.pinned })
        }}
        onToggleFavorite={filename => {
          const note = notes.find(item => item.filename === filename)
          updateNote(filename, { favorite: !note?.favorite })
        }}
        loading={false}
        loadError=""
        onRetryLoad={() => undefined}
        collapsed={collapsed}
        onToggle={() => setCollapsed(value => !value)}
      />
    </I18nProvider>
  )
}

createRoot(document.querySelector('#root')!).render(<Fixture />)
