const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { renameFileCaseSafely } = require('../electron/case-rename')

test('renames only filename casing without creating a numbered duplicate', async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'easymark-case-rename-'))
  try {
    const source = path.join(root, 'Draft.md')
    const destination = path.join(root, 'draft.md')
    await fs.promises.writeFile(source, 'content')

    assert.equal(await renameFileCaseSafely(source, destination), true)
    assert.equal(await fs.promises.readFile(destination, 'utf8'), 'content')
    assert.deepEqual(await fs.promises.readdir(root), ['draft.md'])
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true })
  }
})

test('does not overwrite a distinct destination file', async t => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'easymark-case-rename-'))
  try {
    const source = path.join(root, 'Draft.md')
    const destination = path.join(root, 'draft.md')
    await fs.promises.writeFile(source, 'source')
    try {
      await fs.promises.writeFile(destination, 'destination', { flag: 'wx' })
    } catch (error) {
      if (error?.code === 'EEXIST') return t.skip('filesystem is case-insensitive')
      throw error
    }

    assert.equal(await renameFileCaseSafely(source, destination), false)
    assert.equal(await fs.promises.readFile(source, 'utf8'), 'source')
    assert.equal(await fs.promises.readFile(destination, 'utf8'), 'destination')
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true })
  }
})
