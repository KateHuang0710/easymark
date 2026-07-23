import React, { useState, useRef, useEffect } from 'react'
import { getCompletion, getSuggestion, chatWithAI } from '../services/ai'
import { useSettings } from '../contexts/SettingsContext'
import { useTranslation } from '../i18n'

interface AIAssistantProps {
  visible: boolean
  onClose: () => void
  noteContent: string
}

type AITab = 'complete' | 'chat'
type ChatMessage = { role: 'user' | 'assistant'; content: string }

export function AIAssistant({ visible, onClose, noteContent }: AIAssistantProps) {
  const { t } = useTranslation()
  const { aiEnabled } = useSettings()
  const [activeTab, setActiveTab] = useState<AITab>('complete')
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [loading, setLoading] = useState(false)
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([])
  const chatHistoryRef = useRef(chatHistory)
  chatHistoryRef.current = chatHistory
  const chatEndRef = useRef<HTMLDivElement>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatHistory])

  useEffect(() => {
    if (!visible) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, visible])

  const handleComplete = async () => {
    if (!input.trim()) return
    setLoading(true)
    setOutput('')
    try {
      const selectedText = window.getSelection()?.toString() || ''
      const context = selectedText || noteContent.slice(0, 2000)
      const result = await getCompletion(input, context)
      if (mountedRef.current) setOutput(result)
    } catch (err: any) {
      if (mountedRef.current) setOutput(`${t.ai.error}: ${err.message || 'Failed to get completion'}`)
    }
    if (mountedRef.current) setLoading(false)
  }

  const handleSuggest = async () => {
    setLoading(true)
    setOutput('')
    try {
      const selectedText = window.getSelection()?.toString() || noteContent
      if (!selectedText.trim()) {
        if (mountedRef.current) setOutput(t.ai.selectTextFirst)
        if (mountedRef.current) setLoading(false)
        return
      }
      const result = await getSuggestion(selectedText.slice(0, 2000))
      if (mountedRef.current) setOutput(result)
    } catch (err: any) {
      if (mountedRef.current) setOutput(`${t.ai.error}: ${err.message || 'Failed to get suggestion'}`)
    }
    if (mountedRef.current) setLoading(false)
  }

  const handleChat = async () => {
    if (!input.trim() || loading) return
    const userMsg = input.trim()
    const previousHistory = chatHistoryRef.current
    setInput('')
    setChatHistory([...previousHistory, { role: 'user', content: userMsg }])
    await performChatCompletion(userMsg, previousHistory)
  }

  const performChatCompletion = async (userMsg: string, history: ChatMessage[]) => {
    setLoading(true)
    try {
      const result = await chatWithAI(userMsg, noteContent.slice(0, 3000), history)
      if (mountedRef.current) setChatHistory(prev => [...prev, { role: 'assistant', content: result }])
    } catch (err: any) {
      if (mountedRef.current) setChatHistory(prev => [...prev, { role: 'assistant', content: `${t.ai.error}: ${err.message || 'Failed'}` }])
    }
    if (mountedRef.current) setLoading(false)
  }

  const insertToNote = (text: string) => {
    const selectedEditor = document.querySelector<HTMLElement>('[data-editor-active="true"]')
    if (!selectedEditor) return

    if (selectedEditor instanceof HTMLTextAreaElement) {
      const start = selectedEditor.selectionStart
      const end = selectedEditor.selectionEnd
      selectedEditor.setRangeText(text, start, end, 'end')
      selectedEditor.dispatchEvent(new Event('input', { bubbles: true }))
      selectedEditor.focus()
      return
    }

    selectedEditor.focus()
    const selection = window.getSelection()
    let range: Range
    if (selection?.rangeCount && selectedEditor.contains(selection.getRangeAt(0).commonAncestorContainer)) {
      range = selection.getRangeAt(0)
      range.deleteContents()
    } else {
      range = document.createRange()
      range.selectNodeContents(selectedEditor)
      range.collapse(false)
    }
    const textNode = document.createTextNode(text)
    range.insertNode(textNode)
    range.setStartAfter(textNode)
    range.collapse(true)
    selection?.removeAllRanges()
    selection?.addRange(range)
    selectedEditor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
  }

  if (!visible) return null

  return (
    <div className="ai-panel">
      <div className="ai-panel-header">
        <div className="ai-panel-tabs">
          <button
            className={`ai-tab ${activeTab === 'complete' ? 'active' : ''}`}
            onClick={() => setActiveTab('complete')}
            disabled={!aiEnabled}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="5" r="2" />
              <line x1="12" y1="7" x2="12" y2="9" />
              <rect x="3" y="9" width="18" height="11" rx="2" />
              <circle cx="9" cy="14" r="1.5" fill="currentColor" />
              <circle cx="15" cy="14" r="1.5" fill="currentColor" />
              <line x1="9" y1="18" x2="15" y2="18" />
            </svg>
            <span>{t.ai.write}</span>
          </button>
          <button
            className={`ai-tab ${activeTab === 'chat' ? 'active' : ''}`}
            onClick={() => setActiveTab('chat')}
            disabled={!aiEnabled}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span>{t.ai.chat}</span>
          </button>
        </div>
        <button className="ai-panel-close" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="ai-panel-body">
        {!aiEnabled && (
          <div className="ai-not-configured">
            <p>{t.ai.notConfigured}</p>
          </div>
        )}

        {activeTab === 'complete' && aiEnabled && (
          <div className="ai-complete">
            <div className="ai-complete-actions">
              <button className="ai-btn ai-btn-primary" onClick={handleSuggest} disabled={loading}>
                {loading ? t.ai.thinking : t.ai.suggest}
              </button>
              <button className="ai-btn" onClick={handleComplete} disabled={loading || !input.trim()}>
                {loading ? t.ai.thinking : t.ai.complete}
              </button>
            </div>
            <textarea
              className="ai-textarea"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={t.ai.inputPlaceholder}
              rows={3}
            />
            {output && (
              <div className="ai-output">
                <div className="ai-output-header">
                  <span>{t.ai.result}</span>
                  <button className="ai-insert-btn" onClick={() => insertToNote(output)} title={t.ai.insertToNote}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 5v14M5 12l7 7 7-7" />
                    </svg>
                    {t.ai.insert}
                  </button>
                </div>
                <div className="ai-output-content">{output}</div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'chat' && aiEnabled && (
          <div className="ai-chat">
            <div className="ai-chat-history">
              {chatHistory.length === 0 && (
                <div className="ai-chat-empty">
                  <p>{t.ai.chatEmpty}</p>
                </div>
              )}
              {chatHistory.map((msg, i) => (
                <div key={i} className={`ai-chat-msg ${msg.role}`}>
                  <div className="ai-chat-bubble">{msg.content}</div>
                </div>
              ))}
              {loading && (
                <div className="ai-chat-msg assistant">
                  <div className="ai-chat-bubble ai-thinking">{t.ai.thinking}</div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            <div className="ai-chat-input-area">
              <input
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleChat() }}}
                placeholder={t.ai.chatInput}
                className="ai-chat-input"
              />
              <button className="ai-chat-send" onClick={handleChat} disabled={loading || !input.trim()}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
