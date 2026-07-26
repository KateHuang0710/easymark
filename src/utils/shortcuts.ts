export type DesktopPlatform = 'darwin' | 'win32' | 'linux'

export interface ShortcutKeyboardEvent {
  key: string
  code?: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

export function formatShortcut(shortcut: string, platform: DesktopPlatform): string {
  if (platform !== 'darwin') return shortcut
  return shortcut
    .replace(/Ctrl\+/g, 'Cmd+')
    .replace(/Alt\+/g, 'Option+')
}

export function formatShortcutLabel(label: string, platform: DesktopPlatform): string {
  return formatShortcut(label, platform)
}

export function isInlineCodeShortcut(event: ShortcutKeyboardEvent): boolean {
  return (event.ctrlKey || event.metaKey)
    && event.shiftKey
    && (event.code === 'Backquote' || event.key === '`' || event.key === '~')
}
