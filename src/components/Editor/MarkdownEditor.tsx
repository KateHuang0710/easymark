import React, { useRef, useCallback, useEffect, useState, useMemo } from 'react'
import { renderMarkdown, highlightMarkdown } from '../../services/markdown'
import { useTranslation } from '../../i18n'
import TurndownService from 'turndown'
import { SearchReplace } from './SearchReplace'
import { OutlinePanel } from './OutlinePanel'
import { ContextMenu, useEditorContextMenu } from './ContextMenu'
import { InlineSuggestion } from './InlineSuggestion'
import { getInlineCompletion, isConfigured } from '../../services/ai'
import { useSettings } from '../../contexts/SettingsContext'

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
  bulletListMarker: '-',
})

turndown.addRule('codeblock', {
  filter: ['pre'],
  replacement: (_content: string, node: HTMLElement) => {
    const code = node.querySelector('code')
    let lang = node.getAttribute('data-lang') || ''
    if (!lang && code) {
      lang = (code.className || '').replace(/^language-/, '')
    }
    // Use innerText instead of textContent to preserve <br> as newlines
    const text = node.innerText || node.textContent || ''
    return '```' + lang + '\n' + text + '\n```\n\n'
  },
})

interface MarkdownEditorProps {
  content: string
  onChange: (content: string) => void
  onSave: (content: string) => void | Promise<void>
  readOnly?: boolean
  onSplitRight?: () => void
  onExport?: () => void
  onSearchAll?: () => void
  onReadingMode?: () => void
  dualPaneMode?: boolean
}

type Tab = 'edit' | 'source' | 'preview'

const AUTO_PAIRS: Record<string, string> = {
  '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`',
}

