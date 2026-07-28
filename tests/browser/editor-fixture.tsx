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
  getAIConfig: async () => ({ configured: false, apiUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', persistedSecurely: true }),
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
  const [content, setContent] = useState('Body')
  return (
    <I18nProvider>
      <SettingsProvider>
        <MarkdownEditor content={content} onChange={next => {
          setContent(next)
          document.querySelector('#markdown-output')!.textContent = next
        }} onSave={() => undefined} />
      </SettingsProvider>
    </I18nProvider>
  )
}

createRoot(document.querySelector('#root')!).render(<Fixture />)
