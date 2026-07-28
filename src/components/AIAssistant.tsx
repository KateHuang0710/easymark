import React, { useState, useRef, useEffect } from 'react'
import { askKnowledgeBase, getCompletion, getSuggestion, chatWithAI, semanticSearchNotes } from '../services/ai'
import { useSettings } from '../contexts/SettingsContext'
import { useTranslation } from '../i18n'
import { renderMarkdown } from '../services/markdown'
import { NoteDocument } from '../types'
import * as storage from '../services/storage'

interface AIAssistantProps {
  visible: boolean
  onClose: () => void
  noteContent: string
  onOpenNote?: (filename: string) => void
  initialTab?: AITab
}

type AITab = 'complete' | 'chat' | 'knowledge'
type ChatMessage = { role: 'user' | 'assistant'; content: string }

export function AIAssistant({ visible, onClose, noteContent, onOpenNote, initialTab }: AIAssistantProps) {
  const { t, locale } = useTranslation()
  const { aiEnabled, settings } = useSettings()
  const [activeTab, setActiveTab] = useState<AITab>('complete')
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [loading, setLoading] = useState(false)
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([])
  const [knowledgeDocuments, setKnowledgeDocuments] = useState<NoteDocument[]>([])
  const [knowledgeResults, setKnowledgeResults] = useState<Array<NoteDocument & { score: number }>>([])
  const [knowledgeAnswer, setKnowledgeAnswer] = useState('')
  const chatHistoryRef = useRef(chatHistory)
  chatHistoryRef.current = chatHistory
  const chatEndRef = useRef<HTMLDivElement>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
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

  useEffect(() => {
    if (visible && initialTab) setActiveTab(initialTab)
  }, [initialTab, visible])

  useEffect(() => {
    if (!visible || activeTab !== 'knowledge') return
    void storage.listNoteDocuments().then(setKnowledgeDocuments).catch(error => setKnowledgeAnswer(`${t.ai.error}: ${error instanceof Error ? error.message : String(error)}`))
  }, [activeTab, t.ai.error, visible])

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

  const handleKnowledgeSearch = async () => {
    if (!input.trim()) return
    setLoading(true)
    setKnowledgeAnswer('')
    try { setKnowledgeResults(await semanticSearchNotes(input, knowledgeDocuments)) }
    catch (error) { setKnowledgeAnswer(`${t.ai.error}: ${error instanceof Error ? error.message : String(error)}`) }
    setLoading(false)
  }

  const handleKnowledgeQuestion = async () => {
    if (!input.trim() || !aiEnabled) return
    setLoading(true)
    setKnowledgeAnswer('')
    try { setKnowledgeAnswer(await askKnowledgeBase(input, knowledgeDocuments)) }
    catch (error) { setKnowledgeAnswer(`${t.ai.error}: ${error instanceof Error ? error.message : String(error)}`) }
    setLoading(false)
  }

  const insertToNote = (text: string) => {
    const selectedEditor = document.querySelector<HTMLElement>('[data-editor-active="true"]')
    if (!selectedEditor) return

    if (selectedEditor instanceof HTMLTextAreaElement) {
      const start = selectedEditor.selectionStart
      const end = selectedEditor.selectionEnd
      selectedEditor.focus()
      selectedEditor.setSelectionRange(start, end)
      if (document.execCommand('insertText', false, text)) return
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
    selection?.removeAllRanges()
    selection?.addRange(range)
    if (document.execCommand('insertText', false, text)) return
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
          <button className={`ai-tab ${activeTab === 'knowledge' ? 'active' : ''}`} onClick={() => setActiveTab('knowledge')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/><path d="M8 11h6M11 8v6"/></svg>
            <span>{locale === 'zh' ? '知识库' : 'Knowledge'}</span>
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
                <div
                  className="ai-output-content ai-markdown"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(output, settings.showCodeLangLabel) }}
                />
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
                  {msg.role === 'assistant' ? (
                    <div
                      className="ai-chat-bubble ai-markdown"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content, settings.showCodeLangLabel) }}
                    />
                  ) : (
                    <div className="ai-chat-bubble">{msg.content}</div>
                  )}
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

        {activeTab === 'knowledge' && (
          <div className="ai-knowledge">
            <textarea className="ai-textarea" value={input} onChange={event => setInput(event.target.value)} placeholder={locale === 'zh' ? '搜索笔记，或向全部笔记提问…' : 'Search notes, or ask all notes…'} rows={3}/>
            <div className="ai-complete-actions">
              <button className="ai-btn ai-btn-primary" disabled={loading || !input.trim()} onClick={() => { void handleKnowledgeSearch() }}>{locale === 'zh' ? '语义搜索' : 'Semantic search'}</button>
              <button className="ai-btn" disabled={loading || !input.trim() || !aiEnabled} onClick={() => { void handleKnowledgeQuestion() }}>{locale === 'zh' ? '询问全部笔记' : 'Ask all notes'}</button>
            </div>
            {!aiEnabled && <p className="ai-hint">{locale === 'zh' ? '本地语义搜索可直接使用；配置 AI 后可进行跨笔记问答。' : 'Local semantic search works now; configure AI for cross-note Q&A.'}</p>}
            <div className="ai-knowledge-results">
              {knowledgeResults.map(result => <button key={result.filename} onClick={() => onOpenNote?.(result.filename)}><strong>{result.title}</strong><small>{result.content.replace(/\s+/g, ' ').slice(0, 150)}</small></button>)}
            </div>
            {knowledgeAnswer && <div className="ai-output-content ai-markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(knowledgeAnswer, settings.showCodeLangLabel) }}/>}
          </div>
        )}
      </div>
    </div>
  )
}
