const test = require('node:test')
const assert = require('node:assert/strict')
const { isAdHocCodeSignature } = require('../electron/signing')

test('detects ad-hoc macOS signatures', () => {
  assert.equal(isAdHocCodeSignature('Identifier=com.easymark.app\nSignature=adhoc\nTeamIdentifier=not set\n'), true)
  assert.equal(isAdHocCodeSignature('Identifier=com.easymark.app\nTeamIdentifier=not set\n'), true)
})

test('keeps Developer ID signatures on the real keychain', () => {
  assert.equal(isAdHocCodeSignature([
    'Identifier=com.easymark.app',
    'Authority=Developer ID Application: Example Corp (ABCDE12345)',
    'TeamIdentifier=ABCDE12345',
  ].join('\n')), false)
  assert.equal(isAdHocCodeSignature(''), false)
})
