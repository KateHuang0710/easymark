const fs = require('fs')
const path = require('path')

const TEMPORARY_FILE_PATTERN = /^\..+\.tmp$/

async function sweepOrphanedTemporaryFiles(root, options = {}) {
  const minAgeMs = Number.isFinite(options.minAgeMs) ? Math.max(0, options.minAgeMs) : 0
  const cutoff = Date.now() - minAgeMs
  const removed = []

  async function visit(directory) {
    let entries
    try {
      entries = await fs.promises.readdir(directory, { withFileTypes: true })
    } catch (error) {
      if (error?.code === 'ENOENT') return
      throw error
    }

    for (const entry of entries) {
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(target)
        continue
      }
      if (!entry.isFile() || !TEMPORARY_FILE_PATTERN.test(entry.name)) continue

      try {
        const stat = await fs.promises.stat(target)
        if (stat.mtimeMs > cutoff) continue
        await fs.promises.unlink(target)
        removed.push(target)
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
    }
  }

  await visit(root)
  return removed
}

module.exports = { sweepOrphanedTemporaryFiles }
