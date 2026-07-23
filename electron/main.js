const { app, BrowserWindow, ipcMain, dialog, shell, Menu, protocol, session, safeStorage } = require('electron')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const OpenAI = require('openai').default
const { Document, Packer, Paragraph, TextRun, HeadingLevel, Header, Footer, PageNumber, TableCell, TableRow, Table, LevelFormat, AlignmentType } = require('docx')
const {
  resolveNotePath,
  sanitizeExportFilename,
  sanitizeTitle,
  validateImageDataUrl,
} = require('./file-utils')
const {
  createVersion,
  listVersions,
  migrateHistory,
  readVersion,
} = require('./note-history')

protocol.registerSchemesAsPrivileged([{
  scheme: 'easymark-asset',
  privileges: { standard: true, secure: true, supportFetchAPI: true },
}])

let mainWindow = null
let helpWindow = null
let allowWindowClose = false
let closeHandshakePending = false
let closeHandshakeTimer = null
let appQuitRequested = false
let noteMutationQueue = Promise.resolve()
const notesDir = path.join(app.getPath('documents'), 'EasyMark')
const assetsDir = path.join(notesDir, 'assets')
const historyDir = path.join(notesDir, '.history')
const MAX_NOTE_BYTES = 20 * 1024 * 1024
const MAX_NOTE_VERSIONS = 10
const MAX_SEARCH_QUERY_LENGTH = 200
const MAX_EXPORT_HTML_BYTES = 10 * 1024 * 1024

const MAX_AI_MESSAGE_BYTES = 100 * 1024
const MAX_AI_MESSAGES = 50
const AI_CONFIG_FILENAME = 'ai-config.json'
const DEFAULT_AI_URL = 'https://api.openai.com/v1'
const DEFAULT_AI_MODEL = 'gpt-4o-mini'
let aiConfig = { apiUrl: DEFAULT_AI_URL, model: DEFAULT_AI_MODEL, apiKey: '' }

function validateAIUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length > 2048) throw new Error('Invalid AI API URL')
  let parsed
  try { parsed = new URL(rawUrl.trim()) } catch { throw new Error('Invalid AI API URL') }
  const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback)) {
    throw new Error('AI API URL must use HTTPS (HTTP is allowed only for localhost)')
  }
  if (parsed.username || parsed.password) throw new Error('AI API URL must not contain credentials')
  parsed.hash = ''
  parsed.search = ''
  return parsed.toString().replace(/\/$/, '')
}

function validateAIModel(model) {
  if (typeof model !== 'string') throw new Error('Invalid AI model')
  const value = model.trim()
  if (!value || value.length > 200 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Invalid AI model')
  return value
}

function aiConfigPath() {
  return path.join(app.getPath('userData'), AI_CONFIG_FILENAME)
}

async function persistAIConfig() {
  const payload = { apiUrl: aiConfig.apiUrl, model: aiConfig.model }
  if (aiConfig.apiKey && safeStorage.isEncryptionAvailable()) {
    payload.encryptedApiKey = safeStorage.encryptString(aiConfig.apiKey).toString('base64')
  }
  const target = aiConfigPath()
  const temporary = `${target}.tmp`
  await fs.promises.mkdir(path.dirname(target), { recursive: true })
  await fs.promises.writeFile(temporary, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 })
  await fs.promises.rename(temporary, target)
}

async function loadAIConfig() {
  try {
    const raw = JSON.parse(await fs.promises.readFile(aiConfigPath(), 'utf8'))
    const apiUrl = validateAIUrl(raw.apiUrl || DEFAULT_AI_URL)
    const model = validateAIModel(raw.model || DEFAULT_AI_MODEL)
    let apiKey = ''
    if (raw.encryptedApiKey && safeStorage.isEncryptionAvailable()) {
      apiKey = safeStorage.decryptString(Buffer.from(raw.encryptedApiKey, 'base64'))
    }
    aiConfig = { apiUrl, model, apiKey }
  } catch (error) {
    if (error?.code !== 'ENOENT') console.error('Failed to load AI configuration:', error)
  }
}

function publicAIConfig() {
  return {
    configured: Boolean(aiConfig.apiKey),
    apiUrl: aiConfig.apiUrl,
    model: aiConfig.model,
    persistedSecurely: !aiConfig.apiKey || safeStorage.isEncryptionAvailable(),
  }
}

