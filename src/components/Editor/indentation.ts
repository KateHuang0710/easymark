const INDENT_UNIT = 4

export const INDENT_TEXT = ' '.repeat(INDENT_UNIT)

function selectionIsInside(root: HTMLElement, range: Range): boolean {
  return range.commonAncestorContainer === root || root.contains(range.commonAncestorContainer)
}

function caretRange(root: HTMLElement | null): Range | null {
  if (!root) return null
  const selection = window.getSelection()
  if (!selection || !selection.rangeCount) return null
  const range = selection.getRangeAt(0)
  return selectionIsInside(root, range) ? range : null
}

function setCaret(node: Node, offset: number) {
  const selection = window.getSelection()
  if (!selection) return
  const range = document.createRange()
  range.setStart(node, offset)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
}

/**
 * Inserts literal ASCII spaces at the caret. `document.execCommand('insertText')`
 * rewrites leading spaces as U+00A0 to keep them visible, which is not a valid
 * Markdown indentation and silently pollutes the saved note.
 */
export function indentAtCaret(root: HTMLElement | null, text = INDENT_TEXT): boolean {
  const range = caretRange(root)
  if (!range || !text) return false
  range.deleteContents()
  const node = document.createTextNode(text)
  range.insertNode(node)
  setCaret(node, text.length)
  return true
}

/**
 * Removes one indentation unit from the start of the line that holds the
 * caret. Shift+Tab is the inverse of Tab: outside a list or table it must never
 * add whitespace. Inserting four spaces turned a plain paragraph into a
 * Markdown indented code block, silently rewriting the saved note.
 */
export function outdentCurrentLine(root: HTMLElement | null): boolean {
  const range = caretRange(root)
  if (!range) return false

  const node = range.startContainer
  if (node.nodeType !== Node.TEXT_NODE) return false
  const text = node.textContent || ''
  const caret = Math.max(0, Math.min(range.startOffset, text.length))
  const lineStart = text.lastIndexOf('\n', Math.max(caret - 1, 0)) + 1
  const nextBreak = text.indexOf('\n', caret)
  const lineEnd = nextBreak === -1 ? text.length : nextBreak
  const line = text.slice(lineStart, lineEnd)
  const match = /^(\t| {1,4})/.exec(line)
  if (!match) return false

  const removeLength = match[1].length
  const removal = document.createRange()
  removal.setStart(node, lineStart)
  removal.setEnd(node, lineStart + removeLength)
  const caretOffset = Math.max(lineStart, caret - removeLength)
  removal.deleteContents()
  setCaret(node, Math.min(caretOffset, (node.textContent || '').length))
  return true
}
