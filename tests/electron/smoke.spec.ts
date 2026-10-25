import { promises as fs } from 'node:fs'
import os from 'node:os'
import * as path from 'node:path'
import { expect, _electron, test, type ElectronApplication, type Page } from '@playwright/test'

// These tests run the real Electron app against real disk paths redirected to
// temp directories (EASYMARK_* env overrides in electron/main.js), covering
// the close-save handshake, note switching and the link dialog end to end.

const isMac = process.platform === 'darwin'
const modifier = isMac ? 'Meta' : 'Control'

let docsDir: string
let userDataDir: string
let electronApp: ElectronApplication
let window: Page

async function launchApp() {
  docsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'easymark-e2e-docs-'))
  userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'easymark-e2e-profile-'))
  electronApp = await _electron.launch({
    args: ['.', '--disable-gpu'],
    env: {
      ...process.env,
      EASYMARK_E2E: '1',
      EASYMARK_DOCUMENTS_DIR: docsDir,
      EASYMARK_USER_DATA_DIR: userDataDir,
    },
  })
  window = await electronApp.firstWindow()
  await window.waitForSelector('.sidebar')
}

test.beforeEach(async () => {
  await launchApp()
})

test.afterEach(async () => {
  await electronApp.close()
  await fs.rm(docsDir, { recursive: true, force: true })
  await fs.rm(userDataDir, { recursive: true, force: true })
})

async function createNote(title: string) {
  await window.keyboard.press(`${modifier}+n`)
  await window.waitForSelector('.sidebar-create-input')
  await window.keyboard.type(title)
  await window.keyboard.press('Enter')
  await window.waitForSelector('.sidebar-create-input', { state: 'detached' })
}

async function typeInEditor(text: string) {
  await window.waitForSelector('.editor-wysiwyg')
  await window.click('.editor-wysiwyg')
  await window.keyboard.type(text)
}

function notePath(title: string): string {
  return path.join(docsDir, 'EasyMark Notes', `${title}.md`)
}

async function expectFileContains(title: string, substring: string) {
  await expect.poll(async () => {
    try {
      return await fs.readFile(notePath(title), 'utf8')
    } catch {
      return ''
    }
  }, { timeout: 10_000 }).toContain(substring)
}

test('flushes a pending save when the window closes', async () => {
  await createNote('Close Flush')
  await typeInEditor('Typed right before close')

  // Close immediately, while the debounced auto-save is still pending; the
  // close handshake must flush the save queue before the app quits.
  await electronApp.close()

  const saved = await fs.readFile(notePath('Close Flush'), 'utf8')
  expect(saved).toContain('Typed right before close')
})

test('persists note content before switching to a new note', async () => {
  await createNote('First Note')
  await typeInEditor('First note body')

  // Creating the next note switches the primary editor while the previous
  // note still has unsaved content.
  await createNote('Second Note')
  await typeInEditor('Second note body')
  await window.keyboard.press(`${modifier}+s`)

  await expectFileContains('First Note', 'First note body')
  await expectFileContains('Second Note', 'Second note body')
})

test('inserts a link through the in-app dialog and saves the Markdown', async () => {
  await createNote('Link Note')
  await typeInEditor('Link target text')

  await window.keyboard.press(`${modifier}+a`)
  await window.keyboard.press(`${modifier}+k`)
  await window.waitForSelector('.link-dialog')
  await window.fill('#link-dialog-url', 'https://example.com')
  await window.click('.link-dialog-confirm')
  await window.waitForSelector('.link-dialog', { state: 'detached' })

  await window.keyboard.press(`${modifier}+s`)
  await expectFileContains('Link Note', '[Link target text](https://example.com/)')
})

test('Escape closes only the top-most stacked surface', async () => {
  await createNote('Escape Note')

  // AI panel first, then the settings dialog stacked on top of it.
  await window.click('button[title="Enable AI"], button[title="开启 AI"]')
  await window.waitForSelector('.ai-panel')
  await window.click('button[title="Settings"], button[title="设置"]')
  await window.waitForSelector('.settings-dialog')

  await window.keyboard.press('Escape')
  await expect(window.locator('.settings-dialog')).toHaveCount(0)
  await expect(window.locator('.ai-panel')).toBeVisible()

  await window.keyboard.press('Escape')
  await expect(window.locator('.ai-panel')).toHaveCount(0)
})

async function openComparison() {
  await window.click('.editor-toolbar-end button[title="与其他笔记对比"], .editor-toolbar-end button[title="Compare with another note"]')
  await window.waitForSelector('.dual-pane')
}

test('tab and shift+tab never rewrite a plain paragraph', async () => {
  await createNote('Indent Note')
  await typeInEditor('body text')
  await window.keyboard.press(`${modifier}+s`)
  await expectFileContains('Indent Note', 'body text')

  // Indenting a paragraph cannot round-trip through Markdown: four spaces turn
  // it into an indented code block and Turndown escapes leading spaces to
  // U+00A0. Both directions must therefore leave the note untouched.
  await window.keyboard.press('End')
  await window.keyboard.press('Home')
  await window.keyboard.press('Tab')
  await window.keyboard.press('Shift+Tab')
  await window.keyboard.press(`${modifier}+s`)
  await new Promise(resolve => setTimeout(resolve, 800))
  expect(await fs.readFile(notePath('Indent Note'), 'utf8')).toBe('body text')
})

test('swapping comparison panes preserves notes that contain a code block', async () => {
  await createNote('Swap Block')
  await typeInEditor('intro paragraph')
  await window.click('button[title^="代码块"], button[title^="Code block"]')
  await window.keyboard.type('const value = 1')
  await window.keyboard.press(`${modifier}+s`)
  await expectFileContains('Swap Block', 'const value = 1')

  await createNote('Swap Plain')
  await typeInEditor('plain body')
  await window.keyboard.press(`${modifier}+s`)
  await expectFileContains('Swap Plain', 'plain body')

  const blockBefore = await fs.readFile(notePath('Swap Block'), 'utf8')
  const plainBefore = await fs.readFile(notePath('Swap Plain'), 'utf8')

  await openComparison()
  await window.click('button[title="交换两侧笔记"], button[title="Swap panes"]')
  await window.keyboard.press('Shift+Tab')
  await window.keyboard.press(`${modifier}+s`)
  await new Promise(resolve => setTimeout(resolve, 1000))

  expect(await fs.readFile(notePath('Swap Block'), 'utf8')).toBe(blockBefore)
  expect(await fs.readFile(notePath('Swap Plain'), 'utf8')).toBe(plainBefore)
})
