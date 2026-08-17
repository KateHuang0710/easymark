import React, { useRef, useCallback, useEffect, useState, useMemo } from 'react'
import { renderMarkdown, highlightMarkdown, highlightCode } from '../../services/markdown'
import { useTranslation } from '../../i18n'
import TurndownService from 'turndown'
import { SearchReplace } from './SearchReplace'
import { OutlinePanel } from './OutlinePanel'
import { ContextMenu, useEditorContextMenu } from './ContextMenu'
import { InlineSuggestion } from './InlineSuggestion'
import { AITransformAction, getInlineCompletion, isConfigured, transformSelection as transformAISelection } from '../../services/ai'
import { useSettings } from '../../contexts/SettingsContext'
import { SaveStatus } from '../../types'
import { formatShortcut, formatShortcutLabel, isInlineCodeShortcut } from '../../utils/shortcuts'

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
  bulletListMarker: '-',
})

function getCodeBlockLanguage(node: HTMLElement, code: HTMLElement | null): string {
  const explicitCodeLanguage = code?.getAttribute('data-lang')
  if (explicitCodeLanguage !== null && explicitCodeLanguage !== undefined) return explicitCodeLanguage
  const languageClass = Array.from(code?.classList || []).find(className => className.startsWith('language-'))
  if (languageClass) {
    const language = languageClass.slice('language-'.length)
    // `hljs` is Highlight.js' marker class, not a user-selected language.
    if (language.toLowerCase() !== 'hljs') return language
  }
  return node.getAttribute('data-lang') || ''
}

