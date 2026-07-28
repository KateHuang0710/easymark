import React, { useEffect, useMemo, useRef, useState } from 'react'
import { NoteSummary } from '../types'
import { useTranslation } from '../i18n'

export type AppCommand = 'new-note' | 'open-markdown' | 'search-all' | 'toggle-ai' | 'share-note' | 'export-note' | 'git-panel' | 'toggle-pin' | 'toggle-favorite'

interface CommandPaletteProps {
  visible: boolean
  notes: NoteSummary[]
  onClose: () => void
  onOpenNote: (note: NoteSummary) => void
  onCommand: (command: AppCommand) => void
}

export function CommandPalette({ visible, notes, onClose, onOpenNote, onCommand }: CommandPaletteProps) {
  const { locale } = useTranslation()
  const isZh = locale === 'zh'
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const commands = useMemo(() => [
    { id: 'new-note' as const, label: isZh ? '新建笔记' : 'New note', shortcut: '⌘N' },
    { id: 'open-markdown' as const, label: isZh ? '打开 Markdown 文件' : 'Open Markdown file', shortcut: '⌘O' },
    { id: 'search-all' as const, label: isZh ? '搜索全部笔记' : 'Search all notes', shortcut: '⌘⇧F' },
    { id: 'toggle-ai' as const, label: isZh ? '打开 AI 助手' : 'Open AI assistant', shortcut: '⌘⇧A' },
    { id: 'toggle-favorite' as const, label: isZh ? '收藏/取消收藏当前笔记' : 'Toggle current favorite', shortcut: '' },
    { id: 'toggle-pin' as const, label: isZh ? '置顶/取消置顶当前笔记' : 'Toggle current pin', shortcut: '' },
    { id: 'share-note' as const, label: isZh ? '系统分享当前笔记' : 'Share current note', shortcut: '⌘⇧E' },
    { id: 'export-note' as const, label: isZh ? '导出当前笔记' : 'Export current note', shortcut: '' },
    { id: 'git-panel' as const, label: isZh ? 'Git 版本管理' : 'Git version control', shortcut: '' },
  ], [isZh])

  const items = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    const matchingNotes = notes
      .filter(note => !normalized || note.title.toLocaleLowerCase().includes(normalized))
      .sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0))
      .slice(0, 8)
      .map(note => ({ type: 'note' as const, note, label: note.title, shortcut: note.pinned ? '⌖' : note.favorite ? '★' : '' }))
    const matchingCommands = commands
      .filter(command => !normalized || command.label.toLocaleLowerCase().includes(normalized))
      .map(command => ({ type: 'command' as const, command: command.id, label: command.label, shortcut: command.shortcut }))
    return [...matchingNotes, ...matchingCommands]
  }, [commands, notes, query])

  useEffect(() => {
    if (!visible) return
    setQuery('')
    setActiveIndex(0)
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }, [visible])

  useEffect(() => setActiveIndex(index => Math.min(index, Math.max(items.length - 1, 0))), [items.length])

  if (!visible) return null

  const activate = (index: number) => {
    const item = items[index]
    if (!item) return
    onClose()
    if (item.type === 'note') onOpenNote(item.note)
    else onCommand(item.command)
  }

  return (
    <div className="command-palette-overlay" onMouseDown={onClose}>
      <div className="command-palette" role="dialog" aria-modal="true" onMouseDown={event => event.stopPropagation()}>
        <input
          ref={inputRef}
          className="command-palette-input"
          value={query}
          onChange={event => { setQuery(event.target.value); setActiveIndex(0) }}
          placeholder={isZh ? '搜索笔记或输入命令…' : 'Search notes or type a command…'}
          onKeyDown={event => {
            if (event.key === 'Escape') onClose()
            if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex(index => Math.min(index + 1, items.length - 1)) }
            if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex(index => Math.max(index - 1, 0)) }
            if (event.key === 'Enter') { event.preventDefault(); activate(activeIndex) }
          }}
        />
        <div className="command-palette-list">
          {items.map((item, index) => (
            <button
              key={item.type === 'note' ? `note:${item.note.filename}` : `command:${item.command}`}
              className={`command-palette-item ${index === activeIndex ? 'active' : ''}`}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => activate(index)}
            >
              <span className="command-palette-kind">{item.type === 'note' ? 'MD' : '›'}</span>
              <span>{item.label}</span>
              {item.shortcut && <kbd>{item.shortcut}</kbd>}
            </button>
          ))}
          {!items.length && <div className="command-palette-empty">{isZh ? '没有匹配结果' : 'No matching results'}</div>}
        </div>
      </div>
    </div>
  )
}