function createAIClient() {
  if (!aiConfig.apiKey) throw new Error('AI is not configured')
  return new OpenAI({ apiKey: aiConfig.apiKey, baseURL: aiConfig.apiUrl })
}

function validateAIMessages(rawMessages) {
  if (!Array.isArray(rawMessages) || !rawMessages.length || rawMessages.length > MAX_AI_MESSAGES) throw new Error('Invalid AI messages')
  let totalBytes = 0
  const messages = rawMessages.map(message => {
    if (!message || !['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string') {
      throw new Error('Invalid AI message')
    }
    totalBytes += Buffer.byteLength(message.content, 'utf8')
    return { role: message.role, content: message.content }
  })
  if (totalBytes > MAX_AI_MESSAGE_BYTES) throw new Error('AI request is too large')
  return messages
}

function redactedAIError(error) {
  const raw = error instanceof Error ? error.message : String(error)
  return aiConfig.apiKey ? raw.split(aiConfig.apiKey).join('[redacted]') : raw
}

async function ensureNotesDir() {
  await fs.promises.mkdir(assetsDir, { recursive: true })
}

// All mutations use one queue so autosave, rename, and delete cannot interleave.
// A global queue is intentionally small here: notes are local files and operations are brief.
async function withNoteMutationLock(task) {
  const previous = noteMutationQueue
  let release
  noteMutationQueue = new Promise(resolve => { release = resolve })
  await previous
  try {
    return await task()
  } finally {
    release()
  }
}

async function writeNoteAtomically(filePath, content) {
  const { handle: sourceHandle } = await openRegularNote(filePath)
  await sourceHandle.close()

  const directory = path.dirname(filePath)
  const temporary = path.join(directory, `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`)
  let temporaryHandle
  try {
    temporaryHandle = await fs.promises.open(temporary, 'wx', 0o600)
    await temporaryHandle.writeFile(content, 'utf8')
    await temporaryHandle.sync()
    await temporaryHandle.close()
    temporaryHandle = null
    // Rename is atomic when both paths are in the same directory. It replaces a
    // concurrently-created symlink rather than following it.
    await fs.promises.rename(temporary, filePath)
  } catch (error) {
    if (temporaryHandle) await temporaryHandle.close().catch(() => {})
    await fs.promises.unlink(temporary).catch(() => {})
    throw error
  }
}

async function openRegularNote(filePath) {
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
  const handle = await fs.promises.open(filePath, flags)
  try {
    const stat = await handle.stat()
    if (!stat.isFile()) throw new Error('Invalid note file')
    if (stat.size > MAX_NOTE_BYTES) throw new Error('Note is too large')
    return { handle, stat }
  } catch (error) {
    await handle.close()
    throw error
  }
}

async function readRegularNote(filePath) {
  const { handle } = await openRegularNote(filePath)
  try {
    return await handle.readFile('utf8')
  } finally {
    await handle.close()
  }
}

function isTrustedSender(event) {
  return Boolean(mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents)
}

function assertTrustedSender(event) {
  if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender')
}

function safeExternalUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl)
    return ['https:', 'http:', 'mailto:'].includes(parsed.protocol) ? parsed.toString() : null
  } catch {
    return null
  }
}

function isSameDocumentNavigation(currentUrl, nextUrl) {
  try {
    const current = new URL(currentUrl)
    const next = new URL(nextUrl)
    current.hash = ''
    next.hash = ''
    return current.toString() === next.toString()
  } catch {
    return false
  }
}

function configureNavigationGuards(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    const external = safeExternalUrl(url)
    if (external) shell.openExternal(external).catch(err => console.error('Failed to open link:', err))
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    const currentUrl = window.webContents.getURL()
    if (url === currentUrl || isSameDocumentNavigation(currentUrl, url)) return
    event.preventDefault()
    const external = safeExternalUrl(url)
    if (external) shell.openExternal(external).catch(err => console.error('Failed to open link:', err))
  })
}

function createApplicationMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    {
      label: 'View',
      submenu: [
        ...(process.env.VITE_DEV_SERVER_URL ? [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' }] : []),
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' }, { role: 'togglefullscreen' },
      ],
    },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }] },
  ]))
}

