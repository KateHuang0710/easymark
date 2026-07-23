import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react'
import { en } from './en'
import { zh } from './zh'

type Locale = 'en' | 'zh'
type Translations = typeof en

const translations: Record<Locale, Translations> = { en, zh }

interface I18nContextType {
  locale: Locale
  t: Translations
  setLocale: (locale: Locale) => void
  toggleLocale: () => void
}

const I18nContext = createContext<I18nContextType | null>(null)

const STORAGE_KEY = 'easymark-locale'

function getInitialLocale(): Locale {
  let saved: Locale | null = null
  try { saved = localStorage.getItem(STORAGE_KEY) as Locale | null } catch {}
  if (saved === 'en' || saved === 'zh') return saved
  const lang = navigator.language
  if (lang.startsWith('zh')) return 'zh'
  return 'en'
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getInitialLocale)

  const t = translations[locale]

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale)
    try { localStorage.setItem(STORAGE_KEY, newLocale) } catch {}
  }, [])

  const toggleLocale = useCallback(() => {
    setLocaleState(prev => {
      const next = prev === 'en' ? 'zh' : 'en'
      try { localStorage.setItem(STORAGE_KEY, next) } catch {}
      return next
    })
  }, [])

  return (
    <I18nContext.Provider value={{ locale, t, setLocale, toggleLocale }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useTranslation(): I18nContextType {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useTranslation must be used within I18nProvider')
  return ctx
}
