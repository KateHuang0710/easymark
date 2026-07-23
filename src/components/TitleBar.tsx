import React, { useState, useEffect } from 'react'
import { useTranslation } from '../i18n'
import { useSettings } from '../contexts/SettingsContext'

interface TitleBarProps {
  onToggleTheme: () => void
  onOpenSettings: () => void
  onToggleAI: () => void
}

export function TitleBar({ onToggleTheme, onOpenSettings, onToggleAI }: TitleBarProps) {
  const { t, toggleLocale, locale } = useTranslation()
  const { settings, aiEnabled } = useSettings()

  const [maximized, setMaximized] = useState(false)
  const isMac = window.electronAPI.platform === 'darwin'

  useEffect(() => {
    if (isMac) return
    const cleanup = window.electronAPI.onMaximizedChanged(setMaximized)
    return () => {
      if (cleanup) cleanup()
    }
  }, [isMac])

  const handleMinimize = () => window.electronAPI.minimize()
  const handleMaximize = () => window.electronAPI.maximize()
  const handleClose = () => window.electronAPI.close()

  return (
    <div className="title-bar">
      <div className="title-bar-drag">
        <div className="title-bar-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            <path d="M8 7h8M8 11h6M8 15h4" />
          </svg>
        </div>
        <span className="title-bar-text">{t.app.name}</span>
      </div>
      <div className="title-bar-actions">
        <button className="title-bar-btn lang-btn" onClick={toggleLocale} title={t.language.switchLanguage}>
          <span className="lang-text">{locale === 'zh' ? 'EN' : '中'}</span>
        </button>
        <button
          className={`title-bar-btn ${aiEnabled ? 'active' : ''}`}
          onClick={onToggleAI}
          title={aiEnabled ? t.titleBar.disableAI : t.titleBar.enableAI}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="5" r="2" />
            <line x1="12" y1="7" x2="12" y2="9" />
            <rect x="3" y="9" width="18" height="11" rx="2" />
            <circle cx="9" cy="14" r="1.5" fill="currentColor" />
            <circle cx="15" cy="14" r="1.5" fill="currentColor" />
            <line x1="9" y1="18" x2="15" y2="18" />
            <line x1="3" y1="14" x2="1" y2="14" />
            <line x1="21" y1="14" x2="23" y2="14" />
          </svg>
        </button>
        <button className="title-bar-btn" onClick={onToggleTheme} title={t.titleBar.toggleTheme}>
          {settings.theme === 'dark' ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="5" />
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>
        <button className="title-bar-btn" onClick={() => { void window.electronAPI.openHelp().catch(error => console.error('Failed to open help:', error)) }} title={t.titleBar.help || 'Help'}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
          </svg>
        </button>
        <button className="title-bar-btn" onClick={onOpenSettings} title="Settings">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
        {!isMac && <div className="title-bar-windows">
          <button className="title-bar-btn win-btn" onClick={handleMinimize}>
            <svg width="12" height="12" viewBox="0 0 12 12"><rect y="5" width="12" height="1.5" fill="currentColor"/></svg>
          </button>
          <button className="title-bar-btn win-btn" onClick={handleMaximize}>
            {maximized ? (
              <svg width="12" height="12" viewBox="0 0 12 12">
                <rect x="2.5" y="0.5" width="9" height="9" stroke="currentColor" strokeWidth="1.5" fill="none"/>
                <rect x="0.5" y="2.5" width="9" height="9" stroke="currentColor" strokeWidth="1.5" fill="none"/>
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 12 12">
                <rect x="1" y="1" width="10" height="10" stroke="currentColor" strokeWidth="1.5" fill="none"/>
              </svg>
            )}
          </button>
          <button className="title-bar-btn win-btn close" onClick={handleClose}>
            <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5"/></svg>
          </button>
        </div>}
      </div>
    </div>
  )
}