turndown.addRule('codeblock', {
  filter: ['pre'],
  replacement: (_content: string, node: HTMLElement) => {
    const code = node.querySelector('code')
    const lang = getCodeBlockLanguage(node, code)
    // The rendered language label is a sibling inside <pre>; only code is data.
    const contentNode = code || node
    const text = (contentNode.innerText || contentNode.textContent || '').replace(/\u200b/g, '')
    const longestFence = Math.max(0, ...Array.from(text.matchAll(/`+/g), match => match[0].length))
    const fence = '`'.repeat(Math.max(3, longestFence + 1))
    return fence + lang + '\n' + text + '\n' + fence + '\n\n'
  },
})

turndown.addRule('strikethrough', {
  filter: node => ['DEL', 'S', 'STRIKE'].includes(node.nodeName),
  replacement: content => `~~${content}~~`,
})

turndown.addRule('underline', {
  filter: ['u'],
  replacement: content => `<u>${content}</u>`,
})

turndown.addRule('highlight', {
  filter: ['mark'],
  replacement: content => `==${content}==`,
})

turndown.addRule('wikiLink', {
  filter: node => node.nodeName === 'A' && node.classList.contains('wiki-link'),
  replacement: (_content: string, node: HTMLElement) => `[[${node.dataset.wikiTitle || node.textContent || ''}]]`,
})

turndown.addRule('taskListItem', {
  // DOMPurify intentionally strips the checkbox type attribute, while marked
  // keeps the disabled input and checked state.
  filter: node => node.nodeName === 'LI' && Array.from(node.children).some(child => child.nodeName === 'INPUT'),
  replacement: (content: string, node: HTMLElement, options) => {
    const checkbox = Array.from(node.children).find(child => child.nodeName === 'INPUT') as HTMLInputElement | undefined
    let prefix = `${options.bulletListMarker}   `
    const parent = node.parentElement
    if (parent?.nodeName === 'OL') {
      const start = Number(parent.getAttribute('start')) || 1
      prefix = `${start + Array.from(parent.children).indexOf(node)}.  `
    }
    const taskContent = `${checkbox?.checked || checkbox?.hasAttribute('checked') ? '[x]' : '[ ]'} ${content.trim()}`
      .replace(/\n/g, `\n${' '.repeat(prefix.length)}`)
    return `${prefix}${taskContent}${node.nextSibling ? '\n' : ''}`
  },
})

turndown.addRule('portableImage', {
  filter: ['img'],
  replacement: (_content: string, node: HTMLElement) => {
    const alt = node.getAttribute('alt') || ''
    const title = node.getAttribute('title')
    let source = node.getAttribute('src') || ''
    try {
      const parsed = new URL(source)
      if (parsed.protocol === 'easymark-asset:' && parsed.hostname === 'local') {
        const filename = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''))
        if (filename && !filename.includes('/') && !filename.includes('\\')) source = `assets/${filename}`
      }
    } catch {
      // Relative image URLs are already portable.
    }
    if (!source) return alt
    return `![${alt}](${source}${title ? ` "${title}"` : ''})`
  },
})

turndown.addRule('table', {
  filter: ['table'],
  replacement: (_content: string, node: HTMLElement) => {
    const rows = Array.from(node.querySelectorAll('tr'))
    if (!rows.length) return ''
    const cells = rows.map(row => Array.from(row.querySelectorAll(':scope > th, :scope > td')).map(cell => (
      editorHtmlToMarkdown(cell.innerHTML)
        .replace(/\|/g, '\\|')
        .replace(/\s*\n\s*/g, '<br>')
        .trim()
    )))
    const columnCount = Math.max(...cells.map(row => row.length))
    const header = cells[0]
    const alignments = Array.from(rows[0].querySelectorAll(':scope > th, :scope > td')).map(cell => {
      const alignment = cell.getAttribute('align')
      if (alignment === 'center') return ':---:'
      if (alignment === 'right') return '---:'
      if (alignment === 'left') return ':---'
      return '---'
    })
    const formatRow = (row: string[]) => `| ${Array.from({ length: columnCount }, (_, index) => row[index] || '').join(' | ')} |`
    return `\n\n${[
      formatRow(header),
      formatRow(Array.from({ length: columnCount }, (_, index) => alignments[index] || '---')),
      ...cells.slice(1).map(formatRow),
    ].join('\n')}\n\n`
  },
})

function normalizeListNesting(html: string): string {
  const container = document.createElement('div')
  container.innerHTML = html
  container.querySelectorAll<HTMLElement>('ol > ol, ol > ul, ul > ol, ul > ul').forEach(nestedList => {
    const previous = nestedList.previousElementSibling
    if (previous?.tagName === 'LI') previous.appendChild(nestedList)
  })
  return container.innerHTML
}

export function normalizeListDomNesting(root: HTMLElement | null): boolean {
  if (!root) return false
  let changed = false
  for (const nestedList of Array.from(root.querySelectorAll<HTMLOListElement | HTMLUListElement>('ol > ol, ol > ul, ul > ol, ul > ul'))) {
    const previous = nestedList.previousElementSibling
    if (previous instanceof HTMLLIElement) {
      previous.appendChild(nestedList)
      changed = true
    }
  }
  // Chromium can outdent from the normalized structure as <li><li>…</li></li>.
  // A list item may contain a nested list, but never another direct list item.
  for (const nestedItem of Array.from(root.querySelectorAll<HTMLLIElement>('li > li'))) {
    const parentItem = nestedItem.parentElement
    const parentList = parentItem?.parentElement
    if (parentItem instanceof HTMLLIElement && parentList?.matches('ol,ul')) {
      parentList.insertBefore(nestedItem, parentItem.nextSibling)
      changed = true
    }
  }
  return changed
}

export function normalizeListBlockStructure(root: HTMLElement | null): boolean {
  if (!root) return false
  let changed = false
  const lists = Array.from(root.querySelectorAll<HTMLOListElement | HTMLUListElement>('p > ol, p > ul'))
  for (const list of lists) {
    const wrapper = list.parentElement
    if (!wrapper || wrapper.tagName !== 'P' || !root.contains(wrapper) || !wrapper.parentNode) continue

    const before = wrapper.cloneNode(false) as HTMLParagraphElement
    const after = wrapper.cloneNode(false) as HTMLParagraphElement
    while (wrapper.firstChild && wrapper.firstChild !== list) before.appendChild(wrapper.firstChild)
    while (list.nextSibling) after.appendChild(list.nextSibling)

    const fragment = document.createDocumentFragment()
    if (hasMeaningfulNodeContent(before)) fragment.appendChild(before)
    fragment.appendChild(list)
    if (hasMeaningfulNodeContent(after)) fragment.appendChild(after)
    wrapper.replaceWith(fragment)
    changed = true
  }
  return changed
}

export function editorHtmlToMarkdown(html: string): string {
  return turndown.turndown(normalizeListNesting(html))
}

interface MarkdownEditorProps {
  /** Stable note identity. Required by app callers to isolate editor history between notes with identical text. */
  noteId?: string
  /** Increment to return focus to this editor after an external note selection. */
  focusRequestId?: number
  content: string
  onChange: (content: string) => void
  onSave: (content: string) => void | Promise<void>
  readOnly?: boolean
  onSplitRight?: () => void
  canSplitRight?: boolean
  onExport?: () => void
  onSearchAll?: () => void
  onReadingMode?: () => void
  dualPaneMode?: boolean
  saveStatus?: SaveStatus
  onRetrySave?: () => void | Promise<void>
  onOpenHistory?: () => void
  onOpenWikiLink?: (title: string) => void
  onShare?: () => void
}

type Tab = 'edit' | 'source' | 'preview'
type TableAlignment = 'left' | 'center' | 'right'

interface TableToolState {
  cell: HTMLTableCellElement
  top: number
  left: number
}

interface ProgrammaticHistoryEntry {
  before: string
  after: string
  beforeHtml?: string
  afterHtml?: string
}

const AUTO_PAIRS: Record<string, string> = {
  '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`',
}

function countWords(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

export function getCaretOffset(root: HTMLElement): number | null {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return null
  const range = sel.getRangeAt(0)
  if (!selectionIsInside(root, range)) return null
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

function closestCodeBlock(node: Node | null): HTMLPreElement | null {
  if (!node) return null
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement
  return element?.closest('pre') as HTMLPreElement | null
}

function getCodeBlockContainer(pre: HTMLPreElement): HTMLElement {
  const parent = pre.parentElement
  return parent?.classList.contains('code-block-wrapper') ? parent : pre
}

function createCodeBlockContainer(pre: HTMLPreElement): HTMLDivElement {
  const wrapper = document.createElement('div')
  wrapper.className = 'code-block-wrapper'
  wrapper.appendChild(pre)
  return wrapper
}

function normalizeCodeLanguage(language: string): string {
  return language.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_+#.-]/g, '')
}

function setCodeBlockLanguage(pre: HTMLPreElement, language: string, showLabel = true): void {
  const normalizedLanguage = normalizeCodeLanguage(language)
  pre.setAttribute('data-lang', normalizedLanguage)
  let code = pre.querySelector('code')
  if (!code) {
    code = document.createElement('code')
    code.textContent = pre.textContent || '\n'
    pre.replaceChildren(code)
  }
  const codeText = code.textContent || ''
  code.setAttribute('data-lang', normalizedLanguage)
  Array.from(code.classList).forEach(className => {
    if (className.startsWith('language-')) code!.classList.remove(className)
  })
  code.classList.add('hljs')
  if (normalizedLanguage) code.classList.add(`language-${normalizedLanguage}`)
  code.innerHTML = highlightCode(codeText, normalizedLanguage)

  pre.querySelector('.code-lang-label')?.remove()
  if (normalizedLanguage && showLabel) {
    const label = document.createElement('span')
    label.className = 'code-lang-label'
    label.contentEditable = 'false'
    label.textContent = normalizedLanguage
    pre.insertBefore(label, code)
  }
}

const CODE_LANGUAGE_HISTORY_HOST = 'code-lang-history-host'
const CODE_LANGUAGE_HISTORY_VALUE = 'code-lang-history-value'

function getCodeLanguageHistoryMarkers(host: HTMLElement): HTMLElement[] {
  return Array.from(host.children).filter(child => child.classList.contains(CODE_LANGUAGE_HISTORY_VALUE)) as HTMLElement[]
}

function getCodeLanguageHistorySignature(host: HTMLElement): string {
  return getCodeLanguageHistoryMarkers(host)
    .map(marker => marker.getAttribute('data-easymark-edit-marker') || '')
    .join('|')
}

function recordCodeLanguageChange(
  root: HTMLElement,
  pre: HTMLPreElement,
  language: string,
  caretOffset: number,
  showLabel: boolean,
  selection: Selection,
): void {
  let host = pre.querySelector<HTMLElement>(`:scope > .${CODE_LANGUAGE_HISTORY_HOST}`)
  if (!host) {
    host = document.createElement('span')
    host.className = CODE_LANGUAGE_HISTORY_HOST
    host.contentEditable = 'true'
    host.setAttribute('aria-hidden', 'true')
    host.dataset.initialLang = getCodeBlockLanguage(pre, pre.querySelector('code'))
    host.dataset.initialCaretOffset = String(caretOffset)
    host.dataset.appliedSignature = ''
    pre.appendChild(host)
  }
  host.dataset.showLabel = String(showLabel)

  const marker = document.createElement('span')
  const markerId = nextNativeEditMarker('code-language')
  marker.className = CODE_LANGUAGE_HISTORY_VALUE
  marker.setAttribute(markerId.attribute, markerId.value)
  marker.dataset.lang = normalizeCodeLanguage(language)
  marker.dataset.caretOffset = String(caretOffset)
  marker.appendChild(document.createElement('br'))

  const historyRange = document.createRange()
  historyRange.selectNodeContents(host)
  historyRange.collapse(false)
  root.focus()
  selection.removeAllRanges()
  selection.addRange(historyRange)
  if (typeof document.execCommand !== 'function' || !document.execCommand('insertHTML', false, marker.outerHTML)) {
    host.appendChild(marker)
  }
  host.dataset.appliedSignature = getCodeLanguageHistorySignature(host)
}

export function syncCodeBlockLanguageHistory(
  root: HTMLElement | null,
  selection = window.getSelection(),
): boolean {
  if (!root) return false
  let changed = false
  let caretTarget: { code: HTMLElement; offset: number } | null = null

  for (const host of root.querySelectorAll<HTMLElement>(`.${CODE_LANGUAGE_HISTORY_HOST}`)) {
    const signature = getCodeLanguageHistorySignature(host)
    if (signature === (host.dataset.appliedSignature || '')) continue
    const pre = host.closest('pre') as HTMLPreElement | null
    if (!pre || !root.contains(pre)) continue
    const markers = getCodeLanguageHistoryMarkers(host)
    const activeMarker = markers[markers.length - 1]
    const language = activeMarker?.dataset.lang ?? host.dataset.initialLang ?? ''
    const rawOffset = activeMarker?.dataset.caretOffset ?? host.dataset.initialCaretOffset ?? '0'
    const caretOffset = Number.parseInt(rawOffset, 10)
    setCodeBlockLanguage(pre, language, host.dataset.showLabel !== 'false')
    host.dataset.appliedSignature = signature
    const code = pre.querySelector<HTMLElement>('code')
    if (code) caretTarget = { code, offset: Number.isFinite(caretOffset) ? caretOffset : 0 }
    changed = true
  }

  if (caretTarget) {
    root.focus()
    setCaretByOffset(caretTarget.code, caretTarget.offset)
  }
  return changed
}

function createCodeBlock(language: string, content: string, showLabel = true): HTMLPreElement {
  const pre = document.createElement('pre')
  const code = document.createElement('code')
  code.textContent = content || '\n'
  pre.appendChild(code)
  setCodeBlockLanguage(pre, language, showLabel)
  return pre
}

export function removeCodeBlockAtSelection(root: HTMLElement | null, selection = window.getSelection()): boolean {
  if (!root || !selection?.rangeCount) return false
  const activeRange = selection.getRangeAt(0)
  if (!selectionIsInside(root, activeRange)) return false
  const startPre = closestCodeBlock(activeRange.startContainer)
  const endPre = closestCodeBlock(activeRange.endContainer)
  const pre = startPre && startPre === endPre ? startPre : null
  if (!pre || !root.contains(pre)) return false
  const contentNode = pre.querySelector('code') || pre
  if (activeRange.collapsed) {
    if ((contentNode.textContent || '').replace(/[\s\u00a0\u200b]/g, '')) return false
  } else {
    const contentRange = document.createRange()
    contentRange.selectNodeContents(contentNode)
    // Chromium may normalize a selection made through highlighted <span>s so
    // its boundary points are not directly comparable with the code element's
    // range. Check the common element-boundary shape and selected text as well;
    // otherwise Backspace turns the code block into an invalid <p> nested in
    // <code> instead of removing the block.
    const startsAtContentBoundary = activeRange.startContainer === contentNode && activeRange.startOffset === 0
    const endsAtContentBoundary = activeRange.endContainer === contentNode && activeRange.endOffset === contentNode.childNodes.length
    const coversAllContent = (activeRange.compareBoundaryPoints(Range.START_TO_START, contentRange) <= 0
      && activeRange.compareBoundaryPoints(Range.END_TO_END, contentRange) >= 0)
      || (startsAtContentBoundary && endsAtContentBoundary)
      || activeRange.toString() === contentNode.textContent
    if (!coversAllContent) return false
  }

  const block = getCodeBlockContainer(pre)
  const previous = block.previousElementSibling
  const next = block.nextElementSibling
  if (typeof document.execCommand === 'function') {
    const originalRange = activeRange.cloneRange()
    const replacementRange = document.createRange()
    replacementRange.selectNode(block)
    root.focus()
    selection.removeAllRanges()
    selection.addRange(replacementRange)

    const applied = previous || next
      ? document.execCommand('delete')
      : document.execCommand('insertHTML', false, '<p><br></p>')
    if (applied && !block.isConnected) {
      if (previous?.isConnected) placeCaretAtEnd(previous as HTMLElement, selection)
      else if (next?.isConnected) placeCaretAtStart(next as HTMLElement, selection)
      else {
        const paragraph = root.querySelector<HTMLElement>('p')
        if (paragraph) placeCaretAtStart(paragraph, selection)
      }
      return true
    }

    // Chromium can report success while inserting the replacement paragraph
    // inside <code> instead of removing the wrapper. Restore the original
    // selection when possible and let the structural fallback below cleanly
    // remove the block.
    if (!block.isConnected) return true
    selection.removeAllRanges()
    selection.addRange(originalRange)
  }

  const caretRange = document.createRange()
  if (previous) {
    block.remove()
    caretRange.selectNodeContents(previous)
    caretRange.collapse(false)
  } else if (next) {
    block.remove()
    caretRange.selectNodeContents(next)
    caretRange.collapse(true)
  } else {
    const paragraph = document.createElement('p')
    paragraph.appendChild(document.createElement('br'))
    block.replaceWith(paragraph)
    caretRange.setStart(paragraph, 0)
    caretRange.collapse(true)
  }
  selection.removeAllRanges()
  selection.addRange(caretRange)
  return true
}

export function addDeferredDocumentMouseDownListener(handler: (event: MouseEvent) => void): () => void {
  let active = true
  const timer = window.setTimeout(() => {
    if (!active) return
    document.addEventListener('mousedown', handler)
  }, 0)
  return () => {
    active = false
    window.clearTimeout(timer)
    document.removeEventListener('mousedown', handler)
  }
}

export function applyBlockFormat(root: HTMLElement | null, tagName: string): boolean {
  if (!root || !/^(?:p|blockquote|pre|h[1-6])$/.test(tagName)) return false
  return applyNativeEditingCommand(root, 'formatBlock', tagName)
}

export function applyNativeEditingCommand(root: HTMLElement | null, command: string, value?: string): boolean {
  if (!root) return false
  if (typeof document.execCommand !== 'function') return false
  const selection = window.getSelection()
  if (!selection?.rangeCount) return false
  const range = selection.getRangeAt(0)
  if (!selectionIsInside(root, range)) return false

  const savedRange = range.cloneRange()
  root.focus()
  selection.removeAllRanges()
  selection.addRange(savedRange)
  return document.execCommand(command, false, value)
}

function insertTextAtCursor(root: HTMLElement | null, text: string) {
  if (applyNativeEditingCommand(root, 'insertText', text)) return true
  const sel = window.getSelection()
  if (!root || !sel || !sel.rangeCount || !selectionIsInside(root, sel.getRangeAt(0))) return false
  const range = sel.getRangeAt(0)
  range.deleteContents()
  const textNode = document.createTextNode(text)
  range.insertNode(textNode)
  const newRange = document.createRange()
  newRange.setStartAfter(textNode)
  newRange.collapse(true)
  sel.removeAllRanges()
  sel.addRange(newRange)
  return true
}

function createEmptyTableCell(tagName: 'th' | 'td'): HTMLTableCellElement {
  const cell = document.createElement(tagName)
  cell.appendChild(document.createElement('br'))
  return cell
}

export function createVisualTable(rowCount = 3, columnCount = 3): HTMLTableElement {
  const rows = Math.max(2, Math.min(20, Math.trunc(rowCount) || 3))
  const columns = Math.max(1, Math.min(12, Math.trunc(columnCount) || 3))
  const table = document.createElement('table')
  const head = table.createTHead()
  const headerRow = head.insertRow()
  for (let index = 0; index < columns; index++) headerRow.appendChild(createEmptyTableCell('th'))
  const body = table.createTBody()
  for (let rowIndex = 1; rowIndex < rows; rowIndex++) {
    const row = body.insertRow()
    for (let columnIndex = 0; columnIndex < columns; columnIndex++) row.appendChild(createEmptyTableCell('td'))
  }
  return table
}

function getTopLevelEditorBlock(root: HTMLElement, node: Node): HTMLElement | null {
  let current = node.nodeType === Node.ELEMENT_NODE ? node as HTMLElement : node.parentElement
  while (current?.parentElement && current.parentElement !== root) current = current.parentElement
  return current?.parentElement === root ? current : null
}

export function insertTableAtSelection(
  root: HTMLElement | null,
  rowCount = 3,
  columnCount = 3,
  selection = window.getSelection(),
): HTMLTableElement | null {
  if (!root || !selection?.rangeCount) return null
  const range = selection.getRangeAt(0)
  if (!selectionIsInside(root, range)) return null
  const table = createVisualTable(rowCount, columnCount)
  const trailingParagraph = document.createElement('p')
  trailingParagraph.appendChild(document.createElement('br'))
  const topLevelBlock = getTopLevelEditorBlock(root, range.startContainer)

  if (topLevelBlock && !hasMeaningfulNodeContent(topLevelBlock)) {
    topLevelBlock.replaceWith(table, trailingParagraph)
  } else if (topLevelBlock) {
    topLevelBlock.parentNode?.insertBefore(table, topLevelBlock.nextSibling)
    table.parentNode?.insertBefore(trailingParagraph, table.nextSibling)
  } else {
    root.append(table, trailingParagraph)
  }

  const firstCell = table.querySelector<HTMLTableCellElement>('th,td')
  if (firstCell) placeCaretAtStart(firstCell, selection)
  root.focus()
  return table
}

export function addVisualTableRow(table: HTMLTableElement, activeRow?: HTMLTableRowElement | null): HTMLTableRowElement {
  const columnCount = Math.max(1, ...Array.from(table.rows).map(row => row.cells.length))
  let body = table.tBodies.item(0)
  if (!body) body = table.createTBody()
  const insertIndex = activeRow?.parentElement === body ? activeRow.sectionRowIndex + 1 : 0
  const row = body.insertRow(insertIndex)
  for (let index = 0; index < columnCount; index++) row.appendChild(createEmptyTableCell('td'))
  return row
}

export function addVisualTableColumn(table: HTMLTableElement, activeColumnIndex: number): number {
  const rows = Array.from(table.rows)
  if (!rows.length) return -1
  const columnIndex = Math.max(0, activeColumnIndex + 1)
  rows.forEach(row => {
    const tagName: 'th' | 'td' = row.parentElement?.tagName === 'THEAD' ? 'th' : 'td'
    const cell = createEmptyTableCell(tagName)
    const reference = row.cells.item(columnIndex)
    if (reference) row.insertBefore(cell, reference)
    else row.appendChild(cell)
  })
  return columnIndex
}

export function deleteVisualTableRow(table: HTMLTableElement, row: HTMLTableRowElement): boolean {
  if (!table.contains(row) || row.parentElement?.tagName === 'THEAD') return false
  row.remove()
  return true
}

export function deleteVisualTableColumn(table: HTMLTableElement, columnIndex: number): boolean {
  const rows = Array.from(table.rows)
  const columnCount = Math.max(0, ...rows.map(row => row.cells.length))
  if (columnCount <= 1 || columnIndex < 0 || columnIndex >= columnCount) return false
  rows.forEach(row => row.cells.item(columnIndex)?.remove())
  return true
}

export function deleteVisualTableColumnAtCell(
  table: HTMLTableElement,
  cell: HTMLTableCellElement,
): HTMLTableCellElement | null {
  const row = cell.parentElement
  if (!(row instanceof HTMLTableRowElement) || !table.contains(cell)) return null
  const targetIndex = Math.max(0, cell.cellIndex - 1)
  if (!deleteVisualTableColumn(table, cell.cellIndex)) return cell
  return row.cells.item(Math.min(targetIndex, row.cells.length - 1))
}

export function alignVisualTableColumn(
  table: HTMLTableElement,
  columnIndex: number,
  alignment: TableAlignment,
): boolean {
  if (!table.rows.length || columnIndex < 0) return false
  let changed = false
  Array.from(table.rows).forEach(row => {
    const cell = row.cells.item(columnIndex)
    if (!cell) return
    cell.setAttribute('align', alignment)
    changed = true
  })
  return changed
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function visualTableToCsv(table: HTMLTableElement): string {
  return Array.from(table.rows).map(row => Array.from(row.cells).map(cell => csvCell((cell.innerText || cell.textContent || '').trim())).join(',')).join('\n')
}

export function parseCsvTable(source: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let value = ''
  let quoted = false
  for (let index = 0; index <= source.length; index++) {
    const character = source[index] || '\n'
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') { value += '"'; index += 1 }
      else if (character === '"') quoted = false
      else value += character
      continue
    }
    if (character === '"' && !value) { quoted = true; continue }
    if (character === ',') { row.push(value); value = ''; continue }
    if (character === '\r' && source[index + 1] === '\n') continue
    if (character === '\n') {
      row.push(value); value = ''
      if (row.some(cell => cell.length)) rows.push(row)
      row = []
      continue
    }
    value += character
  }
  return rows.slice(0, 100).map(current => current.slice(0, 30))
}

export function replaceVisualTableFromCsv(table: HTMLTableElement, source: string): HTMLTableCellElement | null {
  const rows = parseCsvTable(source)
  if (!rows.length) return null
  const columnCount = Math.max(...rows.map(row => row.length))
  const replacement = createVisualTable(Math.max(rows.length, 2), columnCount)
  Array.from(replacement.rows).forEach((row, rowIndex) => Array.from(row.cells).forEach((cell, columnIndex) => {
    cell.textContent = rows[rowIndex]?.[columnIndex] || ''
    if (!cell.textContent) cell.appendChild(document.createElement('br'))
  }))
  table.replaceWith(replacement)
  return replacement.querySelector('th,td')
}

export function sortVisualTableColumn(table: HTMLTableElement, columnIndex: number, direction: 'asc' | 'desc'): boolean {
  const body = table.tBodies.item(0)
  if (!body || columnIndex < 0) return false
  const rows = Array.from(body.rows)
  if (rows.length < 2) return false
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  rows.sort((left, right) => direction === 'asc'
    ? collator.compare(left.cells.item(columnIndex)?.textContent || '', right.cells.item(columnIndex)?.textContent || '')
    : collator.compare(right.cells.item(columnIndex)?.textContent || '', left.cells.item(columnIndex)?.textContent || ''))
  rows.forEach(row => body.appendChild(row))
  return true
}

export function deleteVisualTable(
  root: HTMLElement | null,
  table: HTMLTableElement,
  selection = window.getSelection(),
): boolean {
  if (!root || !root.contains(table)) return false
  const previous = table.previousElementSibling as HTMLElement | null
  const next = table.nextElementSibling as HTMLElement | null
  table.remove()
  if (!root.children.length) {
    const paragraph = document.createElement('p')
    paragraph.appendChild(document.createElement('br'))
    root.appendChild(paragraph)
    placeCaretAtStart(paragraph, selection)
  } else if (next?.isConnected) {
    placeCaretAtStart(next, selection)
  } else if (previous?.isConnected) {
    placeCaretAtEnd(previous, selection)
  }
  root.focus()
  return true
}

export function moveAcrossVisualTable(
  table: HTMLTableElement,
  activeCell: HTMLTableCellElement,
  backwards = false,
  selection = window.getSelection(),
): { moved: boolean; changed: boolean; cell: HTMLTableCellElement | null } {
  let cells = Array.from(table.querySelectorAll<HTMLTableCellElement>('th,td'))
  const currentIndex = cells.indexOf(activeCell)
  if (currentIndex < 0) return { moved: false, changed: false, cell: null }
  let nextIndex = currentIndex + (backwards ? -1 : 1)
  let changed = false
  if (!backwards && nextIndex >= cells.length) {
    addVisualTableRow(table, table.rows.item(table.rows.length - 1))
    cells = Array.from(table.querySelectorAll<HTMLTableCellElement>('th,td'))
    nextIndex = currentIndex + 1
    changed = true
  }
  if (nextIndex < 0 || nextIndex >= cells.length) return { moved: false, changed, cell: null }
  const nextCell = cells[nextIndex]
  placeCaretAtStart(nextCell, selection)
  return { moved: true, changed, cell: nextCell }
}

function headingLevel(heading: Element): number {
  return Number(heading.tagName.slice(1)) || 6
}

export function toggleHeadingFold(heading: HTMLElement): boolean {
  if (!/^H[1-6]$/.test(heading.tagName)) return false
  const shouldFold = !heading.classList.contains('easymark-heading-folded')
  const level = headingLevel(heading)
  let sibling = heading.nextElementSibling as HTMLElement | null
  while (sibling) {
    if (/^H[1-6]$/.test(sibling.tagName) && headingLevel(sibling) <= level) break
    sibling.classList.toggle('easymark-fold-hidden', shouldFold)
    sibling = sibling.nextElementSibling as HTMLElement | null
  }
  heading.classList.toggle('easymark-heading-folded', shouldFold)
  heading.setAttribute('aria-expanded', String(!shouldFold))
  return shouldFold
}

export function toggleListFold(listItem: HTMLLIElement): boolean {
  const nestedList = Array.from(listItem.children).find(child => child.matches('ul,ol'))
  if (!nestedList) return false
  const shouldFold = !listItem.classList.contains('easymark-list-folded')
  listItem.classList.toggle('easymark-list-folded', shouldFold)
  listItem.setAttribute('aria-expanded', String(!shouldFold))
  return shouldFold
}

export function expandAllEditorFolds(root: HTMLElement | null): number {
  if (!root) return 0
  const folded = root.querySelectorAll<HTMLElement>('.easymark-heading-folded,.easymark-list-folded')
  root.querySelectorAll<HTMLElement>('.easymark-fold-hidden').forEach(element => element.classList.remove('easymark-fold-hidden'))
  folded.forEach(element => {
    element.classList.remove('easymark-heading-folded', 'easymark-list-folded')
    element.setAttribute('aria-expanded', 'true')
  })
  return folded.length
}

export function insertInlineElement(
  root: HTMLElement | null,
  tagName: 'code' | 'a',
  fallbackText = '',
  attributes: Record<string, string> = {},
): boolean {
  const selection = window.getSelection()
  if (!root || !selection?.rangeCount) return false
  const range = selection.getRangeAt(0)
  if (!selectionIsInside(root, range)) return false

  const element = document.createElement(tagName)
  Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, value))
  if (range.collapsed) {
    element.textContent = fallbackText
  } else {
    element.appendChild(range.cloneContents())
  }
  if (applyNativeEditingCommand(root, 'insertHTML', element.outerHTML)) return true

  element.replaceChildren()
  if (range.collapsed) element.textContent = fallbackText
  else element.appendChild(range.extractContents())
  range.insertNode(element)

  const nextRange = document.createRange()
  if (element.textContent) nextRange.selectNodeContents(element)
  else nextRange.setStart(element, 0)
  selection.removeAllRanges()
  selection.addRange(nextRange)
  root.focus()
  return true
}

export function isCaretAtEndOfElement(element: HTMLElement, range: Range): boolean {
  if (!range.collapsed || !element.contains(range.endContainer)) return false
  const tail = document.createRange()
  tail.setStart(range.endContainer, range.endOffset)
  tail.setEnd(element, element.childNodes.length)
  return !hasMeaningfulNodeContent(tail.cloneContents())
}

let nativeEditMarkerCounter = 0

function nextNativeEditMarker(prefix: string): { attribute: string; value: string } {
  nativeEditMarkerCounter += 1
  return {
    attribute: 'data-easymark-edit-marker',
    value: `${prefix}-${nativeEditMarkerCounter}`,
  }
}

function placeCaretAtStart(element: HTMLElement, selection = window.getSelection()): void {
  if (!selection) return
  const range = document.createRange()
  range.selectNodeContents(element)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
}

function placeCaretAtEnd(element: HTMLElement, selection = window.getSelection()): void {
  if (!selection) return
  const range = document.createRange()
  range.selectNodeContents(element)
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
}

export function insertParagraphAfterCodeBlock(
  root: HTMLElement | null,
  pre: HTMLPreElement,
  selection = window.getSelection(),
): boolean {
  if (!root || !selection || !root.contains(pre)) return false
  const block = getCodeBlockContainer(pre)
  const paragraph = document.createElement('p')
  paragraph.appendChild(document.createElement('br'))
  // Chromium keeps the active <code>/<pre> typing style even when a native
  // command is aimed after the block, which can nest the new paragraph inside
  // the language label or code element. A direct sibling is structurally safe;
  // the exit itself changes only the caret, while subsequent native typing
  // remains independently undoable/redoable.
  block.parentNode?.insertBefore(paragraph, block.nextSibling)
  placeCaretAtStart(paragraph, selection)
  root.focus()
  return true
}

export function insertCodeBlockAtSelection(
  root: HTMLElement | null,
  language = '',
  showLabel = true,
  selection = window.getSelection(),
): boolean {
  if (!root || !selection?.rangeCount) return false
  const range = selection.getRangeAt(0)
  if (!selectionIsInside(root, range)) return false
  const selectedText = selection.toString()
  const pre = createCodeBlock(language, selectedText, showLabel)
  const wrapper = createCodeBlockContainer(pre)
  const marker = nextNativeEditMarker('code-insert')
  pre.setAttribute(marker.attribute, marker.value)
  if (applyNativeEditingCommand(root, 'insertHTML', wrapper.outerHTML)) {
    const insertedPre = root.querySelector<HTMLPreElement>(`pre[${marker.attribute}="${marker.value}"]`)
    insertedPre?.removeAttribute(marker.attribute)
    const code = insertedPre?.querySelector<HTMLElement>('code')
    if (code) {
      setCaretByOffset(code, selectedText.length)
      root.focus()
    }
    return Boolean(insertedPre)
  }

  pre.removeAttribute(marker.attribute)
  range.deleteContents()
  range.insertNode(wrapper)
  const code = pre.querySelector<HTMLElement>('code')!
  setCaretByOffset(code, selectedText.length)
  root.focus()
  return true
}

export function updateCodeBlockLanguage(
  root: HTMLElement | null,
  pre: HTMLPreElement,
  language: string,
  showLabel = true,
  selection = window.getSelection(),
): boolean {
  if (!root || !selection?.rangeCount || !root.contains(pre)) return false
  const activeRange = selection.getRangeAt(0)
  const code = pre.querySelector<HTMLElement>('code')
  let caretOffset = 0
  if (code && activeRange.collapsed && code.contains(activeRange.startContainer)) {
    const beforeCaret = document.createRange()
    beforeCaret.selectNodeContents(code)
    beforeCaret.setEnd(activeRange.startContainer, activeRange.startOffset)
    caretOffset = beforeCaret.toString().length
  }

  recordCodeLanguageChange(root, pre, language, caretOffset, showLabel, selection)
  setCodeBlockLanguage(pre, language, showLabel)
  root.focus()
  const updatedCode = pre.querySelector<HTMLElement>('code')
  if (updatedCode) setCaretByOffset(updatedCode, caretOffset)
  return true
}

export function insertCodeNewlineAtSelection(
  root: HTMLElement | null,
  pre: HTMLPreElement,
  selection = window.getSelection(),
): boolean {
  if (!root || !selection?.rangeCount || !root.contains(pre)) return false
  const range = selection.getRangeAt(0)
  const code = pre.querySelector<HTMLElement>('code')
  if (!code || !selectionIsInside(code, range)) return false

  range.deleteContents()
  const newline = document.createTextNode('\n\u200b')
  range.insertNode(newline)
  // Keep the caret immediately after the newline and before a temporary zero-
  // width anchor. At an element boundary Chromium inserts subsequent text
  // before the newline and reverses the order.
  range.setStart(newline, 1)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
  root.focus()
  return true
}

export function insertParagraphAfterHeading(
  root: HTMLElement | null,
  heading: HTMLElement,
  selection = window.getSelection(),
): boolean {
  if (!root || !selection?.rangeCount || !root.contains(heading)) return false
  const activeRange = selection.getRangeAt(0)
  if (!isCaretAtEndOfElement(heading, activeRange)) return false
  // Prefer Chromium's native editing transaction so Command/Ctrl+Z can undo
  // both the paragraph creation and later typing in the expected order.
  if (applyNativeEditingCommand(root, 'insertParagraph')) {
    // Chromium commonly creates a <div> after a heading. That is editable, but
    // it is not a paragraph and can make subsequent heading/list operations
    // appear to "jump" until React renders again. Normalize the newly created
    // block with another native command so it remains part of the undo stack.
    const active = selection.anchorNode?.nodeType === Node.ELEMENT_NODE
      ? selection.anchorNode as Element
      : selection.anchorNode?.parentElement
    const insertedBlock = active?.closest('div')
    if (insertedBlock && root.contains(insertedBlock) && insertedBlock !== root) {
      applyNativeEditingCommand(root, 'formatBlock', 'p')
    }
    return true
  }

  const paragraph = document.createElement('p')
  paragraph.appendChild(document.createElement('br'))
  heading.parentNode?.insertBefore(paragraph, heading.nextSibling)
  const nextRange = document.createRange()
  nextRange.setStart(paragraph, 0)
  nextRange.collapse(true)
  selection.removeAllRanges()
  selection.addRange(nextRange)
  root.focus()
  return true
}

export function getHistoryShortcut(key: string, shiftKey = false): 'undo' | 'redo' | null {
  const normalizedKey = key.toLowerCase()
  if (normalizedKey === 'z') return shiftKey ? 'redo' : 'undo'
  if (normalizedKey === 'y') return 'redo'
  return null
}

export interface TextIndentEdit {
  value: string
  selectionStart: number
  selectionEnd: number
}

export function applyTextAreaEdit(textarea: HTMLTextAreaElement, edit: TextIndentEdit): boolean {
  const previousValue = textarea.value
  if (previousValue === edit.value) {
    textarea.setSelectionRange(edit.selectionStart, edit.selectionEnd)
    return false
  }

  let prefixLength = 0
  const sharedLength = Math.min(previousValue.length, edit.value.length)
  while (prefixLength < sharedLength && previousValue[prefixLength] === edit.value[prefixLength]) prefixLength += 1

  let suffixLength = 0
  while (
    suffixLength < previousValue.length - prefixLength
    && suffixLength < edit.value.length - prefixLength
    && previousValue[previousValue.length - 1 - suffixLength] === edit.value[edit.value.length - 1 - suffixLength]
  ) suffixLength += 1

  const replacementEnd = previousValue.length - suffixLength
  const replacement = edit.value.slice(prefixLength, edit.value.length - suffixLength)
  textarea.focus()
  textarea.setSelectionRange(prefixLength, replacementEnd)
  const appliedNatively = typeof document.execCommand === 'function'
    && document.execCommand('insertText', false, replacement)
  if (!appliedNatively) {
    textarea.setRangeText(replacement, prefixLength, replacementEnd, 'end')
    textarea.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: replacement,
    }))
  }
  textarea.setSelectionRange(edit.selectionStart, edit.selectionEnd)
  return appliedNatively
}