function createWindow() {
  const isMac = process.platform === 'darwin'
  const windowOptions = {
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: isMac,
    titleBarStyle: isMac ? 'hiddenInset' : undefined,
    trafficLightPosition: isMac ? { x: 14, y: 13 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      backgroundThrottling: false,
    },
    backgroundColor: '#1B1B20',
    show: false,
  }
  if (!isMac) windowOptions.icon = path.join(__dirname, '../build/icon.ico')

  mainWindow = new BrowserWindow(windowOptions)
  configureNavigationGuards(mainWindow)

  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  const distPath = path.join(__dirname, '../dist/index.html')
  const loadPromise = devServerUrl ? mainWindow.loadURL(devServerUrl) : mainWindow.loadFile(distPath)
  loadPromise.catch(err => console.error('Failed to load EasyMark:', err))

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) console.log(`[Renderer] ${message}`)
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('Renderer process crashed:', details.reason)
  })
  mainWindow.on('close', event => {
    if (allowWindowClose || !mainWindow || mainWindow.webContents.isDestroyed()) return
    event.preventDefault()
    if (closeHandshakePending) return
    closeHandshakePending = true
    mainWindow.webContents.send('app-before-close')
    closeHandshakeTimer = setTimeout(() => {
      closeHandshakePending = false
      closeHandshakeTimer = null
      appQuitRequested = false
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show()
        mainWindow.focus()
      }
      console.error('Close was cancelled because the renderer did not finish saving in time.')
    }, 10_000)
  })
  mainWindow.on('closed', () => {
    if (closeHandshakeTimer) clearTimeout(closeHandshakeTimer)
    closeHandshakeTimer = null
    closeHandshakePending = false
    allowWindowClose = false
    mainWindow = null
  })
  mainWindow.on('maximize', () => mainWindow?.webContents.send('window-maximized-changed', true))
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window-maximized-changed', false))
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })
}

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return
  await ensureNotesDir()
  await loadAIConfig()

  protocol.handle('easymark-asset', async request => {
    try {
      const url = new URL(request.url)
      if (url.hostname !== 'local') return new Response('Not found', { status: 404 })
      const filename = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
      if (!filename || path.posix.basename(filename) !== filename || path.win32.basename(filename) !== filename) {
        return new Response('Not found', { status: 404 })
      }
      if (!/\.(?:png|jpe?g|gif|webp)$/i.test(filename)) return new Response('Not found', { status: 404 })
      const assetPath = path.resolve(assetsDir, filename)
      if (path.dirname(assetPath) !== path.resolve(assetsDir)) return new Response('Not found', { status: 404 })
      const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
      const handle = await fs.promises.open(assetPath, flags)
      try {
        const stat = await handle.stat()
        if (!stat.isFile() || stat.size > 10 * 1024 * 1024) return new Response('Not found', { status: 404 })
        const contentTypes = {
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.gif': 'image/gif',
          '.webp': 'image/webp',
        }
        const contentType = contentTypes[path.extname(filename).toLowerCase()]
        if (!contentType) return new Response('Not found', { status: 404 })
        const data = await handle.readFile()
        return new Response(data, {
          status: 200,
          headers: {
            'Content-Type': contentType,
            'Content-Length': String(data.length),
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          },
        })
      } finally {
        await handle.close()
      }
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  createApplicationMenu()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}).catch(error => {
  console.error('Failed to initialize EasyMark:', error)
  app.quit()
})

app.on('before-quit', () => { appQuitRequested = true })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.on('window-minimize', event => { if (isTrustedSender(event)) mainWindow?.minimize() })
ipcMain.on('window-maximize', event => {
  if (!isTrustedSender(event)) return
  if (mainWindow?.isMaximized()) mainWindow.unmaximize()
  else mainWindow?.maximize()
})
ipcMain.on('window-close', event => { if (isTrustedSender(event)) mainWindow?.close() })
ipcMain.on('app-close-confirmed', event => {
  if (!isTrustedSender(event) || !closeHandshakePending) return
  if (closeHandshakeTimer) clearTimeout(closeHandshakeTimer)
  closeHandshakeTimer = null
  closeHandshakePending = false
  allowWindowClose = true
  if (appQuitRequested) app.quit()
  else mainWindow?.close()
})
ipcMain.on('app-close-cancelled', event => {
  if (!isTrustedSender(event) || !closeHandshakePending) return
  if (closeHandshakeTimer) clearTimeout(closeHandshakeTimer)
  closeHandshakeTimer = null
  closeHandshakePending = false
  appQuitRequested = false
  mainWindow?.show()
  mainWindow?.focus()
})

ipcMain.handle('notes:list', async event => {
  assertTrustedSender(event)
  try {
    await ensureNotesDir()
    const entries = await fs.promises.readdir(notesDir, { withFileTypes: true })
    const notes = await Promise.all(entries
      .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
      .map(async entry => {
        try {
          const filePath = resolveNotePath(notesDir, entry.name)
          const { handle, stat } = await openRegularNote(filePath)
          await handle.close()
          const title = entry.name.slice(0, -3)
          return { id: title, title, filename: entry.name, lastModified: stat.mtimeMs }
        } catch {
          return null
        }
      }))
    return notes.filter(Boolean).sort((a, b) => b.lastModified - a.lastModified)
  } catch (err) {
    console.error('Failed to list notes:', err)
    return []
  }
})

ipcMain.handle('notes:read', async (event, filename) => {
  assertTrustedSender(event)
  const filePath = resolveNotePath(notesDir, filename)
  try {
    return await readRegularNote(filePath)
  } catch (err) {
    if (err?.code === 'ENOENT') return null
    throw err
  }
})

ipcMain.handle('notes:save', async (event, filename, content) => {
  assertTrustedSender(event)
  if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > MAX_NOTE_BYTES) throw new Error('Invalid note content')
  await ensureNotesDir()
  const filePath = resolveNotePath(notesDir, filename)
  await withNoteMutationLock(async () => {
    const previousContent = await readRegularNote(filePath)
    if (previousContent === content) return
    await createVersion(historyDir, filename, previousContent, MAX_NOTE_BYTES, MAX_NOTE_VERSIONS)
    await writeNoteAtomically(filePath, content)
  })
  return true
})

