export type EscapeHandler = (event: KeyboardEvent) => void

const escapeStack: EscapeHandler[] = []

/**
 * Registers a handler for the currently top-most layer. Handlers run in
 * reverse registration order, so one Escape press closes only the most
 * recently opened surface instead of every stacked layer at once.
 */
export function pushEscapeHandler(handler: EscapeHandler): () => void {
  escapeStack.push(handler)
  return () => {
    const index = escapeStack.lastIndexOf(handler)
    if (index !== -1) escapeStack.splice(index, 1)
  }
}

/**
 * Runs the top-most handler for an Escape press. Returns false when no layer
 * claimed the event, leaving it to fallback handling.
 */
export function runTopEscapeHandler(event: KeyboardEvent): boolean {
  const handler = escapeStack[escapeStack.length - 1]
  if (!handler) return false
  handler(event)
  event.preventDefault()
  event.stopPropagation()
  return true
}