export function editTextIndent(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  outdent = false,
  indent = '    ',
): TextIndentEdit {
  const removeIndent = (line: string) => line.replace(new RegExp(`^(?:\\t| {1,${indent.length}})`), '')
  const lineStart = value.lastIndexOf('\n', Math.max(selectionStart - 1, 0)) + 1
  if (selectionStart === selectionEnd) {
    if (!outdent) {
      return {
        value: value.slice(0, selectionStart) + indent + value.slice(selectionEnd),
        selectionStart: selectionStart + indent.length,
        selectionEnd: selectionEnd + indent.length,
      }
    }
    const currentLine = value.slice(lineStart)
    const removableLength = currentLine.length - removeIndent(currentLine).length
    const removable = currentLine.slice(0, removableLength)
    if (!removable) return { value, selectionStart, selectionEnd }
    return {
      value: value.slice(0, lineStart) + value.slice(lineStart + removable.length),
      selectionStart: Math.max(lineStart, selectionStart - removable.length),
      selectionEnd: Math.max(lineStart, selectionEnd - removable.length),
    }
  }

  const selectionEndsAtLineStart = selectionEnd > selectionStart && value[selectionEnd - 1] === '\n'
  const effectiveEnd = selectionEndsAtLineStart ? selectionEnd - 1 : selectionEnd
  const lastLineBreak = value.indexOf('\n', effectiveEnd)
  const blockEnd = lastLineBreak === -1 ? value.length : lastLineBreak
  const lines = value.slice(lineStart, blockEnd).split('\n')
  const transformed = lines.map(line => outdent
    ? removeIndent(line)
    : indent + line)
  const replacement = transformed.join('\n')
  const nextValue = value.slice(0, lineStart) + replacement + value.slice(blockEnd)
  return {
    value: nextValue,
    selectionStart: lineStart,
    selectionEnd: lineStart + replacement.length,
  }
}

