const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { writeFileAtomically } = require('../electron/atomic-file')

test('atomically creates and replaces a file without leaving temporary files', async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'easymark-atomic-'))
  try {
    const target = path.join(root, 'export.docx')
    await writeFileAtomically(target, Buffer.from('first'))
    await writeFileAtomically(target, Buffer.from('second'))
    assert.equal(await fs.promises.readFile(target, 'utf8'), 'second')
    assert.deepEqual(await fs.promises.readdir(root), ['export.docx'])
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true })
  }
})
