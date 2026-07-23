const fs = require('fs')

async function ensureRegularDirectory(directory, label = 'directory') {
  await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 })
  const stat = await fs.promises.lstat(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Invalid ${label}`)
  }
  return stat
}

module.exports = { ensureRegularDirectory }
