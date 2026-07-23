const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const VERSION_ID_PATTERN = /^(\d{13})-([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.md$/i
const DEFAULT_MAX_VERSIONS = 10

function historyKey(filename) {
  if (typeof filename !== 'string' || !filename) throw new Error('Invalid note filename')
  return crypto.createHash('sha256').update(filename, 'utf8').digest('hex')
}

function validateVersionId(versionId) {
  if (typeof versionId !== 'string' || path.basename(versionId) !== versionId || !VERSION_ID_PATTERN.test(versionId)) {
    throw new Error('Invalid note version')
  }
  return versionId
}

async function ensureRegularDirectory(directory) {
  await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 })
  const stat = await fs.promises.lstat(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid history directory')
}

async function noteHistoryDirectory(historyRoot, filename, create = false) {
  if (create) {
    await ensureRegularDirectory(historyRoot)
  } else {
    const rootStat = await fs.promises.lstat(historyRoot)
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Invalid history directory')
  }
  const directory = path.join(historyRoot, historyKey(filename))
  if (create) {
    await ensureRegularDirectory(directory)
  } else {
    const stat = await fs.promises.lstat(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid history directory')
  }
  return directory
}

async function openRegularVersion(filePath, maxBytes) {
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
  const handle = await fs.promises.open(filePath, flags)
  try {
    const stat = await handle.stat()
    if (!stat.isFile()) throw new Error('Invalid note version')
    if (stat.size > maxBytes) throw new Error('Note version is too large')
    return { handle, stat }
  } catch (error) {
    await handle.close()
    throw error
  }
}

async function listVersions(historyRoot, filename, maxBytes) {
  let directory
  try {
    directory = await noteHistoryDirectory(historyRoot, filename, false)
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }

  const entries = await fs.promises.readdir(directory, { withFileTypes: true })
  const versions = await Promise.all(entries.map(async entry => {
    if (!entry.isFile() || !VERSION_ID_PATTERN.test(entry.name)) return null
    try {
      const { handle, stat } = await openRegularVersion(path.join(directory, entry.name), maxBytes)
      await handle.close()
      const match = VERSION_ID_PATTERN.exec(entry.name)
      return {
        id: entry.name,
        filename,
        createdAt: match ? Number(match[1]) : stat.mtimeMs,
        size: stat.size,
      }
    } catch {
      return null
    }
  }))

  return versions.filter(Boolean).sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
}

async function readVersion(historyRoot, filename, versionId, maxBytes) {
  const safeVersionId = validateVersionId(versionId)
  const directory = await noteHistoryDirectory(historyRoot, filename, false)
  const { handle } = await openRegularVersion(path.join(directory, safeVersionId), maxBytes)
  try {
    return await handle.readFile('utf8')
  } finally {
    await handle.close()
  }
}

async function pruneVersions(historyRoot, filename, maxBytes, maxVersions = DEFAULT_MAX_VERSIONS) {
  if (!Number.isInteger(maxVersions) || maxVersions < 1) throw new Error('Invalid history retention limit')
  const versions = await listVersions(historyRoot, filename, maxBytes)
  await Promise.all(versions.slice(maxVersions).map(version => (
    fs.promises.unlink(path.join(historyRoot, historyKey(filename), version.id)).catch(error => {
      if (error?.code !== 'ENOENT') throw error
    })
  )))
  return versions.slice(0, maxVersions)
}

async function createVersion(historyRoot, filename, content, maxBytes, maxVersions = DEFAULT_MAX_VERSIONS) {
  if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > maxBytes) {
    throw new Error('Invalid note version content')
  }

  const existing = await listVersions(historyRoot, filename, maxBytes)
  if (existing.length > 0) {
    const latestContent = await readVersion(historyRoot, filename, existing[0].id, maxBytes)
    if (latestContent === content) return null
  }

  const directory = await noteHistoryDirectory(historyRoot, filename, true)
  const timestamp = Math.max(Date.now(), (existing[0]?.createdAt || 0) + 1)
  const id = `${timestamp}-${crypto.randomUUID()}.md`
  const target = path.join(directory, id)
  const temporary = path.join(directory, `.${id}.${crypto.randomUUID()}.tmp`)
  let handle
  try {
    handle = await fs.promises.open(temporary, 'wx', 0o600)
    await handle.writeFile(content, 'utf8')
    await handle.sync()
    await handle.close()
    handle = null
    await fs.promises.rename(temporary, target)
  } catch (error) {
    if (handle) await handle.close().catch(() => {})
    await fs.promises.unlink(temporary).catch(() => {})
    throw error
  }

  await pruneVersions(historyRoot, filename, maxBytes, maxVersions)
  const stat = await fs.promises.stat(target)
  return { id, filename, createdAt: Number(id.slice(0, 13)), size: stat.size }
}

async function migrateHistory(historyRoot, oldFilename, newFilename, maxBytes, maxVersions = DEFAULT_MAX_VERSIONS) {
  let source
  try {
    source = await noteHistoryDirectory(historyRoot, oldFilename, false)
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }

  await ensureRegularDirectory(historyRoot)
  const destination = path.join(historyRoot, historyKey(newFilename))
  try {
    const stat = await fs.promises.lstat(destination)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid history directory')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    await fs.promises.rename(source, destination)
    return
  }

  const entries = await fs.promises.readdir(source, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile() || !VERSION_ID_PATTERN.test(entry.name)) continue
    const sourcePath = path.join(source, entry.name)
    const { handle: sourceHandle } = await openRegularVersion(sourcePath, maxBytes)
    let content
    try {
      content = await sourceHandle.readFile()
    } finally {
      await sourceHandle.close()
    }
    let targetName = entry.name
    while (true) {
      let targetHandle
      try {
        targetHandle = await fs.promises.open(path.join(destination, targetName), 'wx', 0o600)
        await targetHandle.writeFile(content)
        await targetHandle.sync()
        await targetHandle.close()
        targetHandle = null
        await fs.promises.unlink(sourcePath)
        break
      } catch (error) {
        if (targetHandle) await targetHandle.close().catch(() => {})
        if (error?.code === 'EEXIST') {
          targetName = `${Date.now()}-${crypto.randomUUID()}.md`
          continue
        }
        await fs.promises.unlink(path.join(destination, targetName)).catch(() => {})
        throw error
      }
    }
  }
  await fs.promises.rmdir(source).catch(error => {
    if (error?.code !== 'ENOENT' && error?.code !== 'ENOTEMPTY') throw error
  })
  await pruneVersions(historyRoot, newFilename, maxBytes, maxVersions)
}

module.exports = {
  DEFAULT_MAX_VERSIONS,
  createVersion,
  historyKey,
  listVersions,
  migrateHistory,
  pruneVersions,
  readVersion,
  validateVersionId,
}
