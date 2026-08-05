const test = require('node:test')
const assert = require('node:assert/strict')
const { isAdHocCodeSignature, isDeveloperIdSigned } = require('../electron/signing')

test('detects ad-hoc macOS signatures', () => {
  assert.equal(isAdHocCodeSignature('Identifier=com.easymark.app\nSignature=adhoc\nTeamIdentifier=not set\n'), true)
  assert.equal(isAdHocCodeSignature('Identifier=com.easymark.app\nTeamIdentifier=not set\n'), true)
})

test('keeps Developer ID signatures on the real keychain', () => {
  const details = [
    'Identifier=com.easymark.app',
    'Authority=Developer ID Application: Example Corp (ABCDE12345)',
    'TeamIdentifier=ABCDE12345',
  ].join('\n')
  assert.equal(isAdHocCodeSignature(details), false)
  assert.equal(isDeveloperIdSigned(details), true)
  assert.equal(isAdHocCodeSignature(''), false)
})

test('uses the no-prompt backend for unsigned dev binaries', () => {
  assert.equal(isDeveloperIdSigned(''), false)
})

test('recognizes Apple Development and Mac App Distribution identities', () => {
  const development = [
    'Identifier=com.easymark.app',
    'Authority=Apple Development: Example (ABCDE12345)',
    'TeamIdentifier=ABCDE12345',
  ].join('\n')
  const macAppStore = [
    'Identifier=com.easymark.app',
    'Authority=Mac App Distribution: Example Corp (ABCDE12345)',
    'TeamIdentifier=ABCDE12345',
  ].join('\n')
  assert.equal(isDeveloperIdSigned(development), true)
  assert.equal(isDeveloperIdSigned(macAppStore), true)
})

test('rejects authority lines with an unset team identifier', () => {
  const stale = [
    'Identifier=com.easymark.app',
    'Authority=Developer ID Application: Example Corp (ABCDE12345)',
    'TeamIdentifier=not set',
  ].join('\n')
  assert.equal(isDeveloperIdSigned(stale), false)
  assert.equal(isAdHocCodeSignature(stale), true)
})
