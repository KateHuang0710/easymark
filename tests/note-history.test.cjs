const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  createVersion,
  historyKey,
  listVersions,
  migrateHistory,
  readVersion,
  validateVersionId,
} = require('../electron/note-history')

const MAX_BYTES = 1024 * 1024

async function withHistory(run) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'easymark-history-'))
  const historyRoot = path.join(root, '.history')
  try {
    await run(historyRoot)
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true })
  }
}

test('creates, lists, and reads note versions', async () => {
  await withHistory(async historyRoot => {
    const created = await createVersion(historyRoot, 'notes.md', '# first', MAX_BYTES)
    assert.ok(created)
    assert.equal(created.filename, 'notes.md')

    const versions = await listVersions(historyRoot, 'notes.md', MAX_BYTES)
    assert.equal(versions.length, 1)
    assert.equal(versions[0].id, created.id)
    assert.equal(await readVersion(historyRoot, 'notes.md', created.id, MAX_BYTES), '# first')
  })
})

test('does not duplicate the latest identical version', async () => {
  await withHistory(async historyRoot => {
    assert.ok(await createVersion(historyRoot, 'notes.md', 'same', MAX_BYTES))
    assert.equal(await createVersion(historyRoot, 'notes.md', 'same', MAX_BYTES), null)
    assert.equal((await listVersions(historyRoot, 'notes.md', MAX_BYTES)).length, 1)
  })
})

test('prunes versions beyond the retention limit', async () => {
  await withHistory(async historyRoot => {
    for (let index = 0; index < 14; index += 1) {
      await createVersion(historyRoot, 'notes.md', `version-${index}`, MAX_BYTES, 10)
    }
    const versions = await listVersions(historyRoot, 'notes.md', MAX_BYTES)
    assert.equal(versions.length, 10)
    assert.equal(await readVersion(historyRoot, 'notes.md', versions[0].id, MAX_BYTES), 'version-13')
    assert.equal(await readVersion(historyRoot, 'notes.md', versions.at(-1).id, MAX_BYTES), 'version-4')
  })
})

test('rejects version path traversal and malformed IDs', () => {
  for (const value of ['../secret.md', '123.md', '1700000000000-not-a-uuid.md', '/tmp/version.md']) {
    assert.throws(() => validateVersionId(value), /Invalid note version/)
  }
})

test('keeps histories isolated by filename hash', async () => {
  await withHistory(async historyRoot => {
    await createVersion(historyRoot, 'a.md', 'A', MAX_BYTES)
    await createVersion(historyRoot, 'b.md', 'B', MAX_BYTES)
    assert.notEqual(historyKey('a.md'), historyKey('b.md'))
    assert.equal((await listVersions(historyRoot, 'a.md', MAX_BYTES)).length, 1)
    assert.equal((await listVersions(historyRoot, 'b.md', MAX_BYTES)).length, 1)
  })
})

test('migrates history when a note is renamed', async () => {
  await withHistory(async historyRoot => {
    await createVersion(historyRoot, 'old.md', 'before rename', MAX_BYTES)
    await migrateHistory(historyRoot, 'old.md', 'new.md', MAX_BYTES)
    assert.deepEqual(await listVersions(historyRoot, 'old.md', MAX_BYTES), [])
    const versions = await listVersions(historyRoot, 'new.md', MAX_BYTES)
    assert.equal(versions.length, 1)
    assert.equal(await readVersion(historyRoot, 'new.md', versions[0].id, MAX_BYTES), 'before rename')
  })
})

test('merges history with an existing destination history', async () => {
  await withHistory(async historyRoot => {
    await createVersion(historyRoot, 'old.md', 'old history', MAX_BYTES)
    await createVersion(historyRoot, 'new.md', 'existing history', MAX_BYTES)
    await migrateHistory(historyRoot, 'old.md', 'new.md', MAX_BYTES)
    const versions = await listVersions(historyRoot, 'new.md', MAX_BYTES)
    const contents = await Promise.all(versions.map(version => readVersion(historyRoot, 'new.md', version.id, MAX_BYTES)))
    assert.deepEqual(new Set(contents), new Set(['old history', 'existing history']))
  })
})

test('rejects a symbolic-link history root', async t => {
  if (process.platform === 'win32') return t.skip('symbolic link permissions vary on Windows')
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'easymark-history-link-'))
  try {
    const target = path.join(root, 'target')
    const link = path.join(root, '.history')
    await fs.promises.mkdir(target)
    await fs.promises.symlink(target, link)
    await assert.rejects(() => listVersions(link, 'notes.md', MAX_BYTES), /Invalid history directory/)
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true })
  }
})
