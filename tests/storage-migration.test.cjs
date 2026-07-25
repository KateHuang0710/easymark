const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { historyKey } = require('../electron/note-history')
const { MIGRATION_MARKER, migrateLegacyStorage } = require('../electron/storage-migration')

async function withTemporaryDirectory(run) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'easymark-storage-migration-'))
  try {
    await run(root)
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true })
  }
}

async function writeLegacyVersion(legacyRoot, filename, content) {
  const directory = path.join(legacyRoot, '.history', historyKey(filename))
  await fs.promises.mkdir(directory, { recursive: true })
  const versionId = `${Date.now()}-${crypto.randomUUID()}.md`
  await fs.promises.writeFile(path.join(directory, versionId), content)
  return versionId
}

test('copies all Markdown notes from a dedicated legacy directory', async () => {
  await withTemporaryDirectory(async root => {
    const legacy = path.join(root, 'EasyMark')
    const destination = path.join(root, 'EasyMark Notes')
    await fs.promises.mkdir(legacy)
    await fs.promises.writeFile(path.join(legacy, 'one.md'), '# one')
    await fs.promises.writeFile(path.join(legacy, 'two.md'), '# two')

    const report = await migrateLegacyStorage({ legacyRoot: legacy, destinationRoot: destination, maxNoteBytes: 1024 })

    assert.deepEqual(report.migratedNotes.sort(), ['one.md', 'two.md'])
    assert.equal(await fs.promises.readFile(path.join(destination, 'one.md'), 'utf8'), '# one')
    assert.equal(await fs.promises.readFile(path.join(legacy, 'one.md'), 'utf8'), '# one')
    assert.equal(fs.existsSync(path.join(destination, MIGRATION_MARKER)), true)
  })
})

test('migrates only verified notes when the legacy directory contains a project', async () => {
  await withTemporaryDirectory(async root => {
    const legacy = path.join(root, 'EasyMark')
    const destination = path.join(root, 'EasyMark Notes')
    await fs.promises.mkdir(path.join(legacy, '.git'), { recursive: true })
    await fs.promises.writeFile(path.join(legacy, 'README.md'), '# project', { mode: 0o644 })
    await fs.promises.writeFile(path.join(legacy, 'draft.md'), '# note', { mode: 0o600 })
    await fs.promises.writeFile(path.join(legacy, 'history-note.md'), '# edited note', { mode: 0o644 })
    const versionId = await writeLegacyVersion(legacy, 'history-note.md', '# old note')

    const report = await migrateLegacyStorage({ legacyRoot: legacy, destinationRoot: destination, maxNoteBytes: 1024 })

    assert.equal(report.contaminatedLegacyDirectory, true)
    assert.deepEqual(report.migratedNotes.sort(), ['draft.md', 'history-note.md'])
    assert.deepEqual(report.skippedMarkdown, ['README.md'])
    assert.equal(fs.existsSync(path.join(destination, 'README.md')), false)
    assert.equal(
      await fs.promises.readFile(path.join(destination, '.history', historyKey('history-note.md'), versionId), 'utf8'),
      '# old note',
    )
  })
})

test('does not overwrite a different destination note and runs only once', async () => {
  await withTemporaryDirectory(async root => {
    const legacy = path.join(root, 'EasyMark')
    const destination = path.join(root, 'EasyMark Notes')
    await fs.promises.mkdir(legacy)
    await fs.promises.mkdir(destination)
    await fs.promises.writeFile(path.join(legacy, 'same.md'), 'legacy')
    await fs.promises.writeFile(path.join(destination, 'same.md'), 'current')

    const first = await migrateLegacyStorage({ legacyRoot: legacy, destinationRoot: destination, maxNoteBytes: 1024 })
    assert.deepEqual(first.migratedNotes, ['same-imported.md'])
    assert.equal(await fs.promises.readFile(path.join(destination, 'same.md'), 'utf8'), 'current')
    assert.equal(await fs.promises.readFile(path.join(destination, 'same-imported.md'), 'utf8'), 'legacy')

    await fs.promises.writeFile(path.join(legacy, 'later.md'), 'later')
    const second = await migrateLegacyStorage({ legacyRoot: legacy, destinationRoot: destination, maxNoteBytes: 1024 })
    assert.equal(second.alreadyCompleted, true)
    assert.equal(fs.existsSync(path.join(destination, 'later.md')), false)
  })
})