ipcMain.handle('notes:listVersions', async (event, filename) => {
  assertTrustedSender(event)
  resolveNotePath(notesDir, filename)
  return withNoteMutationLock(() => listVersions(historyDir, filename, MAX_NOTE_BYTES))
})

ipcMain.handle('notes:readVersion', async (event, filename, versionId) => {
  assertTrustedSender(event)
  resolveNotePath(notesDir, filename)
  return withNoteMutationLock(() => readVersion(historyDir, filename, versionId, MAX_NOTE_BYTES))
})

ipcMain.handle('notes:restoreVersion', async (event, filename, versionId) => {
  assertTrustedSender(event)
  await ensureNotesDir()
  const filePath = resolveNotePath(notesDir, filename)
  return withNoteMutationLock(async () => {
    const restoredContent = await readVersion(historyDir, filename, versionId, MAX_NOTE_BYTES)
    const currentContent = await readRegularNote(filePath)
    if (restoredContent === currentContent) return restoredContent
    await createVersion(historyDir, filename, currentContent, MAX_NOTE_BYTES, MAX_NOTE_VERSIONS)
    await writeNoteAtomically(filePath, restoredContent)
    return restoredContent
  })
})

ipcMain.handle('notes:create', async (event, title) => {
  assertTrustedSender(event)
  await ensureNotesDir()
  const safeTitle = sanitizeTitle(title)
  return withNoteMutationLock(async () => {
    let filename = `${safeTitle}.md`
    let counter = 1
    while (true) {
      const filePath = resolveNotePath(notesDir, filename)
      try {
        const handle = await fs.promises.open(filePath, 'wx', 0o600)
        await handle.close()
        return { filename, title: safeTitle, content: '' }
      } catch (err) {
        if (err?.code !== 'EEXIST') throw err
        filename = `${safeTitle}-${counter}.md`
        counter += 1
      }
    }
  })
})

ipcMain.handle('notes:delete', async (event, filename) => {
  assertTrustedSender(event)
  const filePath = resolveNotePath(notesDir, filename)
  return withNoteMutationLock(async () => {
    try {
      const stat = await fs.promises.lstat(filePath)
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Invalid note file')
      await fs.promises.unlink(filePath)
      return true
    } catch (err) {
      if (err?.code === 'ENOENT') return false
      throw err
    }
  })
})

