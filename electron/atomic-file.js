const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

async function writeFileAtomically(target, data, options = {}) {
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${crypto.randomUUID()}.tmp`,
  )
  let handle
  try {
    handle = await fs.promises.open(temporary, 'wx', options.mode ?? 0o600)
    await handle.writeFile(data, options.encoding ? { encoding: options.encoding } : undefined)
    await handle.sync()
    await handle.close()
    handle = null
    await fs.promises.rename(temporary, target)
  } catch (error) {
    if (handle) await handle.close().catch(() => {})
    await fs.promises.unlink(temporary).catch(() => {})
    throw error
  }
}

module.exports = { writeFileAtomically }
