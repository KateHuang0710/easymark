import { RefObject, useEffect, useRef } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    element => element.getAttribute('aria-hidden') !== 'true' && element.offsetParent !== null,
  )
}

/**
 * Keeps keyboard focus inside an app-level modal and restores it to the
 * invoking control after the modal closes.
 */
export function useDialogFocus(
  visible: boolean,
  dialogRef: RefObject<HTMLElement | null>,
  initialFocusRef?: RefObject<HTMLElement | null>,
) {
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!visible) return

    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const frame = requestAnimationFrame(() => {
      const dialog = dialogRef.current
      if (!dialog) return
      const target = initialFocusRef?.current || getFocusableElements(dialog)[0] || dialog
      target.focus({ preventScroll: true })
    })

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const dialog = dialogRef.current
      if (!dialog) return
      const focusable = getFocusableElements(dialog)
      if (focusable.length === 0) {
        event.preventDefault()
        dialog.focus({ preventScroll: true })
        return
      }

      const active = document.activeElement as HTMLElement | null
      const activeIndex = active ? focusable.indexOf(active) : -1
      if (event.shiftKey) {
        if (activeIndex <= 0) {
          event.preventDefault()
          focusable[focusable.length - 1].focus({ preventScroll: true })
        }
      } else if (activeIndex === -1 || activeIndex === focusable.length - 1) {
        event.preventDefault()
        focusable[0].focus({ preventScroll: true })
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', handleKeyDown, true)
      const previous = previousFocusRef.current
      requestAnimationFrame(() => {
        if (!previous?.isConnected) return
        if (document.querySelector('[aria-modal="true"]')) return
        const active = document.activeElement
        if (active && active !== document.body && active !== document.documentElement) return
        previous.focus({ preventScroll: true })
      })
    }
  }, [dialogRef, initialFocusRef, visible])
}