ipcMain.handle('notes:rename', async (event, oldFilename, newTitle) => {
  assertTrustedSender(event)
  const oldPath = resolveNotePath(notesDir, oldFilename)
  const safeTitle = sanitizeTitle(newTitle)
  if (`${safeTitle}.md` === oldFilename) return { filename: oldFilename, title: safeTitle }

  return withNoteMutationLock(async () => {
    const { handle: sourceHandle } = await openRegularNote(oldPath)
    try {
      const content = await sourceHandle.readFile()
      let counter = 0
      while (true) {
      const suffix = counter ? `-${counter}` : ''
      const newFilename = `${safeTitle}${suffix}.md`
      const newPath = resolveNotePath(notesDir, newFilename)
      let targetHandle
      try {
        targetHandle = await fs.promises.open(newPath, 'wx', 0o600)
        await targetHandle.writeFile(content)
        await targetHandle.sync()
        await targetHandle.close()
        targetHandle = null
        try {
          await fs.promises.unlink(oldPath)
        } catch (error) {
          await fs.promises.unlink(newPath).catch(() => {})
          throw error
        }
        await migrateHistory(historyDir, oldFilename, newFilename, MAX_NOTE_BYTES, MAX_NOTE_VERSIONS)
          .catch(error => console.error('Failed to migrate note history:', error))
        return { filename: newFilename, title: newFilename.slice(0, -3) }
      } catch (error) {
        if (targetHandle) await targetHandle.close().catch(() => {})
        if (error?.code === 'EEXIST') {
          counter += 1
          continue
        }
        await fs.promises.unlink(newPath).catch(() => {})
        throw error
      }
      }
    } finally {
      await sourceHandle.close()
    }
  })
})

ipcMain.handle('help:open', async event => {
  assertTrustedSender(event)
  const helpPath = path.join(__dirname, '../dist/help.html')
  if (!fs.existsSync(helpPath)) throw new Error('Help file not found')
  if (helpWindow && !helpWindow.isDestroyed()) {
    helpWindow.show()
    helpWindow.focus()
    return
  }
  helpWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 640,
    minHeight: 480,
    title: 'EasyMark Help',
    parent: process.platform === 'darwin' ? undefined : mainWindow,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, javascript: false },
  })
  configureNavigationGuards(helpWindow)
  helpWindow.on('closed', () => { helpWindow = null })
  await helpWindow.loadFile(helpPath)
})

ipcMain.handle('file:saveImage', async (event, dataUrl) => {
  assertTrustedSender(event)
  await ensureNotesDir()
  const { extension, buffer } = validateImageDataUrl(dataUrl)
  const filename = `image-${Date.now()}-${Math.random().toString(16).slice(2, 10)}.${extension}`
  await fs.promises.writeFile(path.join(assetsDir, filename), buffer, { flag: 'wx' })
  return { filename: `assets/${filename}` }
})

ipcMain.handle('notes:searchAll', async (event, rawQuery) => {
  assertTrustedSender(event)
  const query = typeof rawQuery === 'string' ? rawQuery.trim().slice(0, MAX_SEARCH_QUERY_LENGTH) : ''
  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  await ensureNotesDir()
  const entries = await fs.promises.readdir(notesDir, { withFileTypes: true })
  const files = entries.filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
  const results = []
  for (const entry of files) {
    try {
      const filePath = resolveNotePath(notesDir, entry.name)
      const content = await readRegularNote(filePath)
      const lower = content.toLocaleLowerCase()
      let score = 0
      for (const term of terms) {
        let from = 0
        while ((from = lower.indexOf(term, from)) !== -1) { score += 1; from += Math.max(term.length, 1) }
      }
      if (!score) continue
      const title = entry.name.slice(0, -3)
      const firstMatch = Math.min(...terms.map(term => lower.indexOf(term)).filter(index => index >= 0))
      const start = Math.max(0, firstMatch - 40)
      const snippet = content.slice(start, start + 160).replace(/\s+/g, ' ').trim()
      results.push({ filename: entry.name, title, snippet, score })
    } catch {
      // Ignore files that disappear or become unreadable while searching.
    }
  }
  return results.sort((a, b) => b.score - a.score).slice(0, 20)
})


ipcMain.handle('ai:getConfig', event => {
  assertTrustedSender(event)
  return publicAIConfig()
})

