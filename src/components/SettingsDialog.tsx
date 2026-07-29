import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useSettings, ColorScheme } from '../contexts/SettingsContext'
import { setModel, fetchModels, configureAI, clearAIKey, getDefaultModelsForProvider } from '../services/ai'
import { useTranslation } from '../i18n'

interface SettingsDialogProps {
  visible: boolean
  onClose: () => void
}

const schemeLabels: Record<ColorScheme, { en: string; zh: string }> = {
  forest: { en: 'Forest', zh: '森林' },
  ocean: { en: 'Ocean', zh: '海洋' },
  terracotta: { en: 'Terracotta', zh: '陶土' },
  monochrome: { en: 'Monochrome', zh: '黑白' },
}


function isValidAIUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim())
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
    return !parsed.username && !parsed.password && (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && loopback))
  } catch {
    return false
  }
}

const schemeColors: Record<ColorScheme, string> = {
  forest: '#7A9E7E',
  ocean: '#5A8FAC',
  terracotta: '#C4705A',
  monochrome: '#888888',
}

export function SettingsDialog({ visible, onClose }: SettingsDialogProps) {
  const { t, locale, setLocale } = useTranslation()
  const { settings, setTheme, setColorScheme, setAIConfig, setShowCodeLangLabel, setAiInlineCompletion, setDualPane, setReadingMode, aiEnabled, aiCredentialStorage, refreshAIStatus } = useSettings()
  const [tab, setTab] = useState<'appearance' | 'ai' | 'about'>('appearance')
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [apiUrlDraft, setApiUrlDraft] = useState(settings.ai.apiUrl)
  const [modelDraft, setModelDraft] = useState(settings.ai.model)
  const [saved, setSaved] = useState(false)
  const [aiError, setAIError] = useState('')
  const [availableModels, setAvailableModels] = useState<string[]>(() => getDefaultModelsForProvider(settings.ai.apiUrl))
  const [fetchingModels, setFetchingModels] = useState(false)
  const [showModelDropdown, setShowModelDropdown] = useState(false)
  const modelContainerRef = useRef<HTMLDivElement>(null)

  const isZh = locale === 'zh'

  useEffect(() => {
    if (!visible) return
    setApiKeyDraft('')
    setApiUrlDraft(settings.ai.apiUrl)
    setModelDraft(settings.ai.model)
    setAIError('')
    setSaved(false)
  }, [visible, settings.ai.apiUrl, settings.ai.model])

  useEffect(() => {
    if (!visible) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, visible])

  // Close model dropdown on click outside
  useEffect(() => {
    if (!showModelDropdown) return
    const handleClickOutside = (e: MouseEvent) => {
      if (modelContainerRef.current && !modelContainerRef.current.contains(e.target as Node)) {
        setShowModelDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showModelDropdown])

  const handleRefreshModels = useCallback(async () => {
    if (!apiKeyDraft.trim() && !aiEnabled) return
    if (!isValidAIUrl(apiUrlDraft)) {
      setAIError(isZh ? '请输入有效的 API 地址' : 'Enter a valid API URL')
      return
    }
    setFetchingModels(true)
    setAIError('')
    try {
      const models = await fetchModels({
        apiKey: apiKeyDraft.trim() || undefined,
        apiUrl: apiUrlDraft,
      })
      setAvailableModels(models)
      // If current model draft is not in the list, keep it as-is (user may have typed a custom model)
      setShowModelDropdown(true)
    } catch (err) {
      console.error('Failed to fetch models:', err)
      setAIError(err instanceof Error ? err.message : String(err))
      // Keep the current default suggestions; user can still type manually
      setAvailableModels(getDefaultModelsForProvider(apiUrlDraft || 'https://api.openai.com/v1'))
      setShowModelDropdown(true)
    }
    setFetchingModels(false)
  }, [aiEnabled, apiKeyDraft, apiUrlDraft, isZh])

  // Update available model suggestions when API URL changes
  useEffect(() => {
    setAvailableModels(getDefaultModelsForProvider(apiUrlDraft || 'https://api.openai.com/v1'))
  }, [apiUrlDraft])

  const handleClearAIKey = async () => {
    setAIError('')
    try {
      const config = await clearAIKey()
      setAIConfig({ apiKey: '', apiUrl: config.apiUrl, model: config.model })
      setApiKeyDraft('')
      await refreshAIStatus()
      setSaved(false)
    } catch (error) {
      setAIError(error instanceof Error ? error.message : String(error))
    }
  }

  const saveAI = async () => {
    if (!isValidAIUrl(apiUrlDraft) || !modelDraft.trim()) {
      setAIError(isZh ? '请输入有效的 API 地址和模型名称' : 'Enter a valid API URL and model name')
      return
    }
    if (!apiKeyDraft.trim() && !aiEnabled) {
      setAIError(isZh ? '请输入 API Key' : 'Enter an API key')
      return
    }
    setAIError('')
    try {
      const config = await configureAI(apiKeyDraft.trim() || undefined, apiUrlDraft, modelDraft)
      setAIConfig({ apiKey: '', apiUrl: config.apiUrl, model: config.model })
      await refreshAIStatus()
      setModel(config.model)
      setApiKeyDraft('')
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2000)
    } catch (error) {
      setAIError(error instanceof Error ? error.message : String(error))
    }
  }

  if (!visible) return null

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-dialog" onClick={e => e.stopPropagation()}>
        <div className="settings-sidebar">
          <div className="settings-sidebar-header">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            <span>{isZh ? '设置' : 'Settings'}</span>
          </div>
          <div className="settings-sidebar-items">
            <button
              className={`settings-sidebar-item ${tab === 'appearance' ? 'active' : ''}`}
              onClick={() => setTab('appearance')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
              </svg>
              {isZh ? '外观' : 'Appearance'}
            </button>
            <button
              className={`settings-sidebar-item ${tab === 'ai' ? 'active' : ''}`}
              onClick={() => setTab('ai')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2a4 4 0 0 1 4 4c0 2-2 4-4 4s-4-2-4-4a4 4 0 0 1 4-4z" /><path d="M2 22c0-4 4-8 10-8s10 4 10 8" />
              </svg>
              AI
            </button>
            <button
              className={`settings-sidebar-item ${tab === 'about' ? 'active' : ''}`}
              onClick={() => setTab('about')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
              </svg>
              {isZh ? '关于' : 'About'}
            </button>
          </div>
        </div>

        <div className="settings-content">
          <div className="settings-content-header">
            <h2>
              {tab === 'appearance' ? (isZh ? '外观' : 'Appearance') :
               tab === 'ai' ? 'AI' :
               isZh ? '关于 EasyMark' : 'About EasyMark'}
            </h2>
            <button className="settings-close-btn" onClick={onClose}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div className="settings-body">
            {tab === 'appearance' && (
              <div className="settings-section">
                <div className="settings-group">
                  <label className="settings-label">{isZh ? '主题' : 'Theme'}</label>
                  <div className="settings-chip-group">
                    <button
                      className={`settings-chip ${settings.theme === 'light' ? 'active' : ''}`}
                      onClick={() => setTheme('light')}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                      </svg>
                      {isZh ? '浅色' : 'Light'}
                    </button>
                    <button
                      className={`settings-chip ${settings.theme === 'dark' ? 'active' : ''}`}
                      onClick={() => setTheme('dark')}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                      </svg>
                      {isZh ? '深色' : 'Dark'}
                    </button>
                  </div>
                </div>

                <div className="settings-group">
                  <label className="settings-label">{isZh ? '配色' : 'Color Scheme'}</label>
                  <div className="settings-scheme-grid">
                    {(Object.keys(schemeLabels) as ColorScheme[]).map(scheme => (
                      <button
                        key={scheme}
                        className={`settings-scheme-card ${settings.colorScheme === scheme ? 'active' : ''}`}
                        onClick={() => setColorScheme(scheme)}
                      >
                        <div className="settings-scheme-preview" style={{ background: schemeColors[scheme] }} />
                        <span>{isZh ? schemeLabels[scheme].zh : schemeLabels[scheme].en}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="settings-group">
                  <label className="settings-label">{isZh ? '语言' : 'Language'}</label>
                  <div className="settings-chip-group">
                    <button
                      className={`settings-chip ${locale === 'en' ? 'active' : ''}`}
                      onClick={() => setLocale('en')}
                    >English</button>
                    <button
                      className={`settings-chip ${locale === 'zh' ? 'active' : ''}`}
                      onClick={() => setLocale('zh')}
                    >中文</button>
                  </div>
                </div>

                <div className="settings-group">
                  <label className="settings-label">{isZh ? '代码块语言标签' : 'Code Language Label'}</label>
                  <div className="settings-chip-group">
                    <button
                      className={`settings-chip ${settings.showCodeLangLabel ? 'active' : ''}`}
                      onClick={() => setShowCodeLangLabel(true)}
                    >{isZh ? '显示' : 'Show'}</button>
                    <button
                      className={`settings-chip ${!settings.showCodeLangLabel ? 'active' : ''}`}
                      onClick={() => setShowCodeLangLabel(false)}
                    >{isZh ? '隐藏' : 'Hide'}</button>
                  </div>
                </div>

                <div className="settings-group">
                  <label className="settings-label">{isZh ? '阅读模式' : 'Reading Mode'}</label>
                  <div className="settings-chip-group">
                    <button
                      className={`settings-chip ${settings.readingMode ? 'active' : ''}`}
                      onClick={() => setReadingMode(true)}
                    >{isZh ? '启用' : 'Enable'}</button>
                    <button
                      className={`settings-chip ${!settings.readingMode ? 'active' : ''}`}
                      onClick={() => setReadingMode(false)}
                    >{isZh ? '关闭' : 'Disable'}</button>
                  </div>
                </div>
              </div>
            )}

            {tab === 'ai' && (
              <div className="settings-section">
                <div className="settings-group">
                  <label className="settings-label">{t.ai.apiKey}</label>
                  <input
                    type="password"
                    className="settings-input"
                    value={apiKeyDraft}
                    onChange={e => setApiKeyDraft(e.target.value)}
                    placeholder={aiEnabled ? (isZh ? '留空则保留现有密钥' : 'Leave blank to keep the current key') : 'sk-...'}
                  />
                </div>
                <div className="settings-group">
                  <label className="settings-label">{t.ai.apiUrl}</label>
                  <input
                    type="text"
                    className="settings-input"
                    value={apiUrlDraft}
                    onChange={e => setApiUrlDraft(e.target.value)}
                    placeholder="https://api.openai.com/v1"
                  />
                  <p className="settings-hint">{t.ai.apiUrlHint}</p>
                </div>
                <div className="settings-group">
                  <div className="settings-model-header">
                    <label className="settings-label">{t.ai.model}</label>
                    <button
                      className="settings-refresh-btn"
                      onClick={handleRefreshModels}
                      disabled={fetchingModels || (!apiKeyDraft.trim() && !aiEnabled)}
                      title={t.ai.refresh}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={fetchingModels ? 'spin' : ''}>
                        <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                      </svg>
                      <span>{fetchingModels ? t.ai.loading : t.ai.refresh}</span>
                    </button>
                  </div>
                  <div className="settings-model-combobox" ref={modelContainerRef}>
                    <input
                      type="text"
                      className="settings-input"
                      value={modelDraft}
                      onChange={e => { setModelDraft(e.target.value); setShowModelDropdown(true) }}
                      onFocus={() => setShowModelDropdown(true)}
                      placeholder={isZh ? '输入或选择模型名称' : 'Enter or select a model'}
                    />
                    {showModelDropdown && (
                      <div className="settings-model-dropdown">
                        {availableModels.filter(m => m.toLowerCase().includes(modelDraft.toLowerCase())).length > 0 ? (
                          availableModels
                            .filter(m => m.toLowerCase().includes(modelDraft.toLowerCase()))
                            .map(m => (
                              <div
                                key={m}
                                className={`settings-model-option ${m === modelDraft ? 'active' : ''}`}
                                onClick={() => { setModelDraft(m); setShowModelDropdown(false) }}
                                onMouseDown={e => e.preventDefault()}
                              >
                                {m}
                              </div>
                            ))
                        ) : (
                          <div className="settings-model-option no-match">
                            {isZh ? '没有匹配的模型，继续输入自定义名称' : 'No matching models, keep typing'}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <p className="settings-hint">{isZh ? '刷新仅测试当前输入，不会保存 API 设置；也可以直接输入模型名称' : 'Refresh only tests the current input and does not save AI settings; you can also type a model name manually'}</p>
                </div>
                <div className="settings-group">
                  <label className="settings-label">{t.ai.inlineCompletion}</label>
                  <p className="settings-hint">{t.ai.inlineCompletionDesc}</p>
                  <div className="settings-chip-group">
                    <button
                      className={`settings-chip ${settings.aiInlineCompletion ? 'active' : ''}`}
                      onClick={() => setAiInlineCompletion(true)}
                    >{isZh ? '开启' : 'On'}</button>
                    <button
                      className={`settings-chip ${!settings.aiInlineCompletion ? 'active' : ''}`}
                      onClick={() => setAiInlineCompletion(false)}
                    >{isZh ? '关闭' : 'Off'}</button>
                  </div>
                </div>
                <div className="settings-group">
                  <p className="settings-hint">
                    {isZh ? '仅支持 OpenAI 兼容的 Chat Completions 接口。' : 'Only OpenAI-compatible Chat Completions endpoints are supported.'}
                  </p>
                  <div className="settings-ai-actions">
                    <button className="settings-save-btn" onClick={() => { void saveAI() }} disabled={!modelDraft.trim() || (!apiKeyDraft.trim() && !aiEnabled)}>
                      {saved ? t.ai.saved + ' ✓' : t.ai.save}
                    </button>
                    {aiEnabled && (
                      <button className="settings-clear-key-btn" onClick={() => { void handleClearAIKey() }}>
                        {isZh ? '清除 API Key' : 'Clear API key'}
                      </button>
                    )}
                    {aiEnabled && <span className="settings-connected">{t.ai.connected}</span>}
                  </div>
                  {aiEnabled && aiCredentialStorage === 'local' && (
                    <p className="settings-hint settings-warning">
                      {isZh
                        ? 'API Key 已加密保存在此 Mac，重启后仍可使用。当前是未正式签名的本地构建，因此使用无弹窗的开发凭据后端；正式签名版会改用 macOS 钥匙串。'
                        : 'The API key is encrypted on this Mac and remains available after restart. This locally built app uses the no-prompt development credential backend; a signed release uses macOS Keychain.'}
                    </p>
                  )}
                  {aiEnabled && aiCredentialStorage === 'session' && (
                    <p className="settings-hint settings-warning">
                      {isZh
                        ? '当前系统无法提供安全凭据存储；API Key 仅在本次运行中使用，重启后需要重新输入。'
                        : 'Secure credential storage is unavailable. The API key is session-only and must be entered again after restart.'}
                    </p>
                  )}
                  {aiError && <p className="settings-hint settings-error">{aiError}</p>}
                </div>
              </div>
            )}

            {tab === 'about' && (
              <div className="settings-section settings-about">
                <div className="settings-about-logo">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                    <path d="M8 7h8M8 11h6M8 15h4" />
                  </svg>
                </div>
                <h3>EasyMark v1.0.0</h3>
                <p>{isZh ? 'AI 驱动的 Markdown 笔记应用' : 'AI-powered Markdown note application'}</p>
                <button className="settings-help-btn" onClick={() => { void window.electronAPI.openHelp(locale).catch(error => console.error('Failed to open help:', error)) }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
                  </svg>
                  {isZh ? '查看帮助文档' : 'View Help'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
