export interface NoteSummary {
  id: string
  title: string
  filename: string
  lastModified: number
  pinned?: boolean
  favorite?: boolean
  lastOpened?: number
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

export interface NoteDocument extends NoteSummary {
  content: string
}

export interface BacklinkResult {
  filename: string
  title: string
  snippet: string
}

export interface GitCommit {
  hash: string
  subject: string
  author: string
  createdAt: number
}

export interface GitStatus {
  available: boolean
  initialized: boolean
  dirty: boolean
  summary: string
  branch: string
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
  readClipboardText: () => Promise<string>
  writeClipboardText: (text: string) => Promise<void>
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
  openHelp: (locale: 'en' | 'zh') => Promise<void>
  onMaximizedChanged: (callback: (maximized: boolean) => void) => (() => void)
  searchAllNotes: (query: string) => Promise<SearchResult[]>
  listNoteDocuments: () => Promise<NoteDocument[]>
  listBacklinks: (title: string) => Promise<BacklinkResult[]>
  getPathForFile: (file: File) => string
  importMarkdownFile: (filePath: string) => Promise<{ filename: string; title: string; content: string }>
  chooseAndImportMarkdownFile: () => Promise<{ filename: string; title: string; content: string } | null>
  exportPDF: (html: string, title: string) => Promise<string | null>
  exportDOCX: (markdown: string, title: string) => Promise<string | null>
  shareNote: (title: string, content: string) => Promise<boolean>
  onMenuCommand: (callback: (command: string) => void) => (() => void)
  getGitStatus: () => Promise<GitStatus>
  initializeGit: () => Promise<GitStatus>
  commitGit: (message: string) => Promise<GitStatus>
  getGitHistory: () => Promise<GitCommit[]>
  getGitDiff: () => Promise<string>
  getAIConfig: () => Promise<AIConnectionConfig>
  configureAI: (config: { apiKey?: string; apiUrl: string; model: string }) => Promise<AIConnectionConfig>
  clearAIKey: () => Promise<AIConnectionConfig>
  listAIModels: (config?: { apiKey?: string; apiUrl?: string }) => Promise<string[]>
  chatWithAI: (messages: AIMessage[], options?: { maxTokens?: number; temperature?: number }) => Promise<string>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
