const test = require('node:test')
const assert = require('node:assert/strict')
const {
  AI_CREDENTIAL_STORAGE,
  canPersistAICredential,
  getAICredentialStorageMode,
  isValidEncryptedAICredential,
} = require('../electron/credential-storage')

test('uses system credential encryption for normal signed builds', () => {
  assert.equal(getAICredentialStorageMode({ encryptionAvailable: true }), AI_CREDENTIAL_STORAGE.SECURE)
})

test('persists ad-hoc macOS credentials with the no-prompt local backend', () => {
  const mode = getAICredentialStorageMode({ usingMockKeychain: true, encryptionAvailable: true })
  assert.equal(mode, AI_CREDENTIAL_STORAGE.LOCAL)
  assert.equal(canPersistAICredential(mode), true)
})

test('falls back to session storage only when encryption is unavailable', () => {
  const mode = getAICredentialStorageMode({ usingMockKeychain: true, encryptionAvailable: false })
  assert.equal(mode, AI_CREDENTIAL_STORAGE.SESSION)
  assert.equal(canPersistAICredential(mode), false)
})

test('accepts only bounded base64 encrypted credentials', () => {
  assert.equal(isValidEncryptedAICredential(Buffer.from('secret').toString('base64')), true)
  assert.equal(isValidEncryptedAICredential(''), false)
  assert.equal(isValidEncryptedAICredential('not base64!'), false)
  assert.equal(isValidEncryptedAICredential('A'.repeat(16_385)), false)
})
