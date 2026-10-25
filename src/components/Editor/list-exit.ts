/**
 * Lifts an empty list item out of every enclosing list and leaves an editable
 * paragraph behind it.
 *
 * `document.execCommand('outdent')` only raises a nested item by one level, so
 * pressing Enter on an empty third-level item used to continue the outer list
 * instead of exiting it, silently turning the following prose into a new item.
 */
export function exitListItemToParagraph(root: HTMLElement | null, listItem: HTMLLIElement): boolean {
  if (!root || !root.contains(listItem)) return false
  let outerList = listItem.closest('ol,ul') as HTMLElement | null
  if (!outerList) return false

  let ancestorItem = outerList.parentElement?.closest('li') ?? null
  while (ancestorItem) {
    const parentList = ancestorItem.closest('ol,ul') as HTMLElement | null
    if (!parentList) break
    outerList = parentList
    ancestorItem = parentList.parentElement?.closest('li') ?? null
  }

  const paragraph = document.createElement('p')
  paragraph.appendChild(document.createElement('br'))
  listItem.remove()
  outerList.insertAdjacentElement('afterend', paragraph)

  // Nested lists that lost their only item would otherwise linger as empty
  // <ol>/<ul> nodes and round-trip through Markdown as blank list markers.
  for (const list of Array.from(root.querySelectorAll('ol,ul'))) {
    if (!list.querySelector('li') && !(list.textContent || '').trim()) list.remove()
  }

  const selection = window.getSelection()
  if (selection) {
    const range = document.createRange()
    range.setStart(paragraph, 0)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
  }
  return true
}