test('copies supported assets without following symbolic links', async t => {
  if (process.platform === 'win32') return t.skip('symbolic link permissions vary on Windows')
  await withTemporaryDirectory(async root => {
    const legacy = path.join(root, 'EasyMark')
    const destination = path.join(root, 'EasyMark Notes')
    await fs.promises.mkdir(path.join(legacy, 'assets'), { recursive: true })
    await fs.promises.writeFile(path.join(legacy, 'note.md'), '![image](assets/image.png)')
    await fs.promises.writeFile(path.join(legacy, 'assets', 'image.png'), Buffer.from([1, 2, 3]))
    await fs.promises.symlink(path.join(legacy, 'assets', 'image.png'), path.join(legacy, 'assets', 'linked.png'))

    const report = await migrateLegacyStorage({ legacyRoot: legacy, destinationRoot: destination, maxNoteBytes: 1024 })

    assert.equal(report.copiedAssets, 1)
    assert.deepEqual(await fs.promises.readFile(path.join(destination, 'assets', 'image.png')), Buffer.from([1, 2, 3]))
    assert.equal(fs.existsSync(path.join(destination, 'assets', 'linked.png')), false)
  })
})

test('renames conflicting assets and rewrites note and history references', async () => {
  await withTemporaryDirectory(async root => {
    const legacy = path.join(root, 'EasyMark')
    const destination = path.join(root, 'EasyMark Notes')
    await fs.promises.mkdir(path.join(legacy, 'assets'), { recursive: true })
    await fs.promises.mkdir(path.join(destination, 'assets'), { recursive: true })
    await fs.promises.writeFile(path.join(legacy, 'note.md'), '![legacy](assets/image.png)')
    await fs.promises.writeFile(path.join(legacy, 'assets', 'image.png'), Buffer.from([1, 2, 3]))
    await fs.promises.writeFile(path.join(destination, 'assets', 'image.png'), Buffer.from([9, 8, 7]))
    const versionId = await writeLegacyVersion(legacy, 'note.md', '![old](assets/image.png)')

    const report = await migrateLegacyStorage({ legacyRoot: legacy, destinationRoot: destination, maxNoteBytes: 1024 })

    assert.equal(report.copiedAssets, 1)
    assert.equal(await fs.promises.readFile(path.join(destination, 'note.md'), 'utf8'), '![legacy](assets/image-imported.png)')
    assert.deepEqual(await fs.promises.readFile(path.join(destination, 'assets', 'image.png')), Buffer.from([9, 8, 7]))
    assert.deepEqual(await fs.promises.readFile(path.join(destination, 'assets', 'image-imported.png')), Buffer.from([1, 2, 3]))
    assert.equal(
      await fs.promises.readFile(path.join(destination, '.history', historyKey('note.md'), versionId), 'utf8'),
      '![old](assets/image-imported.png)',
    )
  })
})

test('rejects a symbolic-link legacy history root', async t => {
  if (process.platform === 'win32') return t.skip('symbolic link permissions vary on Windows')
  await withTemporaryDirectory(async root => {
    const legacy = path.join(root, 'EasyMark')
    const destination = path.join(root, 'EasyMark Notes')
    const outside = path.join(root, 'outside-history')
    await fs.promises.mkdir(path.join(legacy, '.git'), { recursive: true })
    await fs.promises.mkdir(outside)
    await fs.promises.writeFile(path.join(legacy, 'note.md'), '# note', { mode: 0o644 })
    await fs.promises.symlink(outside, path.join(legacy, '.history'))

    await assert.rejects(
      () => migrateLegacyStorage({ legacyRoot: legacy, destinationRoot: destination, maxNoteBytes: 1024 }),
      /Invalid legacy history directory/,
    )
  })
})
