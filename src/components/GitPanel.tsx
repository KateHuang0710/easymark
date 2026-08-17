import React, { useCallback, useEffect, useRef, useState } from 'react'
import { GitCommit, GitStatus } from '../types'
import * as storage from '../services/storage'
import { useTranslation } from '../i18n'
import { useDialogFocus } from '../hooks/useDialogFocus'

interface GitPanelProps { visible: boolean; onClose: () => void }

const emptyStatus: GitStatus = { available: true, initialized: false, dirty: false, summary: '', branch: '' }

export function GitPanel({ visible, onClose }: GitPanelProps) {
  const { locale } = useTranslation()
  const isZh = locale === 'zh'
  const [status, setStatus] = useState<GitStatus>(emptyStatus)
  const [history, setHistory] = useState<GitCommit[]>([])
  const [diff, setDiff] = useState('')
  const [message, setMessage] = useState('Update notes')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  useDialogFocus(visible, dialogRef)

  const refresh = useCallback(async () => {
    const [nextStatus, nextHistory, nextDiff] = await Promise.all([
      storage.getGitStatus(), storage.getGitHistory(), storage.getGitDiff(),
    ])
    setStatus(nextStatus); setHistory(nextHistory); setDiff(nextDiff)
  }, [])

  useEffect(() => {
    if (!visible) return
    setError('')
    void refresh().catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
  }, [refresh, visible])

  if (!visible) return null

  const run = async (task: () => Promise<unknown>) => {
    setBusy(true); setError('')
    try { await task(); await refresh() } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }

  return (
    <div className="settings-overlay" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="git-panel"
        role="dialog"
        aria-modal="true"
        aria-label={isZh ? 'Git 版本管理' : 'Git Version Control'}
        tabIndex={-1}
        onMouseDown={event => event.stopPropagation()}
      >
        <header><div><h2>{isZh ? 'Git 版本管理' : 'Git Version Control'}</h2><p>{status.initialized ? `${status.branch} · ${status.dirty ? (isZh ? '有未提交改动' : 'Uncommitted changes') : (isZh ? '工作区干净' : 'Clean')}` : (isZh ? '尚未初始化' : 'Not initialized')}</p></div><button onClick={onClose} aria-label={isZh ? '关闭' : 'Close'}>×</button></header>
        {!status.available ? <div className="git-empty">{isZh ? '系统中没有可用的 Git。' : 'Git is not available on this system.'}</div> : !status.initialized ? (
          <button className="git-primary" disabled={busy} onClick={() => { void run(storage.initializeGit) }}>{isZh ? '在笔记目录初始化 Git' : 'Initialize Git in notes folder'}</button>
        ) : (
          <>
            <div className="git-commit-row"><input value={message} onChange={event => setMessage(event.target.value)} maxLength={200}/><button className="git-primary" disabled={busy || !status.dirty || !message.trim()} onClick={() => { void run(() => storage.commitGit(message)) }}>{isZh ? '提交全部改动' : 'Commit all changes'}</button></div>
            <section><h3>{isZh ? '当前差异' : 'Current diff'}</h3><pre className="git-diff">{diff || (isZh ? '没有差异' : 'No changes')}</pre></section>
            <section><h3>{isZh ? '提交历史' : 'Commit history'}</h3><div className="git-history">{history.map(commit => <div key={commit.hash}><code>{commit.hash.slice(0, 7)}</code><span>{commit.subject}</span><small>{new Date(commit.createdAt).toLocaleString()}</small></div>)}</div></section>
          </>
        )}
        {error && <div className="git-error">{error}</div>}
      </div>
    </div>
  )
}
