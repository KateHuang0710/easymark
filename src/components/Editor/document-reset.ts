/** Replaces the document with a single empty paragraph and places the caret. */
export function resetEditorToEmptyParagraph(root: HTMLElement | null): boolean {
  if (!root) return false
  root.innerHTML = '<p><br></p>'
  const selection = window.getSelection()
  if (selection) {
    const paragraph = root.firstElementChild
    const range = document.createRange()
    if (paragraph) range.setStart(paragraph, 0)
    else range.setStart(root, 0)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
  }
  return true
}
