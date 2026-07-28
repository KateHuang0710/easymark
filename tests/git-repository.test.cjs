const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { commitGit, getGitDiff, getGitHistory, getGitStatus, initializeGit, validateCommitMessage } = require('../electron/git-repository')

function hasGit() {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true } catch { return false }
}

test('validates Git commit messages', () => {
  assert.equal(validateCommitMessage(' Save notes '), 'Save notes')
  assert.throws(() => validateCommitMessage(''))
  assert.throws(() => validateCommitMessage('bad\nmessage'))
})

test('initializes, commits, and reads note history', { skip: !hasGit() }, async t => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'easymark-git-'))
  t.after(() => fs.promises.rm(directory, { recursive: true, force: true }))
  await fs.promises.writeFile(path.join(directory, 'Note.md'), '# Note\n', 'utf8')

  const initialized = await initializeGit(directory)
  assert.equal(initialized.initialized, true)
  assert.equal(initialized.dirty, true)
  await commitGit(directory, 'Initial notes')
  const history = await getGitHistory(directory)
  assert.equal(history[0].subject, 'Initial notes')

  await fs.promises.appendFile(path.join(directory, 'Note.md'), '\nChanged', 'utf8')
  const status = await getGitStatus(directory)
  assert.equal(status.dirty, true)
  assert.match(await getGitDiff(directory), /Changed/)
})
