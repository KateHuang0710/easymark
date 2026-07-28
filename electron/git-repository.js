const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const { promisify } = require('util')

const execFileAsync = promisify(execFile)
const MAX_GIT_OUTPUT = 2 * 1024 * 1024

async function runGit(repository, args) {
  const result = await execFileAsync('git', ['-C', repository, ...args], {
    encoding: 'utf8',
    timeout: 15_000,
    maxBuffer: MAX_GIT_OUTPUT,
    windowsHide: true,
  })
  return result.stdout || ''
}

async function gitAvailable() {
  try {
    await execFileAsync('git', ['--version'], { encoding: 'utf8', timeout: 5_000, windowsHide: true })
    return true
  } catch {
    return false
  }
}

async function repositoryInitialized(repository) {
  try {
    const stat = await fs.promises.lstat(path.join(repository, '.git'))
    return stat.isDirectory() && !stat.isSymbolicLink()
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function getGitStatus(repository) {
  const available = await gitAvailable()
  if (!available) return { available: false, initialized: false, dirty: false, summary: '', branch: '' }
  const initialized = await repositoryInitialized(repository)
  if (!initialized) return { available: true, initialized: false, dirty: false, summary: '', branch: '' }
  const summary = await runGit(repository, ['status', '--porcelain=v1', '--untracked-files=all'])
  let branch = 'main'
  try {
    branch = (await runGit(repository, ['symbolic-ref', '--short', 'HEAD'])).trim() || 'main'
  } catch {}
  return { available: true, initialized: true, dirty: Boolean(summary.trim()), summary: summary.trim(), branch }
}

async function initializeGit(repository) {
  if (!await gitAvailable()) throw new Error('Git is not installed')
  if (!await repositoryInitialized(repository)) {
    try {
      await runGit(repository, ['init', '--initial-branch=main'])
    } catch {
      await runGit(repository, ['init'])
    }
  }
  const ignorePath = path.join(repository, '.gitignore')
  try {
    const existing = await fs.promises.readFile(ignorePath, 'utf8')
    if (!existing.split(/\r?\n/).includes('.history/')) {
      await fs.promises.appendFile(ignorePath, `${existing.endsWith('\n') || !existing ? '' : '\n'}.history/\n`, 'utf8')
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    await fs.promises.writeFile(ignorePath, '.history/\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  }
  return getGitStatus(repository)
}

function validateCommitMessage(message) {
  if (typeof message !== 'string') throw new Error('Invalid commit message')
  const value = message.trim()
  if (!value || value.length > 200 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Invalid commit message')
  return value
}

async function commitGit(repository, message) {
  const status = await getGitStatus(repository)
  if (!status.available) throw new Error('Git is not installed')
  if (!status.initialized) await initializeGit(repository)
  await runGit(repository, ['add', '--all', '--', '.'])
  const staged = await runGit(repository, ['diff', '--cached', '--name-only'])
  if (!staged.trim()) return getGitStatus(repository)
  await runGit(repository, [
    '-c', 'user.name=EasyMark',
    '-c', 'user.email=easymark@local',
    'commit', '-m', validateCommitMessage(message),
  ])
  return getGitStatus(repository)
}

async function getGitHistory(repository) {
  if (!await repositoryInitialized(repository)) return []
  try {
    const output = await runGit(repository, ['log', '-n', '30', '--pretty=format:%H%x1f%s%x1f%an%x1f%ct'])
    return output.split('\n').filter(Boolean).map(line => {
      const [hash, subject, author, timestamp] = line.split('\x1f')
      return { hash, subject, author, createdAt: Number(timestamp) * 1000 }
    }).filter(item => item.hash && Number.isFinite(item.createdAt))
  } catch {
    return []
  }
}

async function getGitDiff(repository) {
  if (!await repositoryInitialized(repository)) return ''
  const [unstaged, staged] = await Promise.all([
    runGit(repository, ['diff', '--no-ext-diff', '--', '.']),
    runGit(repository, ['diff', '--cached', '--no-ext-diff', '--', '.']),
  ])
  return [staged && `# Staged\n${staged}`, unstaged && `# Working tree\n${unstaged}`].filter(Boolean).join('\n\n')
}

module.exports = { commitGit, getGitDiff, getGitHistory, getGitStatus, initializeGit, validateCommitMessage }
