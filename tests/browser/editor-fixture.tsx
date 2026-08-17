import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider } from '../../src/i18n'
import { SettingsProvider } from '../../src/contexts/SettingsContext'
import { MarkdownEditor } from '../../src/components/Editor/MarkdownEditor'
import '../../src/styles/global.css'
import '../../src/styles/ui-polish.css'

// Keep selectors and behavior deterministic regardless of the host browser locale.
localStorage.setItem('easymark-locale', 'zh')

const api = {
  platform: 'darwin' as const,
  getAIConfig: async () => ({ configured: false, apiUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', credentialStorage: 'secure' as const, credentialPersisted: true, persistedSecurely: true }),
  readClipboardText: async () => '',
  writeClipboardText: async (_text: string) => undefined,
  saveImage: async (_dataUrl: string) => ({ filename: 'assets/test.png' }),
}

;(window as unknown as { electronAPI: typeof api }).electronAPI = api
if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }) as MediaQueryList
}

function Fixture() {
  const [activeNoteId, setActiveNoteId] = useState<'note-a' | 'note-b'>('note-a')
  const [noteContent, setNoteContent] = useState({
    'note-a': 'Body',
    'note-b': 'Body',
  })
  const content = noteContent[activeNoteId]
  const loadIdenticalCodeNotes = () => {
    setNoteContent({
      'note-a': '```\nconst value = 1\n```',
      // This deliberately matches note A after assigning Python. It verifies
      // editor-local undo history cannot leak when two notes share text.
      'note-b': '```python\nconst value = 1\n```',
    })
    setActiveNoteId('note-a')
  }
  return (
    <I18nProvider>
      <SettingsProvider>
        <button type="button" data-testid="load-identical-code-notes" onClick={loadIdenticalCodeNotes}>
          Load identical code notes
        </button>
        <button
          type="button"
          data-testid="switch-identical-note"
          onClick={() => setActiveNoteId(current => current === 'note-a' ? 'note-b' : 'note-a')}
        >
          Switch identical note
        </button>
        <div data-testid="active-note">{activeNoteId}</div>
        <MarkdownEditor noteId={activeNoteId} content={content} onChange={next => {
          setNoteContent(current => ({ ...current, [activeNoteId]: next }))
          document.querySelector('#markdown-output')!.textContent = next
        }} onSave={() => undefined} />
      </SettingsProvider>
    </I18nProvider>
  )
}


createRoot(document.querySelector('#root')!).render(<Fixture />)