function countWords(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

function getCaretOffset(root: HTMLElement): number {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return 0
  const range = sel.getRangeAt(0)
  const pre = document.createRange()
  pre.selectNodeContents(root)
  pre.setEnd(range.startContainer, range.startOffset)
  return pre.toString().length
}

function setCaretByOffset(root: HTMLElement, offset: number) {
  const sel = window.getSelection()
  if (!sel) return
  let charCount = 0
  let target: { node: Node; offset: number } | null = null

  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
  while (walk.nextNode()) {
    const len = (walk.currentNode.textContent || '').length
    if (charCount + len >= offset) {
      target = { node: walk.currentNode, offset: offset - charCount }
      break
    }
    charCount += len
  }
  if (!target && walk.currentNode) {
    const last = walk.currentNode
    target = { node: last, offset: (last.textContent || '').length }
  }
  if (target) {
    try {
      const range = document.createRange()
      range.setStart(target.node, Math.min(target.offset, (target.node.textContent || '').length))
      range.collapse(true)
      sel.removeAllRanges()
      sel.addRange(range)
    } catch {}
  }
}

function selectionIsInside(root: HTMLElement | null, range?: Range): boolean {
  if (!root) return false
  const selection = window.getSelection()
  const activeRange = range || (selection?.rangeCount ? selection.getRangeAt(0) : undefined)
  return Boolean(activeRange && (activeRange.commonAncestorContainer === root || root.contains(activeRange.commonAncestorContainer)))
}

function insertTextAtCursor(text: string) {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return
  const range = sel.getRangeAt(0)
  range.deleteContents()
  const textNode = document.createTextNode(text)
  range.insertNode(textNode)
  const newRange = document.createRange()
  newRange.setStartAfter(textNode)
  newRange.collapse(true)
  sel.removeAllRanges()
  sel.addRange(newRange)
}


function markEditorActive(element: HTMLElement) {
  document.querySelectorAll<HTMLElement>('[data-editor-active="true"]').forEach(active => {
    if (active !== element) active.removeAttribute('data-editor-active')
  })
  element.setAttribute('data-editor-active', 'true')
}

function selToString(): string {
  const sel = window.getSelection()
  return sel && sel.rangeCount > 0 ? sel.toString() : ''
}

export function MarkdownEditor({ content, onChange, onSave, readOnly, onSplitRight, onExport, onSearchAll, onReadingMode, dualPaneMode }: MarkdownEditorProps) {
  const { t } = useTranslation()
  const editorRef = useRef<HTMLDivElement>(null)
  const [viewMode, setViewMode] = useState<Tab>('edit')
  const skipNextRender = useRef(false)
  const contentRef = useRef(content)
  const pendingContent = useRef('')
  const composingRef = useRef(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    return () => { mountedRef.current = false }
  }, [])
  const overlayRef = useRef<HTMLPreElement>(null)
  const sourceTaRef = useRef<HTMLTextAreaElement>(null)
  const [searchVisible, setSearchVisible] = useState(false)
  const [outlineVisible, setOutlineVisible] = useState(false)
  const [showLangPicker, setShowLangPicker] = useState(false)
  const [langFilter, setLangFilter] = useState('')
  const langPickerRef = useRef<HTMLDivElement>(null)
  const { settings } = useSettings()

  const COMMON_LANGS = [
    'python', 'javascript', 'typescript', 'html', 'css', 'cpp', 'c',
    'java', 'go', 'rust', 'swift', 'kotlin', 'php', 'ruby',
    'sql', 'bash', 'json', 'xml', 'yaml', 'markdown', 'dockerfile',
    'graphql', 'latex', 'powershell', 'r', 'scala', 'solidity',
  ]

  // Close language picker on outside click
  useEffect(() => {
    if (!showLangPicker) return
    const handler = (e: MouseEvent) => {
      if (langPickerRef.current && !langPickerRef.current.contains(e.target as Node)) {
        setShowLangPicker(false)
        setLangFilter('')
      }
    }
    setTimeout(() => document.addEventListener('mousedown', handler), 0)
    return () => document.removeEventListener('mousedown', handler)
  }, [showLangPicker])

  const inlineAiEnabled = isConfigured() && settings.aiInlineCompletion

  const wrapSelection = useCallback((before: string, after: string) => {
    const sel = window.getSelection()
    if (!sel || !sel.rangeCount) return false
    const text = sel.toString()
    const range = sel.getRangeAt(0)
    range.deleteContents()
    const full = document.createTextNode(before + text + after)
    range.insertNode(full)
    const newRange = document.createRange()
    newRange.setStart(full, before.length)
    newRange.setEnd(full, before.length + text.length)
    sel.removeAllRanges()
    sel.addRange(newRange)
    return true
  }, [])

  const getMarkdown = useCallback((): string => {
    if (!editorRef.current) return contentRef.current
    try {
      const html = editorRef.current.innerHTML
      return turndown.turndown(html)
    } catch {
      return editorRef.current.innerText || contentRef.current
    }
  }, [])

  const emitChange = useCallback(() => {
    if (!editorRef.current || composingRef.current) return
    const md = getMarkdown()
    if (md === contentRef.current) return
    skipNextRender.current = true
    pendingContent.current = md
    onChange(md)
  }, [getMarkdown, onChange])

  function execFormatTag(tagName: string): boolean {
    const sel = window.getSelection()
    if (!sel || !sel.rangeCount) return false
    const text = sel.toString()
    if (!text) return false
    const range = sel.getRangeAt(0)
    const contents = range.extractContents()
    const wrapper = document.createElement(tagName)
    wrapper.appendChild(contents)
    range.insertNode(wrapper)
    const newRange = document.createRange()
    newRange.selectNodeContents(wrapper)
    sel.removeAllRanges()
    sel.addRange(newRange)
    return true
  }

  function execFormatBlock(tagName: string): boolean {
    const sel = window.getSelection()
    if (!sel || !sel.rangeCount) return false
    const node = sel.anchorNode
    if (!node) return false
    const block = node.nodeType === Node.ELEMENT_NODE
      ? (node as HTMLElement).closest('p,li,h1,h2,h3,h4,h5,h6,div')
      : node.parentElement?.closest('p,li,h1,h2,h3,h4,h5,h6,div')
    if (block) {
      const wrapper = document.createElement(tagName)
      wrapper.innerHTML = block.innerHTML
      block.parentNode?.replaceChild(wrapper, block)
      const newRange = document.createRange()
      newRange.selectNodeContents(wrapper)
      newRange.collapse(false)
      sel.removeAllRanges()
      sel.addRange(newRange)
      return true
    }
    return false
  }

  function execList(type: 'ul' | 'ol'): boolean {
    const sel = window.getSelection()
    if (!sel || !sel.rangeCount) return false
    const node = sel.anchorNode
    if (!node) return false
    const block = node.nodeType === Node.ELEMENT_NODE
      ? (node as HTMLElement).closest('p,li,h1,h2,h3,h4,h5,h6,div')
      : node.parentElement?.closest('p,li,h1,h2,h3,h4,h5,h6,div')
    if (block) {
      const list = document.createElement(type)
      const li = document.createElement('li')
      li.innerHTML = block.innerHTML
      list.appendChild(li)
      block.parentNode?.replaceChild(list, block)
      const newRange = document.createRange()
      newRange.setStart(li, 0)
      newRange.collapse(true)
      sel.removeAllRanges()
      sel.addRange(newRange)
      return true
    }
    return false
  }

  const execFormat = useCallback((cmd: string, val?: string) => {
    const el = editorRef.current
    if (!selectionIsInside(el)) {
      el?.focus()
      return
    }
    switch (cmd) {
      case 'bold':
        execFormatTag('strong')
        break
      case 'italic':
        execFormatTag('em')
        break
      case 'strikeThrough':
        execFormatTag('s')
        break
      case 'underline':
        execFormatTag('u')
        break
      case 'formatBlock':
        if (val) execFormatBlock(val.replace(/[<>]/g, ''))
        break
      case 'insertUnorderedList':
        execList('ul')
        break
      case 'insertOrderedList':
        execList('ol')
        break
      case 'insertText':
        if (val) insertTextAtCursor(val)
        break
      case 'cut':
        if (selToString()) {
          navigator.clipboard.writeText(window.getSelection()!.toString()).catch(() => {})
          const r = window.getSelection()?.getRangeAt(0)
          r?.deleteContents()
        }
        break
      case 'copy':
        if (selToString()) {
          navigator.clipboard.writeText(window.getSelection()!.toString()).catch(() => {})
        }
        break
      case 'undo':
        document.execCommand('undo')
        return
      case 'redo':
        document.execCommand('redo')
        return
      default:
        // Fallback for unsupported commands
        return
    }
    emitChange()
    el?.focus()
  }, [emitChange, editorRef])

  const insertMarkdown = useCallback((before: string, after: string = '') => {
    if (!selectionIsInside(editorRef.current)) {
      editorRef.current?.focus()
      return
    }
    if (wrapSelection(before, after)) {
      emitChange()
    } else {
      insertTextAtCursor(before + after)
      emitChange()
    }
    editorRef.current?.focus()
  }, [emitChange, wrapSelection])

  const handleCodeBlockClick = useCallback(() => {
    // Insert code block immediately with no language
    const sel = window.getSelection()
    if (!sel || !sel.rangeCount) return
    const range = sel.getRangeAt(0)
    if (!selectionIsInside(editorRef.current, range)) { editorRef.current?.focus(); return }
    const pre = document.createElement('pre')
    pre.setAttribute('data-lang', '')
    const code = document.createElement('code')
    code.className = 'hljs'
    code.textContent = '\n'
    pre.appendChild(code)
    range.deleteContents()
    range.insertNode(pre)
    const newRange = document.createRange()
    newRange.setStart(code, 0)
    newRange.collapse(true)
    sel.removeAllRanges()
    sel.addRange(newRange)
    editorRef.current?.focus()
    emitChange()
  }, [emitChange, editorRef])

  const handleLangSelect = useCallback((lang: string) => {
    setShowLangPicker(false)
    setLangFilter('')
    const sel = window.getSelection()
    if (!sel || !sel.rangeCount) return
    const range = sel.getRangeAt(0)
    if (!selectionIsInside(editorRef.current, range)) { editorRef.current?.focus(); return }
    // Create pre element with proper structure
    const pre = document.createElement('pre')
    pre.setAttribute('data-lang', lang)
    const code = document.createElement('code')
    code.className = `hljs language-${lang}`
    code.textContent = '\n'
    pre.appendChild(code)
    range.deleteContents()
    range.insertNode(pre)
    // Move cursor inside the code block
    const newRange = document.createRange()
    newRange.setStart(code, 0)
    newRange.collapse(true)
    sel.removeAllRanges()
    sel.addRange(newRange)
    editorRef.current?.focus()
    emitChange()
  }, [emitChange, editorRef])

  const { menu: ctxMenu, handleContextMenu, closeMenu } = useEditorContextMenu(
    editorRef, execFormat, insertMarkdown, emitChange,
    () => setSearchVisible(true)
  )

  const getTextBeforeCursor = useCallback((): string => {
    if (!editorRef.current) return ''
    const offset = getCaretOffset(editorRef.current)
    const text = editorRef.current.textContent || ''
    const contextLines = text.substring(0, offset).split('\n')
    return contextLines.slice(-3).join('\n')
  }, [])

  const handleInlineAccept = useCallback((suggestion: string) => {
    if (!editorRef.current) return
    const sel = window.getSelection()
    if (!sel || !sel.rangeCount) return
    const range = sel.getRangeAt(0)
    if (!selectionIsInside(editorRef.current, range)) return
    range.deleteContents()
    const textNode = document.createTextNode(suggestion)
    range.insertNode(textNode)
    const newRange = document.createRange()
    newRange.setStart(textNode, suggestion.length)
    newRange.collapse(true)
    sel.removeAllRanges()
    sel.addRange(newRange)
    emitChange()
    editorRef.current.focus()
  }, [emitChange])

  contentRef.current = content

  useEffect(() => {
    if (!editorRef.current || viewMode !== 'edit') return
    if (skipNextRender.current) {
      skipNextRender.current = false
      if (content === pendingContent.current) {
        pendingContent.current = ''
        return
      }
      pendingContent.current = ''
    }
    const el = editorRef.current
    const saved = getCaretOffset(el)
    const html = renderMarkdown(content)
    if (el.innerHTML !== html) {
      el.innerHTML = html
      try { setCaretByOffset(el, saved) } catch {}
    }
  }, [content, viewMode])

  const handleSave = useCallback(() => {
    void Promise.resolve(onSave(contentRef.current)).catch(error => console.error('Failed to save note:', error))
  }, [onSave])

  const insertBlock = useCallback((tag: string) => {
    if (['h4', 'h5', 'h6'].includes(tag) && editorRef.current) {
      // h4-h6 use manual DOM manipulation
      const sel = window.getSelection()
      if (!sel || !sel.rangeCount) return
      const node = sel.anchorNode
      if (!node || !selectionIsInside(editorRef.current, sel.getRangeAt(0))) return
      const block = node.nodeType === Node.ELEMENT_NODE
        ? (node as HTMLElement).closest('p,li,h1,h2,h3,h4,h5,h6,div')
        : node.parentElement?.closest('p,li,h1,h2,h3,h4,h5,h6,div')
      if (block) {
        const heading = document.createElement(tag)
        heading.innerHTML = block.innerHTML
        block.parentNode?.replaceChild(heading, block)
        const range = document.createRange()
        range.selectNodeContents(heading)
        range.collapse(false)
        sel.removeAllRanges()
        sel.addRange(range)
        emitChange()
      }
    } else {
      execFormat('formatBlock', `<${tag}>`)
    }
  }, [execFormat, emitChange, editorRef])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey) {
      switch (e.key) {
        case 's':
          e.preventDefault(); handleSave(); return
        case 'b':
          e.preventDefault(); execFormat('bold'); return
        case 'i':
          e.preventDefault(); execFormat('italic'); return
        case 'u':
          e.preventDefault(); execFormat('underline'); return
        case 'k':
          e.preventDefault()
          const sel = window.getSelection()
          const text = sel?.toString() || ''
          const url = prompt('Enter URL:', 'https://')
          if (url) {
            if (text) {
              const sel = window.getSelection()
              if (sel?.rangeCount) {
                const range = sel.getRangeAt(0)
                range.deleteContents()
                const node = document.createTextNode(`[${text}](${url})`)
                range.insertNode(node)
                range.setStartAfter(node)
                range.collapse(true)
                sel.removeAllRanges()
                sel.addRange(range)
                emitChange()
                return
              }
            }
            insertTextAtCursor(`[link](${url})`)
            emitChange()
          }
          return
        case 'z':
          e.preventDefault(); document.execCommand(e.shiftKey ? 'redo' : 'undo'); return
        case '1': case '2': case '3': case '4': case '5': case '6':
          e.preventDefault()
          const hLevel = parseInt(e.key)
          insertBlock(`h${hLevel}`)
          return
        case '/':
          e.preventDefault()
          setViewMode(prev => prev === 'edit' ? 'source' : prev === 'source' ? 'preview' : 'edit')
          return
      }
      if (e.shiftKey && e.key === '`') {
        e.preventDefault()
        const codeText = window.getSelection()?.toString() || ''
        if (codeText) {
          if (wrapSelection('`', '`')) { emitChange(); return }
        } else {
          insertBlock('pre')
        }
        return
      }
      if (e.shiftKey && e.key === 'C') {
        e.preventDefault()
        insertBlock('pre')
        return
      }
      if (e.key === 'f') {
        e.preventDefault()
        setSearchVisible(prev => !prev)
        return
      }
    }

    if (e.altKey && e.shiftKey && e.key === '5') {
      e.preventDefault()
      execFormat('strikeThrough')
      return
    }

    if (e.key === 'Tab') {
      e.preventDefault()
      execFormat('insertText', '    ')
      return
    }

    if (e.key === 'Enter') {
      const sel = window.getSelection()
      if (!sel || !sel.rangeCount) return
      const node = sel.anchorNode
      if (node) {
        const pre = node.nodeType === Node.ELEMENT_NODE
          ? (node as HTMLElement).closest('pre')
          : node.parentElement?.closest('pre')
        if (pre) {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault()
            const p = document.createElement('p')
            p.innerHTML = '<br>'
            pre.parentNode?.insertBefore(p, pre.nextSibling)
            const range = document.createRange()
            range.setStart(p, 0)
            range.collapse(true)
            sel.removeAllRanges()
            sel.addRange(range)
            emitChange()
          } else {
            e.preventDefault()
            const range = sel.getRangeAt(0)
            range.deleteContents()
            const br = document.createElement('br')
            range.insertNode(br)
            range.setStartAfter(br)
            range.collapse(true)
            sel.removeAllRanges()
            sel.addRange(range)
            emitChange()
          }
          return
        }
        const li = node.nodeType === Node.ELEMENT_NODE
          ? (node as HTMLElement).closest('li')
          : node.parentElement?.closest('li')
        if (li) {
          emitChange()
          return
        }
        const h = node.nodeType === Node.ELEMENT_NODE
          ? (node as HTMLElement).closest('h1,h2,h3,h4,h5,h6')
          : node.parentElement?.closest('h1,h2,h3,h4,h5,h6')
        if (h && sel.anchorOffset === (sel.anchorNode?.textContent?.length || 0)) {
          e.preventDefault()
          const p = document.createElement('p')
          p.innerHTML = '<br>'
          h.parentNode?.insertBefore(p, h.nextSibling)
          const range = document.createRange()
          range.setStart(p, 0)
          range.collapse(true)
          sel.removeAllRanges()
          sel.addRange(range)
          emitChange()
          return
        }
      }
      return
    }

    if (e.key === 'Backspace') {
      const sel = window.getSelection()
      if (!sel || !sel.rangeCount || sel.anchorOffset !== 0) return
      const node = sel.anchorNode
      if (!node) return
      const el = node.nodeType === Node.ELEMENT_NODE
        ? (node as HTMLElement).closest('li,p,h1,h2,h3,h4,h5,h6,blockquote,pre')
        : node.parentElement?.closest('li,p,h1,h2,h3,h4,h5,h6,blockquote,pre')
      if (el && !el.textContent?.trim()) {
        const parent = el.parentElement
        if (parent) {
          const prev = el.previousElementSibling
          if (prev) {
            e.preventDefault()
            const prevEnd = document.createRange()
            prevEnd.selectNodeContents(prev)
            prevEnd.collapse(false)
            const sel2 = window.getSelection()
            sel2?.removeAllRanges()
            sel2?.addRange(prevEnd)
            el.remove()
            emitChange()
          }
        }
      }
    }

    if ((e.key === '(' || e.key === '[' || e.key === '"' || e.key === "'" || e.key === '`' || e.key === '{') && !e.ctrlKey && !e.metaKey) {
      const pair = AUTO_PAIRS[e.key]
      if (pair && pair !== e.key) {
        e.preventDefault()
        insertTextAtCursor(e.key + pair)
        const sel = window.getSelection()
        if (sel && sel.rangeCount) {
          const range = sel.getRangeAt(0)
          range.setStart(range.startContainer, range.startOffset - 1)
          range.collapse(true)
          sel.removeAllRanges()
          sel.addRange(range)
        }
        return
      }
    }

  }, [handleSave, emitChange, execFormat, insertBlock, wrapSelection])

  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (!file) return
        const editor = editorRef.current
        const selection = window.getSelection()
        if (!editor || !selection || !selection.rangeCount) return
        const range = selection.getRangeAt(0)
        if (!selectionIsInside(editor, range)) return

        // Preserve the exact paste location across the asynchronous disk write.
        // A DOM comment is ignored by Turndown and cannot become executable HTML.
        const marker = document.createComment('easymark-image-paste')
        range.deleteContents()
        range.insertNode(marker)
        const afterMarker = document.createRange()
        afterMarker.setStartAfter(marker)
        afterMarker.collapse(true)
        selection.removeAllRanges()
        selection.addRange(afterMarker)

        const reader = new FileReader()
        reader.onload = async () => {
          if (!mountedRef.current) { marker.remove(); return }
          const dataUrl = reader.result as string
          try {
            const result = await window.electronAPI.saveImage(dataUrl)
            if (!marker.isConnected || !editorRef.current?.contains(marker)) return
            const markdownImg = document.createTextNode(`\n![image](${result.filename})\n`)
            marker.parentNode?.insertBefore(markdownImg, marker)
            marker.remove()
            emitChange()
          } catch (err) {
            marker.remove()
            console.error('Failed to save image:', err)
            alert('Failed to save image: ' + (err instanceof Error ? err.message : 'Unknown error'))
          }
        }
        reader.onerror = () => marker.remove()
        reader.readAsDataURL(file)
        return
      }
    }

    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    const html = e.clipboardData.getData('text/html')
    if (html) {
      const temp = document.createElement('div')
      temp.innerHTML = html
      const plainText = temp.textContent || text
      insertTextAtCursor(plainText)
    } else {
      insertTextAtCursor(text)
    }
    emitChange()
  }, [emitChange])

  const handleCompositionStart = useCallback(() => { composingRef.current = true }, [])
  const handleCompositionEnd = useCallback(() => {
    composingRef.current = false
    emitChange()
  }, [emitChange])

  const wordCount = useMemo(() => countWords(content), [content])
  const lineCount = useMemo(() => content.split('\n').length, [content])

  if (viewMode === 'preview') {
    return (
      <div className="editor-container">
        <div className="editor-toolbar">
          <div className="editor-toolbar-group">
            <button className="editor-tb-btn" onClick={() => setViewMode('edit')} title={t.editor.edit}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              <span>{t.editor.edit}</span>
            </button>
          </div>
          <div className="editor-toolbar-spacer" />
          <span className="editor-mode-label">{t.editor.preview}</span>
          <div className="editor-toolbar-end">
            <span className="editor-status">{wordCount} {t.editor.words} · {lineCount} {t.editor.lines}</span>
          </div>
        </div>
        <div
          className="editor-content editor-preview"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
        />
      </div>
    )
  }

  if (viewMode === 'source') {
    const handleSourceChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange(e.target.value)
    }

    const handleSourceKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Tab') {
        e.preventDefault()
        const ta = e.currentTarget
        const start = ta.selectionStart
        const end = ta.selectionEnd
        const val = ta.value
        ta.value = val.substring(0, start) + '  ' + val.substring(end)
        ta.selectionStart = ta.selectionEnd = start + 2
        onChange(ta.value)
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
        return
      }
    }

    const handleSourceScroll = () => {
      if (overlayRef.current && sourceTaRef.current) {
        overlayRef.current.scrollTop = sourceTaRef.current.scrollTop
        overlayRef.current.scrollLeft = sourceTaRef.current.scrollLeft
      }
    }

    return (
      <div className="editor-container">
        <div className="editor-toolbar">
          <div className="editor-toolbar-group">
            <button className="editor-tb-btn" onClick={() => setViewMode('edit')} title={t.editor.edit}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
          </div>
          <div className="editor-toolbar-spacer" />
          <span className="editor-mode-label">{t.editor.source}</span>
          <div className="editor-toolbar-end">
            <span className="editor-status">{wordCount} {t.editor.words} · {lineCount} {t.editor.lines}</span>
          </div>
        </div>
        <div className="editor-source-content-wrapper">
          <div className="editor-source-container">
            <pre ref={overlayRef} className="editor-source-overlay" aria-hidden="true"
              dangerouslySetInnerHTML={{ __html: highlightMarkdown(content) }} />
            <textarea
              ref={sourceTaRef}
              className="editor-source-textarea"
              value={content}
              onChange={handleSourceChange}
              onKeyDown={handleSourceKeyDown}
              onScroll={handleSourceScroll}
              onFocus={e => markEditorActive(e.currentTarget)}
              spellCheck={false}
              placeholder={t.editor.placeholder}
            />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="editor-container">
      <div className="editor-toolbar">
        <div className="editor-toolbar-group">
          <button className="editor-tb-btn" onClick={() => execFormat('bold')} title={t.editor.bold}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M15.6 10.79c.97-.67 1.65-1.77 1.65-2.79 0-2.26-1.75-4-4-4H7v14h7.04c2.09 0 3.71-1.7 3.71-3.79 0-1.52-.86-2.82-2.15-3.42zM10 6.5h3c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-3v-3zm3.5 9H10v-3h3.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5z"/></svg>
          </button>
          <button className="editor-tb-btn" onClick={() => execFormat('italic')} title={t.editor.italic}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4v3h2.21l-3.42 8H6v3h8v-3h-2.21l3.42-8H18V4z"/></svg>
          </button>
          <button className="editor-tb-btn" onClick={() => execFormat('strikeThrough')} title={t.editor.strikethrough}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 12h12M3 5l3 2M18 5l-3 2M5 19l3-2M19 19l-3-2"/></svg>
          </button>
          <button className="editor-tb-btn" onClick={() => insertMarkdown('`', '`')} title={t.editor.inlineCode}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
          </button>
        </div>
        <div className="editor-toolbar-divider" />
        <div className="editor-toolbar-group">
          <button className="editor-tb-btn editor-tb-label" onClick={() => insertBlock('h1')} title={t.editor.heading1}>H1</button>
          <button className="editor-tb-btn editor-tb-label" onClick={() => insertBlock('h2')} title={t.editor.heading2}>H2</button>
          <button className="editor-tb-btn editor-tb-label" onClick={() => insertBlock('h3')} title={t.editor.heading3}>H3</button>
        </div>
        <div className="editor-toolbar-divider" />
        <div className="editor-toolbar-group">
          <button className="editor-tb-btn" onClick={() => execFormat('insertUnorderedList')} title={t.editor.bulletList}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>
          </button>
          <button className="editor-tb-btn" onClick={() => execFormat('insertOrderedList')} title={t.editor.numberedList}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/></svg>
          </button>
          <button className="editor-tb-btn" onClick={() => insertBlock('blockquote')} title={t.editor.blockquote}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z"/></svg>
          </button>
          <div className="editor-tb-btn-wrap" ref={langPickerRef}>
            <button className="editor-tb-btn" onClick={handleCodeBlockClick} title={t.editor.codeBlock}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
            </button>
            {showLangPicker && (
              <div className="lang-picker">
                <div className="lang-picker-header">
                  <input
                    className="lang-picker-input"
                    type="text"
                    value={langFilter}
                    onChange={e => setLangFilter(e.target.value)}
                    placeholder="Filter languages..."
                    autoFocus
                    onKeyDown={e => {
                      if (e.key === 'Escape') { setShowLangPicker(false); setLangFilter('') }
                      if (e.key === 'Enter' && langFilter.trim()) {
                        handleLangSelect(langFilter.trim().toLowerCase())
                      }
                    }}
                  />
                </div>
                <div className="lang-picker-list">
                  {COMMON_LANGS
                    .filter(l => !langFilter || l.includes(langFilter.toLowerCase()))
                    .map(lang => (
                      <button
                        key={lang}
                        className="lang-picker-item"
                        onClick={() => handleLangSelect(lang)}
                        onMouseDown={e => e.preventDefault()}
                      >
                        {lang}
                      </button>
                    ))}
                  {langFilter.trim() && !COMMON_LANGS.includes(langFilter.trim().toLowerCase()) && (
                    <button
                      className="lang-picker-item lang-picker-custom"
                      onClick={() => handleLangSelect(langFilter.trim().toLowerCase())}
                      onMouseDown={e => e.preventDefault()}
                    >
                      + {langFilter.trim().toLowerCase()}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="editor-toolbar-divider" />
        <div className="editor-toolbar-group">
          <button className="editor-tb-btn" onClick={() => {
            const url = prompt('Enter URL:', 'https://')
            if (url) {
              const sel = window.getSelection()
              const text = sel?.toString() || 'link'
              const md = `[${text}](${url})`
              insertTextAtCursor(md)
              emitChange()
              editorRef.current?.focus()
            }
          }} title={t.editor.insertLink}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          </button>
        </div>
        <div className="editor-toolbar-spacer" />
        <div className="editor-toolbar-end">
          {!dualPaneMode && onSplitRight && (
            <button className="editor-tb-btn" onClick={onSplitRight} title={t.editor.splitRight}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="18" rx="1"/><rect x="14" y="3" width="7" height="18" rx="1"/>
              </svg>
            </button>
          )}
          {onSearchAll && (
            <button className="editor-tb-btn" onClick={onSearchAll} title={t.editor.searchAll}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </button>
          )}
          {onExport && (
            <button className="editor-tb-btn" onClick={onExport} title={t.editor.export}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            </button>
          )}
          {onReadingMode && (
            <button className="editor-tb-btn" onClick={onReadingMode} title={t.editor.readingMode}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
              </svg>
            </button>
          )}
          <div className="editor-toolbar-divider" />
          <button
            className={`editor-mode-btn ${outlineVisible ? 'active' : ''}`}
            onClick={() => setOutlineVisible(prev => !prev)} title={t.editor.outline}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
            </svg>
          </button>
          <div className="editor-toolbar-divider" />
          <button
            className="editor-mode-btn active"
            onClick={() => setViewMode('edit')} title={`${t.editor.edit} (Ctrl+/)`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
          <button
            className="editor-mode-btn"
            onClick={() => setViewMode('source')} title={`${t.editor.source} (Ctrl+/)`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
            </svg>
          </button>
          <button
            className="editor-mode-btn"
            onClick={() => setViewMode('preview')} title={`${t.editor.preview} (Ctrl+/)`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        </div>
      </div>

      <SearchReplace
        editorRef={editorRef}
        getMarkdown={getMarkdown}
        onChange={onChange}
        visible={searchVisible}
        onClose={() => setSearchVisible(false)}
      />
      <div className="editor-body">
        <OutlinePanel
          content={content}
          editorRef={editorRef}
          visible={outlineVisible}
          onClose={() => setOutlineVisible(false)}
        />
        <div className={`editor-content-wrapper ${viewMode === 'edit' ? '' : 'hidden'}`} style={{ position: 'relative' }}>
        <div
          ref={editorRef}
          className="editor-content editor-wysiwyg"
          contentEditable={!readOnly}
          onInput={emitChange}
          onFocus={e => markEditorActive(e.currentTarget)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onBlur={handleSave}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          onContextMenu={handleContextMenu}
          suppressContentEditableWarning
          data-placeholder={t.editor.placeholder}
        />
        <InlineSuggestion
          editorRef={editorRef}
          getTextBeforeCursor={getTextBeforeCursor}
          onAccept={handleInlineAccept}
          enabled={inlineAiEnabled}
          getSuggestion={getInlineCompletion}
        />
      </div>
      {ctxMenu && (
        <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxMenu.items} onClose={closeMenu} />
      )}
      </div>

      <div className="editor-statusbar">
        <span className="editor-status-item">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
          </svg>
          {wordCount} {t.editor.words || 'words'}
        </span>
        <span className="editor-status-item">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
          </svg>
          {lineCount} {t.editor.lines || 'lines'}
        </span>
        <span className="editor-status-spacer" />
        {inlineAiEnabled && <span className="editor-status-item editor-status-ai">AI</span>}
        <span className="editor-status-item editor-status-markdown">Markdown</span>
      </div>
    </div>
  )
}
