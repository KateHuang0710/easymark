# EasyMark Developer Guide

## Overview

EasyMark is a cross-platform Electron Markdown notes application. The renderer is React 18 + TypeScript + Vite. Privileged filesystem, AI credential/network, export, and window operations live in the Electron main process.

## Commands

```bash
npm run dev
npm run typecheck
npm run test
npm run build
npm run check
npm run pack
npm run pack:mac
npm run dist:win
npm run dist:mac
npm run dist:mac:arm64
npm run dist:mac:x64
npm run dist:mac:universal
```

## Architecture

- `electron/main.js`
  - BrowserWindow lifecycle and platform menu
  - navigation, permission and external-link guards
  - note/image IPC with sender and input validation
  - secure AI configuration via Electron `safeStorage`
  - OpenAI-compatible requests in the main process
  - PDF/DOCX export
  - close-before-save renderer handshake
- `electron/preload.js`
  - exposes a narrow, frozen `window.electronAPI`
  - never expose raw `ipcRenderer`, filesystem, shell, or Node APIs
- `electron/file-utils.js`
  - cross-platform note filename validation
  - title/export sanitization
  - image MIME and magic-byte validation
- `src/hooks/useNotes.ts`
  - note list/current note state
  - request ordering and primary-pane debounced save
- `src/App.tsx`
  - dual-pane state and secondary save queue
  - flushes both save queues before the main process confirms close
- `src/services/markdown.ts`
  - marked renderer, local image URL normalization, DOMPurify sanitization
- `src/services/ai.ts`
  - renderer-side request shaping only; it does not hold the persisted secret
- `src/contexts/SettingsContext.tsx`
  - non-secret UI settings in localStorage
  - migrates legacy renderer API keys to main-process secure storage

## Security invariants

Do not weaken these without a documented threat-model decision:

1. `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`.
2. Every privileged IPC handler validates that the sender is the current main window.
3. Renderer never receives the API Key after configuration.
4. Remote AI HTTP is allowed only for loopback; other providers require HTTPS.
5. Changing API provider origin requires re-entering the key.
6. Note filenames are basename-only `.md` names. Never accept arbitrary paths from renderer.
7. Existing note reads/writes reject symbolic links where the platform supports `O_NOFOLLOW`.
8. Renaming must never overwrite another note.
9. Rendered Markdown must pass through DOMPurify; do not insert raw marked output.
10. Do not enable renderer permissions, arbitrary navigation, or unrestricted `window.open`.
11. Local images load only through `easymark-asset://local/<basename>`.
12. Auto-save jobs capture `{ filename, content }`; do not derive filename at timer execution time.
13. Close/quit must complete both save queues before destroying the renderer.

## Note title semantics

The filename without `.md` is the canonical title. Markdown H1 text is user content and must not silently override sidebar/search titles. Rename changes the filename only and returns the collision-safe final title.

## AI provider semantics

The custom endpoint must implement an OpenAI-compatible API, including Chat Completions and (for model refresh) Models. A native Anthropic endpoint is not directly compatible.

## Testing

- `src/services/markdown.test.ts`: XSS, URL and local asset normalization
- `tests/file-utils.test.cjs`: path traversal, title and image validation
- Before release: `npm run check && npm audit`
- For macOS release procedures, see `MACOS.md`.

## Known follow-up work

- Replace remaining `document.execCommand` usage with Selection/Range operations.
- Split highlight.js language registration to reduce the renderer bundle.
- Add Playwright/Electron end-to-end tests for close-save, dual pane and editor mode switching.
- Add crash recovery/versioned backups before introducing cloud sync.
