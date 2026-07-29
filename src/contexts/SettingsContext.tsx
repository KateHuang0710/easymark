import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react'
import { configureAI, initializeAI, setModel as setAIModel } from '../services/ai'
import { setShowCodeLang } from '../services/markdown'

export type ColorScheme = 'forest' | 'ocean' | 'terracotta' | 'monochrome'
export type ThemeMode = 'light' | 'dark'

export interface AIConfig {
  apiKey: string
  apiUrl: string
  model: string
}

interface Settings {
  theme: ThemeMode
  colorScheme: ColorScheme
  ai: AIConfig
  showCodeLangLabel: boolean
  aiInlineCompletion: boolean
  dualPane: boolean
  readingMode: boolean
}

interface SettingsContextType {
  settings: Settings
  setTheme: (theme: ThemeMode) => void
  setColorScheme: (scheme: ColorScheme) => void
  setAIConfig: (config: Partial<AIConfig>) => void
  setShowCodeLangLabel: (v: boolean) => void
  setAiInlineCompletion: (v: boolean) => void
  setDualPane: (v: boolean) => void
  setReadingMode: (v: boolean) => void
  aiEnabled: boolean
  aiCredentialStorage: 'secure' | 'local' | 'session'
  refreshAIStatus: () => Promise<void>
}

const STORAGE_KEY = 'easymark-settings'

const VALID_SCHEMES: ColorScheme[] = ['forest', 'ocean', 'terracotta', 'monochrome']

function loadSettings(): Settings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const p = JSON.parse(saved)
      return {
        theme: p.theme === 'dark' || p.theme === 'light' ? p.theme : 'light',
        colorScheme: VALID_SCHEMES.includes(p.colorScheme) ? p.colorScheme : 'forest',
        ai: {
          apiKey: p.ai?.apiKey || '',
          apiUrl: p.ai?.apiUrl || 'https://api.openai.com/v1',
          model: p.ai?.model || 'gpt-4o-mini',
        },
        showCodeLangLabel: p.showCodeLangLabel !== false,
        aiInlineCompletion: p.aiInlineCompletion !== false,
        dualPane: false, // dualPane is runtime-only state, not persisted
        readingMode: p.readingMode === true,
      }
    }
  } catch {}
  return {
    theme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    colorScheme: 'forest',
    ai: {
      apiKey: '',
      apiUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    },
    showCodeLangLabel: true,
    aiInlineCompletion: true,
    dualPane: false,
    readingMode: false,
  }
}

function saveSettings(s: Settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      ...s,
      ai: { ...s.ai, apiKey: '' },
    }))
  } catch (error) {
    console.error('Failed to persist settings:', error)
  }
}

const SettingsContext = createContext<SettingsContextType | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [aiEnabled, setAiEnabled] = useState(false)
  const [aiCredentialStorage, setAiCredentialStorage] = useState<'secure' | 'local' | 'session'>('session')

  useEffect(() => {
    saveSettings(settings)
    document.documentElement.setAttribute('data-theme', settings.theme)
    document.documentElement.setAttribute('data-color-scheme', settings.colorScheme)
    setShowCodeLang(settings.showCodeLangLabel)
    if (settings.ai.model) {
      setAIModel(settings.ai.model)
    }
  }, [settings])

  useEffect(() => {
    let active = true
    const legacyKey = settings.ai.apiKey.trim()
    const initialize = legacyKey
      ? configureAI(legacyKey, settings.ai.apiUrl, settings.ai.model)
      : initializeAI()
    void initialize.then(config => {
      if (!active) return
      setAiEnabled(config.configured)
      setAiCredentialStorage(config.credentialStorage || (config.persistedSecurely === false ? 'session' : 'secure'))
      setSettings(prev => ({
        ...prev,
        ai: { apiKey: '', apiUrl: config.apiUrl, model: config.model },
      }))
    }).catch(error => console.error('Failed to initialize AI configuration:', error))
    return () => { active = false }
    // AI credentials are loaded once from the main process; settings changes are
    // explicitly applied by SettingsDialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refreshAIStatus = useCallback(async () => {
    const config = await initializeAI()
    setAiEnabled(config.configured)
    setAiCredentialStorage(config.credentialStorage || (config.persistedSecurely === false ? 'session' : 'secure'))
    setSettings(prev => ({
      ...prev,
      ai: { apiKey: '', apiUrl: config.apiUrl, model: config.model },
    }))
  }, [])

  const setTheme = useCallback((theme: ThemeMode) => {
    setSettings(prev => ({ ...prev, theme }))
  }, [])

  const setColorScheme = useCallback((colorScheme: ColorScheme) => {
    setSettings(prev => ({ ...prev, colorScheme }))
  }, [])

  const setAIConfig = useCallback((config: Partial<AIConfig>) => {
    setSettings(prev => ({ ...prev, ai: { ...prev.ai, ...config } }))
  }, [])

  const setShowCodeLangLabel = useCallback((v: boolean) => {
    setSettings(prev => ({ ...prev, showCodeLangLabel: v }))
  }, [])

  const setAiInlineCompletion = useCallback((v: boolean) => {
    setSettings(prev => ({ ...prev, aiInlineCompletion: v }))
  }, [])

  const setDualPane = useCallback((v: boolean) => {
    setSettings(prev => ({ ...prev, dualPane: v }))
  }, [])

  const setReadingMode = useCallback((v: boolean) => {
    setSettings(prev => ({ ...prev, readingMode: v }))
  }, [])

  return (
    <SettingsContext.Provider value={{
      settings, setTheme, setColorScheme, setAIConfig,
      setShowCodeLangLabel, setAiInlineCompletion, setDualPane, setReadingMode,
      aiEnabled, aiCredentialStorage, refreshAIStatus
    }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings(): SettingsContextType {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider')
  return ctx
}
