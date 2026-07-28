import React, { useEffect, useMemo, useState } from 'react'
import { BacklinkResult, NoteSummary } from '../types'
import * as storage from '../services/storage'
import { useTranslation } from '../i18n'

interface BacklinksPanelProps {
  title: string
  content: string
  notes: NoteSummary[]
  onOpenNote: (filename: string) => void
}

export function BacklinksPanel({ title, content, notes, onOpenNote }: BacklinksPanelProps) {
  const { locale } = useTranslation()
  const isZh = locale === 'zh'
  const [open, setOpen] = useState(false)
  const [incoming, setIncoming] = useState<BacklinkResult[]>([])
  const [error, setError] = useState('')
  const outgoing = useMemo(() => {
    const titles = Array.from(content.matchAll(/\[\[([^\]\n]{1,255})\]\]/g), match => match[1].trim())
    return Array.from(new Set(titles)).map(linkTitle => ({
      title: linkTitle,
      note: notes.find(note => note.title.toLocaleLowerCase() === linkTitle.toLocaleLowerCase()),
    }))
  }, [content, notes])

  useEffect(() => {
    let cancelled = false
    setError('')
    storage.listBacklinks(title).then(results => {
      if (!cancelled) setIncoming(results)
    }).catch(reason => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { cancelled = true }
  }, [title, content])

  return (
    <div className={`backlinks-panel ${open ? 'open' : ''}`}>
      <button className="backlinks-toggle" onClick={() => setOpen(value => !value)}>
        <span>↔</span>{isZh ? '链接' : 'Links'} <span className="backlinks-count">{incoming.length + outgoing.length}</span>
      </button>
      {open && (
        <div className="backlinks-content">
          <strong>{isZh ? '反向链接' : 'Backlinks'}</strong>
          {!incoming.length && !error && <p>{isZh ? '暂无其他笔记引用此笔记' : 'No other notes link here'}</p>}
          {incoming.map(item => <button key={item.filename} onClick={() => onOpenNote(item.filename)}><span>{item.title}</span><small>{item.snippet}</small></button>)}
          <strong>{isZh ? '当前笔记链接到' : 'Outgoing links'}</strong>
          {!outgoing.length && <p>{isZh ? '使用 [[笔记名称]] 创建链接' : 'Use [[Note title]] to create links'}</p>}
          {outgoing.map(item => <button key={item.title} disabled={!item.note} onClick={() => item.note && onOpenNote(item.note.filename)}><span>{item.note ? item.note.title : item.title}</span><small>{item.note ? '' : (isZh ? '尚未创建' : 'Not created')}</small></button>)}
          {error && <p className="backlinks-error">{error}</p>}
        </div>
      )}
    </div>
  )
}