ipcMain.handle('ai:configure', async (event, rawConfig) => {
  assertTrustedSender(event)
  if (!rawConfig || typeof rawConfig !== 'object') throw new Error('Invalid AI configuration')
  const nextUrl = validateAIUrl(rawConfig.apiUrl || aiConfig.apiUrl)
  const nextModel = validateAIModel(rawConfig.model || aiConfig.model)
  const suppliedKey = typeof rawConfig.apiKey === 'string' ? rawConfig.apiKey.trim() : ''
  if (suppliedKey.length > 4096) throw new Error('Invalid API key')
  if (!suppliedKey && aiConfig.apiKey && new URL(nextUrl).origin !== new URL(aiConfig.apiUrl).origin) {
    throw new Error('Enter the API key again when changing providers')
  }
  aiConfig = { apiUrl: nextUrl, model: nextModel, apiKey: suppliedKey || aiConfig.apiKey }
  await persistAIConfig()
  return { ...publicAIConfig(), persistedSecurely: !aiConfig.apiKey || safeStorage.isEncryptionAvailable() }
})

ipcMain.handle('ai:clearKey', async event => {
  assertTrustedSender(event)
  aiConfig = { ...aiConfig, apiKey: '' }
  await persistAIConfig()
  return publicAIConfig()
})

ipcMain.handle('ai:listModels', async event => {
  assertTrustedSender(event)
  try {
    const response = await createAIClient().models.list()
    return response.data.map(model => model.id).filter(id => typeof id === 'string').slice(0, 1000)
  } catch (error) {
    throw new Error(redactedAIError(error))
  }
})

ipcMain.handle('ai:chat', async (event, rawMessages, rawOptions) => {
  assertTrustedSender(event)
  const messages = validateAIMessages(rawMessages)
  const maxTokens = Number.isInteger(rawOptions?.maxTokens) ? Math.min(Math.max(rawOptions.maxTokens, 1), 4096) : 200
  const temperature = typeof rawOptions?.temperature === 'number' ? Math.min(Math.max(rawOptions.temperature, 0), 2) : 0.7
  try {
    const response = await createAIClient().chat.completions.create({
      model: aiConfig.model,
      messages,
      max_tokens: maxTokens,
      temperature,
    })
    return response.choices[0]?.message?.content?.trim() || ''
  } catch (error) {
    throw new Error(redactedAIError(error))
  }
})

ipcMain.handle('export:pdf', async (event, html, title) => {
  assertTrustedSender(event)
  if (typeof html !== 'string' || Buffer.byteLength(html, 'utf8') > MAX_EXPORT_HTML_BYTES) throw new Error('Invalid export content')
  const safeTitle = sanitizeExportFilename(title)
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(app.getPath('documents'), `${safeTitle}.pdf`),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  })
  if (canceled || !filePath) return null

  const pdfWindow = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, javascript: false },
  })

  return new Promise(resolve => {
    let settled = false
    const finish = result => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      if (!pdfWindow.isDestroyed()) pdfWindow.destroy()
      resolve(result)
    }
    const timeoutId = setTimeout(() => { console.error('PDF export timed out'); finish(null) }, 30000)
    pdfWindow.webContents.once('did-fail-load', (_event, code, description) => {
      console.error('PDF window failed to load:', code, description)
      finish(null)
    })
    pdfWindow.webContents.once('did-finish-load', async () => {
      try {
        const pdf = await pdfWindow.webContents.printToPDF({ printBackground: true, margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 } })
        await fs.promises.writeFile(filePath, pdf)
        finish(filePath)
      } catch (err) {
        console.error('PDF export error:', err)
        finish(null)
      }
    })
    pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(err => {
      console.error('Failed to load PDF content:', err)
      finish(null)
    })
  })
})

