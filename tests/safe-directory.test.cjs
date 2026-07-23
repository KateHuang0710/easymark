const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { ensureRegularDirectory } = require('../electron/safe-directory')

async function withTemporaryDirectory(run) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'easymark-directory-'))
  try {
    await run(root)
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true })
  }
}

test('creates and accepts a regular directory', async () => {
  await withTemporaryDirectory(async root => {
    const directory = path.join(root, 'notes')
    const stat = await ensureRegularDirectory(directory, 'notes directory')
    assert.equal(stat.isDirectory(), true)
    assert.equal(stat.isSymbolicLink(), false)
  })
})

test('rejects a symbolic-link directory', async t => {
  if (process.platform === 'win32') return t.skip('symbolic link permissions vary on Windows')
  await withTemporaryDirectory(async root => {
    const target = path.join(root, 'target')
    const link = path.join(root, 'notes')
    await fs.promises.mkdir(target)
    await fs.promises.symlink(target, link)
    await assert.rejects(
      () => ensureRegularDirectory(link, 'notes directory'),
      /Invalid notes directory/,
    )
  })
})

test('rejects a regular file in place of a directory', async () => {
  await withTemporaryDirectory(async root => {
    const file = path.join(root, 'notes')
    await fs.promises.writeFile(file, 'not a directory')
    await assert.rejects(
      () => ensureRegularDirectory(file, 'notes directory'),
      error => error?.code === 'EEXIST' || /Invalid notes directory/.test(error?.message || ''),
    )
  })
})
