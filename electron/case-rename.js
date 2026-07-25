const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

async function fileIdentity(filePath) {
  try {
    const stat = await fs.promises.lstat(filePath)
    return { dev: stat.dev, ino: stat.ino }
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

async function renameFileCaseSafely(source, destination) {
  const sourceIdentity = await fileIdentity(source)
  if (!sourceIdentity) throw Object.assign(new Error('Source file not found'), { code: 'ENOENT' })
  const destinationIdentity = await fileIdentity(destination)
  if (destinationIdentity && (
    destinationIdentity.dev !== sourceIdentity.dev || destinationIdentity.ino !== sourceIdentity.ino
  )) return false

  const temporary = path.join(path.dirname(source), `.${path.basename(source)}.${crypto.randomUUID()}.rename`)
  await fs.promises.rename(source, temporary)
  try {
    await fs.promises.rename(temporary, destination)
  } catch (error) {
    await fs.promises.rename(temporary, source).catch(() => {})
    throw error
  }
  return true
}

module.exports = { renameFileCaseSafely }