// IPC: Export DOCX
function parseInlineContent(text) {
  const runs = []
  const inlineRegex = /(`[^`]+`)|(\[([^\]]+)\]\(([^)]+)\))|(!\[([^\]]*)\]\(([^)]+)\))|(\*\*(.+?)\*\*)|(\*(.+?)\*)|(~~(.+?)~~)/g
  let lastIndex = 0
  let match

  while ((match = inlineRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      runs.push(new TextRun({ text: text.slice(lastIndex, match.index) }))
    }

    if (match[1]) {
      runs.push(new TextRun({ text: match[1].slice(1, -1), font: 'Courier New', size: 18, color: 'E91E63' }))
    } else if (match[2]) {
      runs.push(new TextRun({ text: match[3], style: 'Hyperlink', color: '1976D2', underline: { type: 'single' } }))
    } else if (match[6]) {
      runs.push(new TextRun({ text: `[${match[6] || 'image'}]`, italics: true, color: '999999' }))
    } else if (match[8]) {
      runs.push(new TextRun({ text: match[9], bold: true }))
    } else if (match[10]) {
      runs.push(new TextRun({ text: match[11], italics: true }))
    } else if (match[12]) {
      runs.push(new TextRun({ text: match[13], strike: true }))
    }

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    runs.push(new TextRun({ text: text.slice(lastIndex) }))
  }

  return runs.length ? runs : [new TextRun({ text: text })]
}

function parseMarkdownToDocx(markdown) {
  const lines = markdown.split('\n')
  const children = []
  let inCodeFence = false
  let codeLines = []
  let codeLang = ''
  let inTable = false
  let tableRows = []

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]
    const trimmed = line.trim()

    if (trimmed.startsWith('```')) {
      if (inCodeFence) {
        codeLines.push('')
        children.push(new Paragraph({
          spacing: { before: 0, after: 120 },
          indent: { left: 200 },
          shading: { type: 'clear', fill: 'F5F5F5' },
          children: [new TextRun({
            text: codeLines.map(l => l.replace(/\t/g, '  ')).join('\n'),
            font: 'Courier New',
            size: 16,
            color: '333333',
          })],
        }))
        codeLines = []
        inCodeFence = false
      } else {
        codeLang = trimmed.slice(3).trim()
        inCodeFence = true
        codeLines = []
        if (codeLang) {
          children.push(new Paragraph({
            spacing: { before: 120, after: 0 },
            indent: { left: 200 },
            children: [new TextRun({ text: codeLang, font: 'Courier New', size: 14, color: '999999', italics: true })],
          }))
        }
      }
      continue
    }

    if (inCodeFence) {
      codeLines.push(line)
      continue
    }

    if (!trimmed) {
      if (inTable && tableRows.length > 0) {
        children.push(renderTable(tableRows))
        tableRows = []
        inTable = false
      }
      children.push(new Paragraph({ spacing: { after: 200 } }))
      continue
    }

    const isSeparator = /^\|[-:]+\|/.test(trimmed) || /^\|?\s*[-:]+\s*\|/.test(trimmed)
    if (isSeparator) continue

    if (trimmed.startsWith('|')) {
      inTable = true
      tableRows.push(trimmed)
      continue
    }

    if (inTable && tableRows.length > 0) {
      children.push(renderTable(tableRows))
      tableRows = []
      inTable = false
    }

    if (trimmed.startsWith('# ')) {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 },
        children: parseInlineContent(trimmed.slice(2)),
      }))
    } else if (trimmed.startsWith('## ')) {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 300, after: 150 },
        children: parseInlineContent(trimmed.slice(3)),
      }))
    } else if (trimmed.startsWith('### ')) {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_3,
        spacing: { before: 200, after: 100 },
        children: parseInlineContent(trimmed.slice(4)),
      }))
    } else if (trimmed.startsWith('- [ ] ') || trimmed.startsWith('- [x] ') || trimmed.startsWith('- [X] ') || trimmed.startsWith('* [ ] ') || trimmed.startsWith('* [x] ') || trimmed.startsWith('* [X] ')) {
      const checked = /^[-*]\s\[[xX]\]/.test(trimmed)
      const content = trimmed.replace(/^[-*]\s\[[ xX]\]\s/, '')
      children.push(new Paragraph({
        bullet: { level: 0 },
        spacing: { after: 60 },
        children: [
          new TextRun({
            text: checked ? '☑ ' : '☐ ',
            size: 18,
          }),
          ...parseInlineContent(content),
        ],
      }))
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      children.push(new Paragraph({
        bullet: { level: 0 },
        spacing: { after: 60 },
        children: parseInlineContent(trimmed.slice(2)),
      }))
    } else if (/^\d+\.\s/.test(trimmed)) {
      children.push(new Paragraph({
        numbering: { reference: 'easymark-numbering', level: 0 },
        spacing: { after: 60 },
        children: parseInlineContent(trimmed.replace(/^\d+\.\s/, '')),
      }))
    } else if (trimmed.startsWith('> ')) {
      children.push(new Paragraph({
        spacing: { after: 100 },
        indent: { left: 400 },
        children: parseInlineContent(trimmed.slice(2)).map(r => new TextRun({ ...r, italics: true, color: '666666' })),
      }))
    } else if (trimmed.startsWith('---') || trimmed.startsWith('***') || trimmed.startsWith('___')) {
      children.push(new Paragraph({
        spacing: { before: 200, after: 200 },
        border: { bottom: { style: 'single', size: 6, color: 'CCCCCC' } },
        children: [],
      }))
    } else {
      children.push(new Paragraph({
        spacing: { after: 100 },
        children: parseInlineContent(trimmed),
      }))
    }
  }

  if (inCodeFence && codeLines.length > 0) {
    children.push(new Paragraph({
      spacing: { before: 0, after: 120 },
      indent: { left: 200 },
      shading: { type: 'clear', fill: 'F5F5F5' },
      children: [new TextRun({
        text: codeLines.map(l => l.replace(/\t/g, '  ')).join('\n'),
        font: 'Courier New',
        size: 16,
        color: '333333',
      })],
    }))
  }

  if (inTable && tableRows.length > 0) {
    children.push(renderTable(tableRows))
  }

  return children
}

