const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { sweepOrphanedTemporaryFiles } = require('../electron/recovery')

test('removes only orphaned temporary files and keeps notes and directories intact', async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'easymark-recovery-'))
  try {
    const nested = path.join(root, '.history', 'abc')
    await fs.promises.mkdir(nested, { recursive: true })
    await fs.promises.writeFile(path.join(root, 'note.md'), '# note')
    await fs.promises.writeFile(path.join(root, '.note.md.orphan.tmp'), 'stale')
    await fs.promises.writeFile(path.join(nested, '.version.tmp'), 'stale')
    await fs.promises.writeFile(path.join(nested, 'not-temporary.txt'), 'keep')

    const removed = await sweepOrphanedTemporaryFiles(root)

    assert.deepEqual(removed.map(file => path.relative(root, file)).sort(), [
      path.join('.history', 'abc', '.version.tmp'),
      '.note.md.orphan.tmp',
    ])
    assert.equal(await fs.promises.readFile(path.join(root, 'note.md'), 'utf8'), '# note')
    assert.equal(await fs.promises.readFile(path.join(nested, 'not-temporary.txt'), 'utf8'), 'keep')
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true })
  }
})

test('respects the minimum age before removing temporary files', async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'easymark-recovery-age-'))
  try {
    const temporary = path.join(root, '.note.md.active.tmp')
    await fs.promises.writeFile(temporary, 'active')

    const removed = await sweepOrphanedTemporaryFiles(root, { minAgeMs: 60_000 })

    assert.deepEqual(removed, [])
    assert.equal(await fs.promises.readFile(temporary, 'utf8'), 'active')
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true })
  }
})
