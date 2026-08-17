import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '../../src/App'
import type { ElectronAPI, NoteSummary } from '../../src/types'
import '../../src/styles/global.css'
import '../../src/styles/ui-polish.css'

localStorage.setItem('easymark-locale', 'zh')
localStorage.removeItem('easymark-settings')
window.confirm = () => true

const notes: NoteSummary[] = [
  { id: 'project', title: 'Project Plan', filename: 'project.md', lastModified: Date.now(), lastOpened: Date.now() },
  { id: 'ideas', title: 'Ideas', filename: 'ideas.md', lastModified: Date.now() - 1_000, lastOpened: Date.now() - 1_000 },
  { id: 'meeting', title: 'Meeting Notes', filename: 'meeting.md', lastModified: Date.now() - 2_000, lastOpened: Date.now() - 2_000 },
]
const contents: Record<string, string> = {
  'project.md': '# Project Plan\n\nA note for app-level regression tests.',
  'ideas.md': '# Ideas\n\n- One\n- Two',
  'meeting.md': '# Meeting Notes\n\nFollow up with the team.',
}
const saveCalls: Array<{ filename: string; content: string }> = []

Object.assign(window, {
  __easymarkAppTest: {
    getNotes: () => notes.map(note => ({ ...note })),
    getContent: (filename: string) => contents[filename] ?? null,
    getSaveCalls: () => saveCalls.map(call => ({ ...call })),
  },
})

const api = {
  platform: 'darwin',
  minimize: () => undefined,
  maximize: () => undefined,
  close: () => undefined,
  onBeforeClose: () => () => undefined,
  confirmClose: () => undefined,
  cancelClose: () => undefined,
  readClipboardText: async () => '',
  writeClipboardText: async () => undefined,
  listNotes: async () => notes,
  readNote: async (filename: string) => contents[filename] ?? null,
  saveNote: async (filename: string, content: string) => {
    saveCalls.push({ filename, content })
    contents[filename] = content
    return true
  },
  listNoteVersions: async () => [],
  readNoteVersion: async () => '',
  restoreNoteVersion: async () => '',
  createNote: async (title: string) => {
    const filename = `${title.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-') || 'untitled'}.md`
    const note = { id: filename.slice(0, -3), title, filename, lastModified: Date.now() }
    notes.unshift(note)
    contents[filename] = ''
    return { ...note, content: '' }
  },
  deleteNote: async (filename: string) => {
    const index = notes.findIndex(note => note.filename === filename)
    if (index < 0) return { deleted: false }
    notes.splice(index, 1)
    delete contents[filename]
    return { deleted: true }
  },
  renameNote: async (filename: string, title: string) => ({ filename, title }),
  saveImage: async () => ({ filename: 'image.png' }),
  openHelp: async () => undefined,
  onMaximizedChanged: () => () => undefined,
  searchAllNotes: async (query: string) => notes.filter(note => note.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(note => ({ filename: note.filename, title: note.title, snippet: contents[note.filename], score: 1 })),
  listNoteDocuments: async () => notes.map(note => ({ ...note, content: contents[note.filename] })),
  listBacklinks: async () => [],
  getPathForFile: (file: File) => file.name,
  importMarkdownFile: async (filePath: string) => ({ filename: filePath, title: filePath.replace(/\.md$/i, ''), content: '' }),
  chooseAndImportMarkdownFile: async () => null,
  exportPDF: async () => null,
  exportDOCX: async () => null,
  shareNote: async () => true,
  onMenuCommand: () => () => undefined,
  getGitStatus: async () => ({ available: true, initialized: false, dirty: false, summary: '', branch: '' }),
  initializeGit: async () => ({ available: true, initialized: true, dirty: false, summary: '', branch: 'main' }),
  commitGit: async () => ({ available: true, initialized: true, dirty: false, summary: '', branch: 'main' }),
  getGitHistory: async () => [],
  getGitDiff: async () => '',
  getAIConfig: async () => ({ configured: false, apiUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', credentialStorage: 'session' as const }),
  configureAI: async () => ({ configured: false, apiUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', credentialStorage: 'session' as const }),
  clearAIKey: async () => ({ configured: false, apiUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', credentialStorage: 'session' as const }),
  listAIModels: async () => [],
  chatWithAI: async () => '',
} satisfies ElectronAPI

window.electronAPI = api

createRoot(document.querySelector('#root')!).render(<App />)
