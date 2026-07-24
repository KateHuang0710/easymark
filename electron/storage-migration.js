const fs = require('fs')
const path = require('path')

const { writeFileAtomically } = require('./atomic-file')
const { resolveNotePath } = require('./file-utils')
const { historyKey, validateVersionId } = require('./note-history')
const { ensureRegularDirectory } = require('./safe-directory')

const MIGRATION_MARKER = '.easymark-storage-v2.json'
const SUPPORTED_ASSET = /\.(?:png|jpe?g|gif|webp)$/i

async function readRegularFile(filePath, maxBytes) {
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
  const handle = await fs.promises.open(filePath, flags)
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > maxBytes) throw new Error('Invalid migration file')
    return { data: await handle.readFile(), stat }
  } finally {
    await handle.close()
  }
}

async function pathState(filePath) {
  try {
    return await fs.promises.lstat(filePath)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

async function writeExclusive(filePath, data, mode = 0o600) {
  let handle
  let created = false
  try {
    handle = await fs.promises.open(filePath, 'wx', mode)
    created = true
    await handle.writeFile(data)
    await handle.sync()
    await handle.close()
    handle = null
  } catch (error) {
    if (handle) await handle.close().catch(() => {})
    if (created) await fs.promises.unlink(filePath).catch(() => {})
    throw error
  }
}

async function chooseDestinationFilename(destinationRoot, sourceFilename, data, maxBytes) {
  const extension = path.extname(sourceFilename)
  const basename = path.basename(sourceFilename, extension)
  let counter = 0
  while (true) {
    const suffix = counter === 0 ? '' : counter === 1 ? '-imported' : `-imported-${counter - 1}`
    const filename = `${basename}${suffix}${extension}`
    const destination = resolveNotePath(destinationRoot, filename)
    const state = await pathState(destination)
    if (!state) {
      try {
        await writeExclusive(destination, data)
        return { filename, copied: true }
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error
        continue
      }
    }
    if (!state.isFile() || state.isSymbolicLink() || state.size > maxBytes) {
      counter += 1
      continue
    }
    const existing = await readRegularFile(destination, maxBytes)
    if (existing.data.equals(data)) return { filename, copied: false }
    counter += 1
  }
}

async function hasHistory(historyRoot, filename) {
  const rootState = await pathState(historyRoot)
  if (!rootState) return false
  if (!rootState.isDirectory() || rootState.isSymbolicLink()) throw new Error('Invalid legacy history directory')
  const state = await pathState(path.join(historyRoot, historyKey(filename)))
  return Boolean(state?.isDirectory() && !state.isSymbolicLink())
}

async function copyHistory(sourceRoot, destinationRoot, sourceFilename, destinationFilename, maxBytes) {
  const source = path.join(sourceRoot, historyKey(sourceFilename))
  const sourceState = await pathState(source)
  if (!sourceState) return 0
  if (!sourceState.isDirectory() || sourceState.isSymbolicLink()) throw new Error('Invalid legacy history directory')

  await ensureRegularDirectory(destinationRoot, 'history directory')
  const destination = path.join(destinationRoot, historyKey(destinationFilename))
  await ensureRegularDirectory(destination, 'note history directory')
  const entries = await fs.promises.readdir(source, { withFileTypes: true })
  let copied = 0
  for (const entry of entries) {
    if (!entry.isFile()) continue
    try {
      validateVersionId(entry.name)
    } catch {
      continue
    }
    const { data } = await readRegularFile(path.join(source, entry.name), maxBytes)
    const target = path.join(destination, entry.name)
    try {
      await writeExclusive(target, data)
      copied += 1
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
    }
  }
  return copied
}

async function copyAssets(sourceRoot, destinationRoot, maxAssetBytes) {
  const source = path.join(sourceRoot, 'assets')
  const sourceState = await pathState(source)
  if (!sourceState) return 0
  if (!sourceState.isDirectory() || sourceState.isSymbolicLink()) throw new Error('Invalid legacy assets directory')
  await ensureRegularDirectory(destinationRoot, 'assets directory')

  const entries = await fs.promises.readdir(source, { withFileTypes: true })
  let copied = 0
  for (const entry of entries) {
    if (!entry.isFile() || !SUPPORTED_ASSET.test(entry.name) || path.basename(entry.name) !== entry.name) continue
    const { data } = await readRegularFile(path.join(source, entry.name), maxAssetBytes)
    const target = path.join(destinationRoot, entry.name)
    const targetState = await pathState(target)
    if (targetState) continue
    try {
      await writeExclusive(target, data)
      copied += 1
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
    }
  }
  return copied
}

function isDedicatedLegacyEntry(entry) {
  if (entry.name === '.DS_Store' || entry.name === '.history' || entry.name === 'assets') return true
  return entry.isFile() && entry.name.toLowerCase().endsWith('.md')
}

function wasCreatedByEasyMark(stat) {
  return process.platform !== 'win32' && (stat.mode & 0o777) === 0o600
}

async function migrateLegacyStorage({
  legacyRoot,
  destinationRoot,
  maxNoteBytes,
  maxAssetBytes = 10 * 1024 * 1024,
}) {
  if (path.resolve(legacyRoot) === path.resolve(destinationRoot)) throw new Error('Storage migration paths must differ')
  await ensureRegularDirectory(destinationRoot, 'notes directory')
  await ensureRegularDirectory(path.join(destinationRoot, 'assets'), 'assets directory')

  const markerPath = path.join(destinationRoot, MIGRATION_MARKER)
  const markerState = await pathState(markerPath)
  if (markerState) {
    if (!markerState.isFile() || markerState.isSymbolicLink()) throw new Error('Invalid storage migration marker')
    const marker = JSON.parse((await readRegularFile(markerPath, 1024 * 1024)).data.toString('utf8'))
    return { ...marker, alreadyCompleted: true }
  }

  const legacyState = await pathState(legacyRoot)
  const report = {
    version: 2,
    completedAt: new Date().toISOString(),
    legacyRoot,
    destinationRoot,
    migratedNotes: [],
    skippedMarkdown: [],
    copiedAssets: 0,
    copiedVersions: 0,
    contaminatedLegacyDirectory: false,
  }

  if (legacyState) {
    if (!legacyState.isDirectory() || legacyState.isSymbolicLink()) throw new Error('Invalid legacy notes directory')
    const entries = await fs.promises.readdir(legacyRoot, { withFileTypes: true })
    report.contaminatedLegacyDirectory = entries.some(entry => !isDedicatedLegacyEntry(entry))
    const legacyHistoryRoot = path.join(legacyRoot, '.history')

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue
      const source = resolveNotePath(legacyRoot, entry.name)
      const { data, stat } = await readRegularFile(source, maxNoteBytes)
      const verified = !report.contaminatedLegacyDirectory
        || wasCreatedByEasyMark(stat)
        || await hasHistory(legacyHistoryRoot, entry.name)
      if (!verified) {
        report.skippedMarkdown.push(entry.name)
        continue
      }
      const destination = await chooseDestinationFilename(destinationRoot, entry.name, data, maxNoteBytes)
      report.migratedNotes.push(destination.filename)
      report.copiedVersions += await copyHistory(
        legacyHistoryRoot,
        path.join(destinationRoot, '.history'),
        entry.name,
        destination.filename,
        maxNoteBytes,
      )
    }
    if (report.migratedNotes.length) {
      report.copiedAssets = await copyAssets(legacyRoot, path.join(destinationRoot, 'assets'), maxAssetBytes)
    }
  }

  await writeFileAtomically(markerPath, JSON.stringify(report, null, 2), { encoding: 'utf8', mode: 0o600 })
  return { ...report, alreadyCompleted: false }
}

module.exports = {
  MIGRATION_MARKER,
  migrateLegacyStorage,
}
