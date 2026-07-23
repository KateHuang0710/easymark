export interface NoteSummary {
  id: string
  title: string
  filename: string
  lastModified: number
}

export interface Note extends NoteSummary {
  content: string
}

export interface NoteVersion {
  id: string
  filename: string
  createdAt: number
  size: number
}

export interface DeleteNoteResult {
  deleted: boolean
  historyDeletionFailed?: boolean
}

export interface RenameNoteResult {
  filename: string
  title: string
  historyMigrationFailed?: boolean
}

export interface SaveStatus {
  state: 'idle' | 'saving' | 'saved' | 'error'
  error?: string
  savedAt?: number
}

export interface SearchResult {
  filename: string
  title: string
  snippet: string
  score: number
}

export interface AIConnectionConfig {
  configured: boolean
  apiUrl: string
  model: string
  persistedSecurely?: boolean
}

export interface AIMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ElectronAPI {
  platform: 'darwin' | 'win32' | 'linux'
  minimize: () => void
  maximize: () => void
  close: () => void
  onBeforeClose: (callback: () => void) => (() => void)
  confirmClose: () => void
  cancelClose: () => void
  listNotes: () => Promise<NoteSummary[]>
  readNote: (filename: string) => Promise<string | null>
  saveNote: (filename: string, content: string) => Promise<boolean>
  listNoteVersions: (filename: string) => Promise<NoteVersion[]>
  readNoteVersion: (filename: string, versionId: string) => Promise<string>
  restoreNoteVersion: (filename: string, versionId: string) => Promise<string>
  createNote: (title: string) => Promise<{ filename: string; title: string; content: string }>
  deleteNote: (filename: string) => Promise<DeleteNoteResult>
  renameNote: (oldFilename: string, newTitle: string) => Promise<RenameNoteResult>
  saveImage: (dataUrl: string) => Promise<{ filename: string }>
  openHelp: () => Promise<void>
  onMaximizedChanged: (callback: (maximized: boolean) => void) => (() => void)
  searchAllNotes: (query: string) => Promise<SearchResult[]>
  exportPDF: (html: string, title: string) => Promise<string | null>
  exportDOCX: (markdown: string, title: string) => Promise<string | null>
  getAIConfig: () => Promise<AIConnectionConfig>
  configureAI: (config: { apiKey?: string; apiUrl: string; model: string }) => Promise<AIConnectionConfig>
  clearAIKey: () => Promise<AIConnectionConfig>
  listAIModels: () => Promise<string[]>
  chatWithAI: (messages: AIMessage[], options?: { maxTokens?: number; temperature?: number }) => Promise<string>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