function removeCodeCaretAnchors(root: HTMLElement | null): void {
  if (!root) return
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []
  let current: Node | null
  while ((current = walker.nextNode())) {
    if (current.parentElement?.closest('code') && current.nodeValue?.includes('\u200b')) {
      textNodes.push(current as Text)
    }
  }
  for (const node of textNodes) node.nodeValue = (node.nodeValue || '').replace(/\u200b/g, '')
}

function hasMeaningfulNodeContent(node: ParentNode): boolean {
  if ((node.textContent || '').replace(/[\s\u00a0\u200b]/g, '')) return true
  return Boolean(node.querySelector?.('img,hr,pre,table,ul,ol'))
}

export function exitBlockquoteAtSelection(
  root: HTMLElement | null,
  selection = window.getSelection(),
): boolean {
  if (!root || !selection?.rangeCount) return false
  const range = selection.getRangeAt(0)
  if (!range.collapsed || !selectionIsInside(root, range)) return false
  const element = range.startContainer.nodeType === Node.ELEMENT_NODE
    ? range.startContainer as Element
    : range.startContainer.parentElement
  const blockquote = element?.closest('blockquote') as HTMLQuoteElement | null
  if (!blockquote || !root.contains(blockquote) || !blockquote.parentNode) return false

  if (isCaretAtEndOfElement(blockquote, range) && typeof document.execCommand === 'function') {
    const replacementRange = document.createRange()
    replacementRange.selectNode(blockquote)
    selection.removeAllRanges()
    selection.addRange(replacementRange)
    root.focus()
    const markerAttribute = 'data-easymark-quote-exit'
    const replacement = `${blockquote.outerHTML}<p ${markerAttribute}="true"><br></p>`
    if (document.execCommand('insertHTML', false, replacement)) {
      const paragraph = root.querySelector<HTMLElement>(`[${markerAttribute}]`)
      paragraph?.removeAttribute(markerAttribute)
      if (paragraph) {
        const nextRange = document.createRange()
        nextRange.setStart(paragraph, 0)
        nextRange.collapse(true)
        selection.removeAllRanges()
        selection.addRange(nextRange)
      }
      return true
    }
    selection.removeAllRanges()
    selection.addRange(range)
  }

  const trailingRange = document.createRange()
  trailingRange.setStart(range.startContainer, range.startOffset)
  trailingRange.setEnd(blockquote, blockquote.childNodes.length)
  const trailingContent = trailingRange.extractContents()

  const paragraph = document.createElement('p')
  paragraph.appendChild(document.createElement('br'))
  blockquote.parentNode.insertBefore(paragraph, blockquote.nextSibling)

  if (hasMeaningfulNodeContent(trailingContent)) {
    const trailingBlockquote = blockquote.cloneNode(false) as HTMLQuoteElement
    trailingBlockquote.appendChild(trailingContent)
    paragraph.parentNode?.insertBefore(trailingBlockquote, paragraph.nextSibling)
  }
  if (!hasMeaningfulNodeContent(blockquote)) blockquote.remove()

  const nextRange = document.createRange()
  nextRange.setStart(paragraph, 0)
  nextRange.collapse(true)
  selection.removeAllRanges()
  selection.addRange(nextRange)
  root.focus()
  return true
}

