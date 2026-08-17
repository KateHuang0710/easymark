const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const projectRoot = path.resolve(__dirname, '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))

test('builds the default Windows distribution for x64', () => {
  assert.equal(packageJson.scripts['dist:win'], 'npm run dist:win:x64')
  assert.match(packageJson.scripts['dist:win:x64'], /electron-builder --win nsis --x64/)
  assert.match(packageJson.scripts['dist:win:arm64'], /electron-builder --win nsis --arm64/)
})

test('packages the runtime window icons', () => {
  assert.ok(packageJson.build.files.includes('build/icon.ico'))
  assert.ok(packageJson.build.files.includes('build/icon-512x512.png'))
  assert.equal(packageJson.build.win.icon, 'build/icon.ico')
  assert.equal(packageJson.build.linux.icon, 'build/icon-512x512.png')
})