function renderTable(rows) {
  const cells = rows.map(row => {
    const parts = row.split('|').filter((_, idx, arr) => idx > 0 && idx < arr.length - 1)
    return parts.map(p => p.trim())
  })

  const colCount = cells.reduce((max, r) => Math.max(max, r.length), 0)
  const tableRows = cells.map(cellValues => {
    return new TableRow({
      children: Array.from({ length: colCount }, (_, ci) =>
        new TableCell({
          children: [new Paragraph({
            children: parseInlineContent(cellValues[ci] || ''),
            spacing: { before: 40, after: 40 },
          })],
          margins: { top: 40, bottom: 40, left: 80, right: 80 },
          borders: {
            top: { style: 'single', size: 1, color: 'CCCCCC' },
            bottom: { style: 'single', size: 1, color: 'CCCCCC' },
            left: { style: 'single', size: 1, color: 'CCCCCC' },
            right: { style: 'single', size: 1, color: 'CCCCCC' },
          },
        })
      ),
    })
  })

  return new Table({
    rows: tableRows,
    width: { size: 100, type: 'pct' },
  })
}

ipcMain.handle('export:docx', async (event, markdown, title) => {
  assertTrustedSender(event)
  if (typeof markdown !== 'string' || Buffer.byteLength(markdown, 'utf8') > MAX_NOTE_BYTES) throw new Error('Invalid export content')
  const safeTitle = sanitizeExportFilename(title)
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(app.getPath('documents'), `${safeTitle}.docx`),
    filters: [{ name: 'Word Document', extensions: ['docx'] }],
  })
  if (canceled || !filePath) return null

  try {
    const doc = new Document({
      title: safeTitle,
      description: 'Exported from EasyMark',
      styles: {
        default: {
          document: {
            run: { font: 'Microsoft YaHei', size: 22 },
          },
        },
      },
      numbering: {
        config: [{
          reference: 'easymark-numbering',
          levels: [{
            level: 0,
            format: LevelFormat.DECIMAL,
            text: '%1.',
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } },
          }],
        }],
      },
      sections: [{
        properties: {},
        headers: {
          default: new Header({
            children: [new Paragraph({
              alignment: 'right',
              children: [new TextRun({ text: safeTitle, size: 16, color: '999999' })],
            })],
          }),
        },
        footers: {
          default: new Footer({
            children: [new Paragraph({
              alignment: 'center',
              children: [new TextRun({ text: 'Page ', size: 16, color: '999999' }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '999999' })],
            })],
          }),
        },
        children: parseMarkdownToDocx(markdown),
      }],
    })

    const buffer = await Packer.toBuffer(doc)
    await fs.promises.writeFile(filePath, buffer)
    return filePath
  } catch (err) {
    console.error('DOCX export error:', err)
    return null
  }
})