export function insertSoftBreakAtSelection(
  root: HTMLElement | null,
  selection = window.getSelection(),
): boolean {
  if (!root || !selection?.rangeCount) return false
  const range = selection.getRangeAt(0)
  if (!selectionIsInside(root, range)) return false
  if (applyNativeEditingCommand(root, 'insertLineBreak')) return true

  range.deleteContents()
  const br = document.createElement('br')
  range.insertNode(br)
  const nextRange = document.createRange()
  nextRange.setStartAfter(br)
  nextRange.collapse(true)
  selection.removeAllRanges()
  selection.addRange(nextRange)
  root.focus()
  return true
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

export function MarkdownEditor({ noteId, focusRequestId = 0, content, onChange, onSave, readOnly, onSplitRight, canSplitRight = true, onExport, onSearchAll, onReadingMode, dualPaneMode, saveStatus, onRetrySave, onOpenHistory, onOpenWikiLink, onShare }: MarkdownEditorProps) {
  const { t, locale } = useTranslation()
  const shortcutLabel = (label: string) => formatShortcutLabel(label, window.electronAPI.platform)
  const editorRef = useRef<HTMLDivElement>(null)
  const [viewMode, setViewMode] = useState<Tab>('edit')
  const skipNextRender = useRef(false)
  const contentRef = useRef(content)
  const previousContentPropRef = useRef(content)
  const previousNoteIdRef = useRef(noteId)
  const previousCodeLabelSettingRef = useRef<boolean | undefined>(undefined)
  const pendingContent = useRef('')
  const composingRef = useRef(false)
  const mountedRef = useRef(true)
  // Toolbar/table operations mutate the contenteditable DOM directly. Keep a
  // small Markdown-level history for those transactions so Cmd/Ctrl+Z and
  // Cmd/Ctrl+Y behave consistently with native typing history.
  const programmaticHistoryRef = useRef<{ undo: ProgrammaticHistoryEntry[]; redo: ProgrammaticHistoryEntry[] }>({ undo: [], redo: [] })
  const pendingNativeHistoryRef = useRef<{ direction: 'undo' | 'redo'; before: string } | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])
  const overlayRef = useRef<HTMLPreElement>(null)
  const sourceTaRef = useRef<HTMLTextAreaElement>(null)
  const [searchVisible, setSearchVisible] = useState(false)
  const [outlineVisible, setOutlineVisible] = useState(false)
  const [showLangPicker, setShowLangPicker] = useState(false)
  const [langFilter, setLangFilter] = useState('')
  const [tableTools, setTableTools] = useState<TableToolState | null>(null)
  const [showAITransform, setShowAITransform] = useState(false)
  const [aiTransformBusy, setAITransformBusy] = useState(false)
  const langPickerRef = useRef<HTMLDivElement>(null)
  const langSelectionRef = useRef<Range | null>(null)
  const langTargetRef = useRef<HTMLPreElement | null>(null)
  const editorWrapperRef = useRef<HTMLDivElement>(null)
  const { settings } = useSettings()
  const codeLabelSettingChanged = previousCodeLabelSettingRef.current !== settings.showCodeLangLabel
  previousCodeLabelSettingRef.current = settings.showCodeLangLabel

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
        langSelectionRef.current = null
        langTargetRef.current = null
      }
    }
    return addDeferredDocumentMouseDownListener(handler)
  }, [showLangPicker])

  const inlineAiEnabled = isConfigured() && settings.aiInlineCompletion

  const updateTableTools = useCallback((preferredCell?: HTMLTableCellElement | null) => {
    const root = editorRef.current
    const wrapper = editorWrapperRef.current
    if (!root || !wrapper || viewMode !== 'edit' || readOnly) {
      setTableTools(null)
      return
    }
    const selection = window.getSelection()
    const activeNode = selection?.rangeCount ? selection.getRangeAt(0).startContainer : null
    const element = activeNode?.nodeType === Node.ELEMENT_NODE ? activeNode as Element : activeNode?.parentElement
    const cell = preferredCell || element?.closest('th,td') as HTMLTableCellElement | null
    if (!cell || !root.contains(cell)) {
      setTableTools(null)
      return
    }
    const table = cell.closest('table')
    if (!table) {
      setTableTools(null)
      return
    }
    const wrapperRect = wrapper.getBoundingClientRect()
    const tableRect = table.getBoundingClientRect()
    const toolbarWidth = Math.min(650, Math.max(280, wrapperRect.width - 16))
    const left = Math.max(8, Math.min(tableRect.left - wrapperRect.left, wrapperRect.width - toolbarWidth - 8))
    const top = Math.max(8, Math.min(tableRect.top - wrapperRect.top - 38, wrapperRect.height - 42))
    setTableTools({ cell, top, left })
  }, [readOnly, viewMode])

  useEffect(() => {
    if (viewMode !== 'edit') return
    const handleSelectionChange = () => window.requestAnimationFrame(() => updateTableTools())
    const handleResize = () => updateTableTools(tableTools?.cell || null)
    document.addEventListener('selectionchange', handleSelectionChange)
    window.addEventListener('resize', handleResize)
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange)
      window.removeEventListener('resize', handleResize)
    }
  }, [tableTools?.cell, updateTableTools, viewMode])

  const getMarkdown = useCallback((): string => {
    if (!editorRef.current) return contentRef.current
    try {
      const html = editorRef.current.innerHTML
      return editorHtmlToMarkdown(html)
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

  const clearProgrammaticHistory = useCallback(() => {
    programmaticHistoryRef.current.undo = []
    programmaticHistoryRef.current.redo = []
    pendingNativeHistoryRef.current = null
  }, [])

  const recordProgrammaticHistory = useCallback((
    before: string,
    after: string,
    html?: { beforeHtml?: string; afterHtml?: string },
  ) => {
    if (before === after) return
    const history = programmaticHistoryRef.current
    history.undo.push({ before, after, ...html })
    history.redo = []
    if (history.undo.length > 50) history.undo.shift()
  }, [])

  const restoreProgrammaticHistory = useCallback((direction: 'undo' | 'redo'): boolean => {
    const root = editorRef.current
    const history = programmaticHistoryRef.current
    const source = direction === 'undo' ? history.undo : history.redo
    const target = direction === 'undo' ? history.redo : history.undo
    const entry = source[source.length - 1]
    if (!root || !entry) return false

    const current = getMarkdown()
    const expected = direction === 'undo' ? entry.after : entry.before
    // Native edits can sit on top of a programmatic table/code action. Keep
    // the Markdown-level entry until Chromium has undone those native edits and
    // the document matches the snapshot again.
    if (current !== expected) return false

    source.pop()
    target.push(entry)
    const nextContent = direction === 'undo' ? entry.before : entry.after
    const nextHtml = direction === 'undo' ? entry.beforeHtml : entry.afterHtml
    root.innerHTML = nextHtml || renderMarkdown(nextContent, settings.showCodeLangLabel, 'editable')
    contentRef.current = nextContent
    pendingContent.current = nextContent
    skipNextRender.current = true
    onChange(nextContent)
    root.focus()
    placeCaretAtEnd(root)
    return true
  }, [clearProgrammaticHistory, getMarkdown, onChange, settings.showCodeLangLabel])

  function execFormatBlock(tagName: string): boolean {
    return applyBlockFormat(editorRef.current, tagName)
  }

  const execFormat = useCallback((cmd: string, val?: string) => {
    const el = editorRef.current
    if (!selectionIsInside(el)) {
      el?.focus()
      return
    }
    switch (cmd) {
      case 'bold':
        applyNativeEditingCommand(el, 'bold')
        break
      case 'italic':
        applyNativeEditingCommand(el, 'italic')
        break
      case 'strikeThrough':
        applyNativeEditingCommand(el, 'strikeThrough')
        break
      case 'underline':
        applyNativeEditingCommand(el, 'underline')
        break
      case 'formatBlock':
        if (val) execFormatBlock(val.replace(/[<>]/g, ''))
        break
      case 'insertUnorderedList': {
        const before = getMarkdown()
        if (applyNativeEditingCommand(el, 'insertUnorderedList')) {
          normalizeListDomNesting(el)
          normalizeListBlockStructure(el)
          recordProgrammaticHistory(before, getMarkdown())
        }
        break
      }
      case 'insertOrderedList': {
        const before = getMarkdown()
        if (applyNativeEditingCommand(el, 'insertOrderedList')) {
          normalizeListDomNesting(el)
          normalizeListBlockStructure(el)
          recordProgrammaticHistory(before, getMarkdown())
        }
        break
      }
      case 'insertText':
        if (val) insertTextAtCursor(el, val)
        break
      case 'cut':
        if (selToString()) {
          navigator.clipboard.writeText(window.getSelection()!.toString()).catch(() => {})
          applyNativeEditingCommand(el, 'delete')
        }
        break
      case 'copy':
        if (selToString()) {
          navigator.clipboard.writeText(window.getSelection()!.toString()).catch(() => {})
        }
        break
      case 'undo':
        applyNativeEditingCommand(el, 'undo')
        window.setTimeout(emitChange, 0)
        return
      case 'redo':
        applyNativeEditingCommand(el, 'redo')
        window.setTimeout(emitChange, 0)
        return
      default:
        // Fallback for unsupported commands
        return
    }
    emitChange()
    el?.focus()
  }, [emitChange, getMarkdown, recordProgrammaticHistory])

  const insertInlineCode = useCallback(() => {
    if (insertInlineElement(editorRef.current, 'code')) emitChange()
    editorRef.current?.focus()
  }, [emitChange])

  const insertLink = useCallback((url: string) => {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return false
    }
    if (!['https:', 'http:', 'mailto:'].includes(parsed.protocol)) return false
    const inserted = insertInlineElement(editorRef.current, 'a', 'link', { href: parsed.toString() })
    if (inserted) emitChange()
    return inserted
  }, [emitChange])

  const insertTable = useCallback(() => {
    if (readOnly) return
    const before = getMarkdown()
    const table = insertTableAtSelection(editorRef.current)
    if (!table) {
      editorRef.current?.focus()
      return
    }
    const after = getMarkdown()
    recordProgrammaticHistory(before, after)
    emitChange()
    const firstCell = table.querySelector<HTMLTableCellElement>('th,td')
    window.requestAnimationFrame(() => updateTableTools(firstCell))
  }, [emitChange, getMarkdown, readOnly, recordProgrammaticHistory, updateTableTools])

  const runTableAction = useCallback((action: (table: HTMLTableElement, cell: HTMLTableCellElement) => HTMLTableCellElement | null | void) => {
    if (readOnly) return
    const cell = tableTools?.cell
    const table = cell?.closest('table')
    if (!cell || !table || !editorRef.current?.contains(table)) {
      setTableTools(null)
      return
    }
    const before = getMarkdown()
    const nextCell = action(table, cell) || cell
    const after = getMarkdown()
    recordProgrammaticHistory(before, after)
    emitChange()
    if (nextCell instanceof HTMLTableCellElement && nextCell.isConnected) {
      placeCaretAtStart(nextCell)
      editorRef.current?.focus()
      window.requestAnimationFrame(() => updateTableTools(nextCell))
    } else {
      setTableTools(null)
    }
  }, [emitChange, getMarkdown, readOnly, recordProgrammaticHistory, tableTools?.cell, updateTableTools])

  const copyActiveTableCsv = useCallback(async () => {
    const table = tableTools?.cell.closest('table')
    if (!table) return
    try { await window.electronAPI.writeClipboardText(visualTableToCsv(table)) }
    catch (error) { console.error('Failed to copy table CSV:', error) }
  }, [tableTools?.cell])

  const pasteActiveTableCsv = useCallback(async () => {
    const table = tableTools?.cell.closest('table')
    if (!table || !editorRef.current) return
    try {
      const before = getMarkdown()
      const source = await window.electronAPI.readClipboardText()
      const firstCell = replaceVisualTableFromCsv(table, source)
      if (!firstCell) return
      const after = getMarkdown()
      recordProgrammaticHistory(before, after)
      emitChange()
      placeCaretAtStart(firstCell)
      editorRef.current.focus()
      window.requestAnimationFrame(() => updateTableTools(firstCell))
    } catch (error) {
      console.error('Failed to paste table CSV:', error)
    }
  }, [emitChange, getMarkdown, recordProgrammaticHistory, tableTools?.cell, updateTableTools])

  const handleEditorMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement
    const wikiLink = target.closest<HTMLElement>('a.wiki-link[data-wiki-title]')
    if (wikiLink?.dataset.wikiTitle && onOpenWikiLink) {
      event.preventDefault()
      onOpenWikiLink(wikiLink.dataset.wikiTitle)
      return
    }
    const heading = target.closest<HTMLElement>('h1,h2,h3,h4,h5,h6')
    if (heading && editorRef.current?.contains(heading)) {
      const rect = heading.getBoundingClientRect()
      const inFoldGutter = event.clientX >= rect.left - 32 && event.clientX <= rect.left - 2
      if (inFoldGutter || event.altKey) {
        event.preventDefault()
        toggleHeadingFold(heading)
        setTableTools(null)
        return
      }
    }
    const listItem = target.closest('li') as HTMLLIElement | null
    if (listItem && editorRef.current?.contains(listItem) && Array.from(listItem.children).some(child => child.matches('ul,ol'))) {
      const rect = listItem.getBoundingClientRect()
      const inFoldGutter = event.clientX >= rect.left - 30 && event.clientX <= rect.left - 2
      if (inFoldGutter || event.altKey) {
        event.preventDefault()
        toggleListFold(listItem)
        setTableTools(null)
      }
    }
  }, [onOpenWikiLink])

  const handleCodeBlockClick = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || !sel.rangeCount) return
    const range = sel.getRangeAt(0)
    if (!selectionIsInside(editorRef.current, range)) { editorRef.current?.focus(); return }
    const existingCodeBlock = closestCodeBlock(range.startContainer)
    if (existingCodeBlock && editorRef.current?.contains(existingCodeBlock)) {
      if (insertParagraphAfterCodeBlock(editorRef.current, existingCodeBlock, sel)) emitChange()
      return
    }
    if (insertCodeBlockAtSelection(editorRef.current, '', settings.showCodeLangLabel, sel)) emitChange()
  }, [emitChange, settings.showCodeLangLabel])

  const toggleLanguagePicker = useCallback(() => {
    if (showLangPicker) {
      langSelectionRef.current = null
      langTargetRef.current = null
      setShowLangPicker(false)
      return
    }
    const selection = window.getSelection()
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null
    langSelectionRef.current = range && selectionIsInside(editorRef.current, range) ? range.cloneRange() : null
    langTargetRef.current = range ? closestCodeBlock(range.startContainer) : null
    setShowLangPicker(true)
  }, [showLangPicker])

  const handleLangSelect = useCallback((lang: string) => {
    setShowLangPicker(false)
    setLangFilter('')
    const sel = window.getSelection()
    const range = langSelectionRef.current
    const target = langTargetRef.current
    langSelectionRef.current = null
    langTargetRef.current = null
    if (!sel || !editorRef.current) return

    // Keep a direct reference to the selected <pre> as well as its Range. A
    // language change re-highlights the code and Chromium can invalidate the
    // saved Range; the target ref lets clearing/changing the language still
    // operate on the same block instead of silently keeping the old language.
    const existingCodeBlock = target && editorRef.current.contains(target)
      ? target
      : range && selectionIsInside(editorRef.current, range)
        ? closestCodeBlock(range.startContainer)
        : null
    if (existingCodeBlock && editorRef.current.contains(existingCodeBlock)) {
      if (range && selectionIsInside(editorRef.current, range)) {
        sel.removeAllRanges()
        sel.addRange(range)
      } else {
        const code = existingCodeBlock.querySelector<HTMLElement>('code') || existingCodeBlock
        placeCaretAtEnd(code, sel)
      }
      const before = getMarkdown()
      if (updateCodeBlockLanguage(editorRef.current, existingCodeBlock, lang, settings.showCodeLangLabel, sel)) {
        recordProgrammaticHistory(before, getMarkdown())
        emitChange()
      }
      return
    }
    if (insertCodeBlockAtSelection(editorRef.current, lang, settings.showCodeLangLabel, sel)) emitChange()
  }, [emitChange, getMarkdown, recordProgrammaticHistory, settings.showCodeLangLabel])

  const { menu: ctxMenu, handleContextMenu, closeMenu } = useEditorContextMenu(
    editorRef, execFormat, insertInlineCode, insertLink, emitChange,
    () => setSearchVisible(true)
  )

  const getTextBeforeCursor = useCallback((): string => {
    if (!editorRef.current) return ''
    const offset = getCaretOffset(editorRef.current)
    if (offset === null) return ''
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
    if (!insertTextAtCursor(editorRef.current, suggestion)) return
    emitChange()
    editorRef.current.focus()
  }, [emitChange])

  const contentPropChanged = previousContentPropRef.current !== content
  const noteIdentityChanged = previousNoteIdRef.current !== noteId
  previousContentPropRef.current = content
  previousNoteIdRef.current = noteId
  contentRef.current = content

  useEffect(() => {
    if (!focusRequestId || readOnly || viewMode === 'preview') return
    const frame = requestAnimationFrame(() => {
      const target = viewMode === 'source' ? sourceTaRef.current : editorRef.current
      if (!target || target.offsetParent === null) return
      target.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [focusRequestId, readOnly, viewMode])

  useEffect(() => {
    if (!editorRef.current) return
    const el = editorRef.current
    const currentMarkdown = getMarkdown()
    const isEchoOfCurrentEditor = contentPropChanged && currentMarkdown === content
    // Notes can legitimately have identical Markdown. Clear editor-only state
    // by stable note identity as well as by an external content replacement so
    // Cmd/Ctrl+Z from note A can never modify a just-opened note B.
    if (noteIdentityChanged || (contentPropChanged && !skipNextRender.current && content !== pendingContent.current && !isEchoOfCurrentEditor)) clearProgrammaticHistory()
    if (viewMode !== 'edit') return
    if (skipNextRender.current) {
      skipNextRender.current = false
      if (content === pendingContent.current) {
        pendingContent.current = ''
        return
      }
      pendingContent.current = ''
    }
    // Parent state can echo a DOM transaction while React is also re-rendering
    // the language picker. If the Markdown is already identical, preserve the
    // live editor DOM (and its selection/history markers) instead of replacing
    // the <pre>, which would invalidate the saved code-block target. Re-render
    // only when the code-label setting itself changed.
    if (currentMarkdown === content && !codeLabelSettingChanged && !noteIdentityChanged) return
    const saved = getCaretOffset(el)
    const html = renderMarkdown(content, settings.showCodeLangLabel, 'editable')
    if (noteIdentityChanged || el.innerHTML !== html) {
      el.innerHTML = html
      if (saved !== null) {
        try { setCaretByOffset(el, saved) } catch {}
      }
    }
  }, [clearProgrammaticHistory, codeLabelSettingChanged, content, contentPropChanged, getMarkdown, noteIdentityChanged, settings.showCodeLangLabel, viewMode])

  useEffect(() => {
    if (viewMode === 'edit') return
    const handleModeShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === '/') {
        event.preventDefault()
        setViewMode(current => current === 'source' ? 'preview' : 'edit')
      }
    }
    window.addEventListener('keydown', handleModeShortcut)
    return () => window.removeEventListener('keydown', handleModeShortcut)
  }, [viewMode])

  const handleSave = useCallback(() => {
    void Promise.resolve(onSave(contentRef.current)).catch(error => console.error('Failed to save note:', error))
  }, [onSave])

  const insertBlock = useCallback((tag: string) => {
    execFormat('formatBlock', `<${tag}>`)
  }, [execFormat])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey) {
      const shortcutKey = e.key.toLowerCase()
      const historyShortcut = getHistoryShortcut(shortcutKey, e.shiftKey)
      if (historyShortcut) {
        // Prefer the Markdown-level stack for direct DOM transactions such as
        // visual-table edits. Ordinary typing continues to use Chromium's
        // native history, including Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z.
        if (restoreProgrammaticHistory(historyShortcut)) {
          e.preventDefault()
          return
        }
        pendingNativeHistoryRef.current = { direction: historyShortcut, before: getMarkdown() }
        if (shortcutKey === 'z') return
        e.preventDefault()
        applyNativeEditingCommand(editorRef.current, historyShortcut)
        window.setTimeout(emitChange, 0)
        return
      }
      switch (shortcutKey) {
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
          const url = prompt('Enter URL:', 'https://')
          if (url) insertLink(url)
          return
        case '1': case '2': case '3': case '4': case '5': case '6':
          e.preventDefault()
          const hLevel = parseInt(shortcutKey)
          insertBlock(`h${hLevel}`)
          return
        case '/':
          e.preventDefault()
          setViewMode(prev => prev === 'edit' ? 'source' : prev === 'source' ? 'preview' : 'edit')
          return
      }
      if (isInlineCodeShortcut(e)) {
        e.preventDefault()
        insertInlineCode()
        return
      }
      if (e.shiftKey && shortcutKey === 'c') {
        e.preventDefault()
        handleCodeBlockClick()
        return
      }
      if (shortcutKey === 'f') {
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

    if ((e.key === 'Backspace' || e.key === 'Delete') && removeCodeBlockAtSelection(editorRef.current)) {
      e.preventDefault()
      emitChange()
      return
    }

    if (e.key === 'Tab') {
      e.preventDefault()
      const selection = window.getSelection()
      const anchor = selection?.anchorNode
      const tableCell = anchor?.nodeType === Node.ELEMENT_NODE
        ? (anchor as HTMLElement).closest('th,td') as HTMLTableCellElement | null
        : anchor?.parentElement?.closest('th,td') as HTMLTableCellElement | null
      const table = tableCell?.closest('table')
      if (tableCell && table && editorRef.current?.contains(table)) {
        const before = getMarkdown()
        const result = moveAcrossVisualTable(table, tableCell, e.shiftKey, selection)
        if (result.changed) {
          const after = getMarkdown()
          recordProgrammaticHistory(before, after)
          emitChange()
        }
        if (result.cell) window.requestAnimationFrame(() => updateTableTools(result.cell))
        return
      }
      const listItem = anchor?.nodeType === Node.ELEMENT_NODE
        ? (anchor as HTMLElement).closest('li')
        : anchor?.parentElement?.closest('li')
      if (listItem && editorRef.current?.contains(listItem)) {
        const before = getMarkdown()
        if (applyNativeEditingCommand(editorRef.current, e.shiftKey ? 'outdent' : 'indent')) {
          normalizeListDomNesting(editorRef.current)
          normalizeListBlockStructure(editorRef.current)
          recordProgrammaticHistory(before, getMarkdown())
          emitChange()
        }
        return
      }
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
            removeCodeCaretAnchors(editorRef.current)
            if (insertParagraphAfterCodeBlock(editorRef.current, pre as HTMLPreElement, sel)) emitChange()
          } else {
            e.preventDefault()
            const before = getMarkdown()
            if (insertCodeNewlineAtSelection(editorRef.current, pre as HTMLPreElement, sel)) {
              recordProgrammaticHistory(before, getMarkdown())
              emitChange()
            }
          }
          return
        }
        const blockquote = node.nodeType === Node.ELEMENT_NODE
          ? (node as HTMLElement).closest('blockquote')
          : node.parentElement?.closest('blockquote')
        if (blockquote) {
          e.preventDefault()
          const changed = e.shiftKey
            ? insertSoftBreakAtSelection(editorRef.current, sel)
            : exitBlockquoteAtSelection(editorRef.current, sel)
          if (changed) emitChange()
          return
        }
        const li = node.nodeType === Node.ELEMENT_NODE
          ? (node as HTMLElement).closest('li')
          : node.parentElement?.closest('li')
        if (li) {
          if (!e.shiftKey && !(li.textContent || '').replace(/[\s\u00a0\u200b]/g, '')) {
            e.preventDefault()
            const before = getMarkdown()
            const beforeHtml = editorRef.current?.innerHTML
            if (applyNativeEditingCommand(editorRef.current, 'outdent')) {
              applyNativeEditingCommand(editorRef.current, 'formatBlock', 'p')
              normalizeListBlockStructure(editorRef.current)
              recordProgrammaticHistory(before, getMarkdown(), { beforeHtml, afterHtml: editorRef.current?.innerHTML })
              emitChange()
            }
          }
          // Chromium provides undoable continuation and soft breaks for
          // non-empty items; only empty-item exit needs structural cleanup.
          return
        }
        const h = node.nodeType === Node.ELEMENT_NODE
          ? (node as HTMLElement).closest('h1,h2,h3,h4,h5,h6')
          : node.parentElement?.closest('h1,h2,h3,h4,h5,h6')
        if (h && isCaretAtEndOfElement(h as HTMLElement, sel.getRangeAt(0))) {
          e.preventDefault()
          if (insertParagraphAfterHeading(editorRef.current, h as HTMLElement, sel)) emitChange()
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
      if (el instanceof HTMLLIElement) {
        if (!el.textContent?.trim()) {
          // Native Backspace merges an empty item into the previous list item.
          // Outdent instead produces an undoable normal paragraph for body text.
          e.preventDefault()
          const before = getMarkdown()
          const beforeHtml = editorRef.current?.innerHTML
          if (applyNativeEditingCommand(editorRef.current, 'outdent')) {
            applyNativeEditingCommand(editorRef.current, 'formatBlock', 'p')
            normalizeListBlockStructure(editorRef.current)
            recordProgrammaticHistory(before, getMarkdown(), { beforeHtml, afterHtml: editorRef.current?.innerHTML })
            emitChange()
          }
        }
        return
      }
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
        insertTextAtCursor(editorRef.current, e.key + pair)
        const sel = window.getSelection()
        if (sel && sel.rangeCount) {
          const range = sel.getRangeAt(0)
          range.setStart(range.startContainer, range.startOffset - 1)
          range.collapse(true)
          sel.removeAllRanges()
          sel.addRange(range)
        }
        emitChange()
        return
      }
    }

  }, [handleSave, emitChange, execFormat, getMarkdown, insertBlock, insertInlineCode, insertLink, handleCodeBlockClick, recordProgrammaticHistory, restoreProgrammaticHistory, updateTableTools])

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
      insertTextAtCursor(editorRef.current, plainText)
    } else {
      insertTextAtCursor(editorRef.current, text)
    }
    emitChange()
  }, [emitChange])

  const handleCompositionStart = useCallback(() => { composingRef.current = true }, [])
  const handleCompositionEnd = useCallback(() => {
    composingRef.current = false
    emitChange()
  }, [emitChange])

  const handleEditorInput = useCallback((event: React.FormEvent<HTMLDivElement>) => {
    const inputType = (event.nativeEvent as InputEvent).inputType
    const pendingNativeHistory = pendingNativeHistoryRef.current
    pendingNativeHistoryRef.current = null

    if (inputType === 'historyUndo' || inputType === 'historyRedo') {
      syncCodeBlockLanguageHistory(editorRef.current)
      removeCodeCaretAnchors(editorRef.current)
      const after = getMarkdown()
      if (pendingNativeHistory && pendingNativeHistory.before !== after) {
        const history = programmaticHistoryRef.current
        if (pendingNativeHistory.direction === 'undo') {
          // Chromium has already undone this native transaction. Preserve an
          // equivalent Markdown snapshot so redo still works after a table/code
          // transaction re-renders the contenteditable and clears native redo.
          history.redo.push({ before: after, after: pendingNativeHistory.before })
          if (history.redo.length > 50) history.redo.shift()
        } else {
          history.undo.push({ before: pendingNativeHistory.before, after })
          if (history.undo.length > 50) history.undo.shift()
        }
      }
    } else {
      removeCodeCaretAnchors(editorRef.current)
      // A fresh native edit invalidates redo, but must not discard earlier
      // programmatic actions that should become undoable once native edits are
      // undone first.
      programmaticHistoryRef.current.redo = []
    }
    emitChange()
  }, [emitChange, getMarkdown])

  const handleAITransform = useCallback(async (action: AITransformAction) => {
    if (aiTransformBusy || !isConfigured()) return
    setShowAITransform(false)
    const textarea = viewMode === 'source' ? sourceTaRef.current : null
    const sourceSelection = textarea ? { start: textarea.selectionStart, end: textarea.selectionEnd } : null
    const selection = window.getSelection()
    const range = !textarea && selection?.rangeCount && selectionIsInside(editorRef.current, selection.getRangeAt(0))
      ? selection.getRangeAt(0).cloneRange()
      : null
    const selectedText = textarea && sourceSelection
      ? textarea.value.slice(sourceSelection.start, sourceSelection.end)
      : range?.toString() || ''
    if (!selectedText.trim()) {
      window.alert(t.ai.selectTextFirst)
      return
    }
    setAITransformBusy(true)
    try {
      const replacement = await transformAISelection(selectedText.slice(0, 12_000), action)
      if (!replacement) return
      if (textarea && sourceSelection) {
        textarea.focus()
        textarea.setSelectionRange(sourceSelection.start, sourceSelection.end)
        if (!document.execCommand('insertText', false, replacement)) {
          textarea.setRangeText(replacement, sourceSelection.start, sourceSelection.end, 'end')
          textarea.dispatchEvent(new Event('input', { bubbles: true }))
        }
        onChange(textarea.value)
      } else if (range && selection && editorRef.current?.contains(range.commonAncestorContainer)) {
        editorRef.current.focus()
        selection.removeAllRanges()
        selection.addRange(range)
        if (insertTextAtCursor(editorRef.current, replacement)) emitChange()
      }
    } catch (error) {
      window.alert(`${t.ai.error}: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setAITransformBusy(false)
    }
  }, [aiTransformBusy, emitChange, onChange, t.ai.error, t.ai.selectTextFirst, viewMode])

  const handleWikiLinkEvent = useCallback((target: EventTarget | null): boolean => {
    const anchor = target instanceof Element ? target.closest<HTMLElement>('a.wiki-link[data-wiki-title]') : null
    if (!anchor?.dataset.wikiTitle || !onOpenWikiLink) return false
    onOpenWikiLink(anchor.dataset.wikiTitle)
    return true
  }, [onOpenWikiLink])

  const wordCount = useMemo(() => countWords(content), [content])
  const lineCount = useMemo(() => content.split('\n').length, [content])
  const saveStateLabel = saveStatus?.state === 'saving'
    ? t.editor.saving
    : saveStatus?.state === 'error'
      ? `${t.editor.saveFailed} · ${t.editor.retrySave}`
      : t.editor.saved
  const saveStateTitle = saveStatus?.state === 'error' ? saveStatus.error || t.editor.saveFailed : saveStateLabel
  const saveControls = saveStatus ? (
    <>
      <button
        className={`editor-save-status ${saveStatus.state}`}
        onClick={() => {
          if (saveStatus.state === 'error' && onRetrySave) {
            void Promise.resolve(onRetrySave()).catch(error => console.error('Failed to retry note save:', error))
          }
        }}
        disabled={saveStatus.state !== 'error' || !onRetrySave}
        title={saveStateTitle}
        aria-live="polite"
      >
        <span className="editor-save-dot" />
        {saveStateLabel}
      </button>
      {onOpenHistory && (
        <button className="editor-history-action" onClick={onOpenHistory} title={t.editor.versionHistory}>
          {t.editor.versionHistory}
        </button>
      )}
    </>
  ) : null
  const transformActions: Array<{ id: AITransformAction; zh: string; en: string }> = [
    { id: 'polish', zh: '润色', en: 'Polish' },
    { id: 'translate-zh', zh: '翻译为中文', en: 'Translate to Chinese' },
    { id: 'translate-en', zh: '翻译为英文', en: 'Translate to English' },
    { id: 'shorten', zh: '精简', en: 'Shorten' },
    { id: 'expand', zh: '扩写', en: 'Expand' },
    { id: 'summarize', zh: '总结', en: 'Summarize' },
    { id: 'to-list', zh: '转换为列表', en: 'Convert to list' },
    { id: 'to-table', zh: '转换为表格', en: 'Convert to table' },
  ]
  const aiTransformControls = isConfigured() ? (
    <div className="editor-ai-transform">
      <button className={`editor-tb-btn ${showAITransform ? 'active' : ''}`} disabled={aiTransformBusy} onMouseDown={event => event.preventDefault()} onClick={() => setShowAITransform(value => !value)} title={locale === 'zh' ? 'AI 处理选中文本' : 'AI transform selection'}>
        <span className="editor-ai-label">AI</span>
      </button>
      {showAITransform && <div className="editor-ai-transform-menu">{transformActions.map(action => <button key={action.id} onMouseDown={event => event.preventDefault()} onClick={() => { void handleAITransform(action.id) }}>{locale === 'zh' ? action.zh : action.en}</button>)}</div>}
    </div>
  ) : null

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
            {aiTransformControls}
          </div>
          <div className="editor-toolbar-spacer" />
          <span className="editor-mode-label">{t.editor.preview}</span>
          <div className="editor-toolbar-end">
            {saveControls}
            <span className="editor-status">{wordCount} {t.editor.words} · {lineCount} {t.editor.lines}</span>
          </div>
        </div>
        <div
          className="editor-content editor-preview"
          onClick={event => {
            if (handleWikiLinkEvent(event.target)) event.preventDefault()
          }}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(content, settings.showCodeLangLabel) }}
        />
      </div>
    )
  }

  if (viewMode === 'source') {
    const handleSourceChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      clearProgrammaticHistory()
      onChange(e.target.value)
    }

    const handleSourceKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const shortcutKey = e.key.toLowerCase()
      if (e.key === 'Tab') {
        e.preventDefault()
        const ta = e.currentTarget
        const edit = editTextIndent(ta.value, ta.selectionStart, ta.selectionEnd, e.shiftKey)
        applyTextAreaEdit(ta, edit)
        if (ta.value !== contentRef.current) {
          clearProgrammaticHistory()
          onChange(ta.value)
        }
        return
      }
      if ((e.ctrlKey || e.metaKey) && shortcutKey === 's') {
        e.preventDefault()
        handleSave()
        return
      }
      if ((e.ctrlKey || e.metaKey) && shortcutKey === 'y') {
        e.preventDefault()
        clearProgrammaticHistory()
        const textarea = e.currentTarget
        if (typeof document.execCommand === 'function') document.execCommand('redo')
        window.setTimeout(() => onChange(textarea.value), 0)
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
            {aiTransformControls}
          </div>
          <div className="editor-toolbar-spacer" />
          <span className="editor-mode-label">{t.editor.source}</span>
          <div className="editor-toolbar-end">
            {saveControls}
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
          <button className="editor-tb-btn" onClick={() => execFormat('bold')} title={shortcutLabel(t.editor.bold)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M15.6 10.79c.97-.67 1.65-1.77 1.65-2.79 0-2.26-1.75-4-4-4H7v14h7.04c2.09 0 3.71-1.7 3.71-3.79 0-1.52-.86-2.82-2.15-3.42zM10 6.5h3c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-3v-3zm3.5 9H10v-3h3.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5z"/></svg>
          </button>
          <button className="editor-tb-btn" onClick={() => execFormat('italic')} title={shortcutLabel(t.editor.italic)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4v3h2.21l-3.42 8H6v3h8v-3h-2.21l3.42-8H18V4z"/></svg>
          </button>
          <button className="editor-tb-btn" onClick={() => execFormat('strikeThrough')} title={shortcutLabel(t.editor.strikethrough)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 12h12M3 5l3 2M18 5l-3 2M5 19l3-2M19 19l-3-2"/></svg>
          </button>
          <button className="editor-tb-btn" onMouseDown={e => e.preventDefault()} onClick={insertInlineCode} title={shortcutLabel(t.editor.inlineCode)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
          </button>
        </div>
        <div className="editor-toolbar-divider" />
        <div className="editor-toolbar-group">
          <button className="editor-tb-btn editor-tb-label" onClick={() => insertBlock('h1')} title={shortcutLabel(t.editor.heading1)}>H1</button>
          <button className="editor-tb-btn editor-tb-label" onClick={() => insertBlock('h2')} title={shortcutLabel(t.editor.heading2)}>H2</button>
          <button className="editor-tb-btn editor-tb-label" onClick={() => insertBlock('h3')} title={shortcutLabel(t.editor.heading3)}>H3</button>
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
            <button className="editor-tb-btn" onMouseDown={e => e.preventDefault()} onClick={handleCodeBlockClick} title={shortcutLabel(t.editor.codeBlock)}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <polyline points="9 9 6 12 9 15" />
                <polyline points="15 9 18 12 15 15" />
              </svg>
            </button>
            <button
              className="editor-tb-btn editor-code-language-btn"
              onMouseDown={e => e.preventDefault()}
              onClick={toggleLanguagePicker}
              title={t.editor.codeLanguage}
              aria-expanded={showLangPicker}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {showLangPicker && (
              <div className="lang-picker">
                <div className="lang-picker-header">
                  <input
                    className="lang-picker-input"
                    type="text"
                    value={langFilter}
                    onChange={e => setLangFilter(e.target.value)}
                    placeholder={t.editor.filterLanguages}
                    autoFocus
                    onKeyDown={e => {
                      if (e.key === 'Escape') { setShowLangPicker(false); setLangFilter(''); langSelectionRef.current = null; langTargetRef.current = null }
                      if (e.key === 'Enter' && langFilter.trim()) {
                        handleLangSelect(langFilter.trim().toLowerCase())
                      }
                    }}
                  />
                </div>
                <div className="lang-picker-list">
                  <button
                    className="lang-picker-item lang-picker-no-language"
                    onClick={() => handleLangSelect('')}
                    onMouseDown={e => e.preventDefault()}
                  >
                    {t.editor.noLanguage}
                  </button>
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
          <button className="editor-tb-btn" disabled={readOnly} onMouseDown={e => e.preventDefault()} onClick={insertTable} title={t.editor.insertTable}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 10h18M9 4v16M15 4v16"/>
            </svg>
          </button>
          <button className="editor-tb-btn" onMouseDown={e => e.preventDefault()} onClick={() => {
            const url = prompt('Enter URL:', 'https://')
            if (url) {
              insertLink(url)
            }
          }} title={shortcutLabel(t.editor.insertLink)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          </button>
          <button className="editor-tb-btn" onClick={() => expandAllEditorFolds(editorRef.current)} title={t.editor.expandAllFolds}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="7 8 12 3 17 8"/><polyline points="7 16 12 21 17 16"/><line x1="12" y1="3" x2="12" y2="21"/>
            </svg>
          </button>
          {aiTransformControls}
        </div>
        <div className="editor-toolbar-spacer" />
        <div className="editor-toolbar-end">
          {!dualPaneMode && onSplitRight && (
            <button
              className="editor-tb-btn"
              onClick={onSplitRight}
              title={canSplitRight ? t.editor.splitRight : t.editor.needSecondNote}
              aria-label={canSplitRight ? t.editor.splitRight : t.editor.needSecondNote}
              disabled={!canSplitRight}
            >
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
          {onShare && (
            <button className="editor-tb-btn" onClick={onShare} title={locale === 'zh' ? '系统分享' : 'Share'}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4"/></svg>
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
            onClick={() => setViewMode('edit')} title={`${t.editor.edit} (${formatShortcut('Ctrl+/', window.electronAPI.platform)})`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
          <button
            className="editor-mode-btn"
            onClick={() => setViewMode('source')} title={`${t.editor.source} (${formatShortcut('Ctrl+/', window.electronAPI.platform)})`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
            </svg>
          </button>
          <button
            className="editor-mode-btn"
            onClick={() => setViewMode('preview')} title={`${t.editor.preview} (${formatShortcut('Ctrl+/', window.electronAPI.platform)})`}
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
        <div ref={editorWrapperRef} className={`editor-content-wrapper ${viewMode === 'edit' ? '' : 'hidden'}`} style={{ position: 'relative' }}>
        {tableTools && (
          <div
            className="table-visual-tools"
            style={{ top: tableTools.top, left: tableTools.left }}
            onMouseDown={event => event.preventDefault()}
          >
            <button title={t.editor.addTableRow} onClick={() => runTableAction((table, cell) => addVisualTableRow(table, cell.parentElement as HTMLTableRowElement).cells.item(cell.cellIndex))}>+{t.editor.tableRow}</button>
            <button title={t.editor.addTableColumn} onClick={() => runTableAction((table, cell) => {
              const index = addVisualTableColumn(table, cell.cellIndex)
              return (cell.parentElement as HTMLTableRowElement | null)?.cells.item(index) || null
            })}>+{t.editor.tableColumn}</button>
            <button
              title={t.editor.deleteTableRow}
              disabled={tableTools.cell.parentElement?.parentElement?.tagName === 'THEAD'}
              onClick={() => runTableAction((table, cell) => {
                const row = cell.parentElement as HTMLTableRowElement
                const nextRow = row.nextElementSibling as HTMLTableRowElement | null
                const previousRow = row.previousElementSibling as HTMLTableRowElement | null
                const target = nextRow?.cells.item(Math.min(cell.cellIndex, nextRow.cells.length - 1))
                  || previousRow?.cells.item(Math.min(cell.cellIndex, previousRow.cells.length - 1))
                  || table.tHead?.rows.item(0)?.cells.item(Math.min(cell.cellIndex, (table.tHead?.rows.item(0)?.cells.length || 1) - 1))
                return deleteVisualTableRow(table, row) ? target : cell
              })}
            >−{t.editor.tableRow}</button>
            <button
              title={t.editor.deleteTableColumn}
              disabled={(tableTools.cell.closest('table')?.rows.item(0)?.cells.length || 0) <= 1}
              onClick={() => runTableAction(deleteVisualTableColumnAtCell)}
            >−{t.editor.tableColumn}</button>
            <span className="table-visual-tools-divider" />
            <button title={t.editor.alignTableLeft} onClick={() => runTableAction((table, cell) => { alignVisualTableColumn(table, cell.cellIndex, 'left') })}>L</button>
            <button title={t.editor.alignTableCenter} onClick={() => runTableAction((table, cell) => { alignVisualTableColumn(table, cell.cellIndex, 'center') })}>C</button>
            <button title={t.editor.alignTableRight} onClick={() => runTableAction((table, cell) => { alignVisualTableColumn(table, cell.cellIndex, 'right') })}>R</button>
            <span className="table-visual-tools-divider" />
            <button title={locale === 'zh' ? '按当前列升序排序' : 'Sort current column ascending'} onClick={() => runTableAction((table, cell) => { sortVisualTableColumn(table, cell.cellIndex, 'asc') })}>A↑</button>
            <button title={locale === 'zh' ? '按当前列降序排序' : 'Sort current column descending'} onClick={() => runTableAction((table, cell) => { sortVisualTableColumn(table, cell.cellIndex, 'desc') })}>A↓</button>
            <button title={locale === 'zh' ? '复制表格为 CSV' : 'Copy table as CSV'} onClick={() => { void copyActiveTableCsv() }}>CSV↑</button>
            <button title={locale === 'zh' ? '从剪贴板 CSV 替换表格' : 'Replace table from clipboard CSV'} onClick={() => { void pasteActiveTableCsv() }}>CSV↓</button>
            <span className="table-visual-tools-divider" />
            <button className="table-visual-tools-danger" title={t.editor.deleteTable} onClick={() => {
              const cell = tableTools.cell
              const table = cell.closest('table')
              const before = getMarkdown()
              if (table && deleteVisualTable(editorRef.current, table)) {
                recordProgrammaticHistory(before, getMarkdown())
                emitChange()
                setTableTools(null)
              }
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
            </button>
          </div>
        )}
        <div
          ref={editorRef}
          className="editor-content editor-wysiwyg"
          contentEditable={!readOnly}
          onInput={handleEditorInput}
          onFocus={e => markEditorActive(e.currentTarget)}
          onKeyDown={handleKeyDown}
          onKeyUp={() => updateTableTools()}
          onMouseDown={handleEditorMouseDown}
          onMouseUp={() => updateTableTools()}
          onScroll={() => updateTableTools(tableTools?.cell || null)}
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
        {saveControls}
        {inlineAiEnabled && <span className="editor-status-item editor-status-ai">AI</span>}
        <span className="editor-status-item editor-status-markdown">Markdown</span>
      </div>
    </div>
  )
}
