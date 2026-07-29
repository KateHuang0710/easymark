const AI_CREDENTIAL_STORAGE = Object.freeze({
  SECURE: 'secure',
  LOCAL: 'local',
  SESSION: 'session',
})

function getAICredentialStorageMode({ usingMockKeychain = false, encryptionAvailable = false } = {}) {
  if (!encryptionAvailable) return AI_CREDENTIAL_STORAGE.SESSION
  return usingMockKeychain ? AI_CREDENTIAL_STORAGE.LOCAL : AI_CREDENTIAL_STORAGE.SECURE
}

function canPersistAICredential(mode) {
  return mode === AI_CREDENTIAL_STORAGE.SECURE || mode === AI_CREDENTIAL_STORAGE.LOCAL
}

function isValidEncryptedAICredential(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 16_384
    && /^[A-Za-z0-9+/]+={0,2}$/.test(value)
}

module.exports = {
  AI_CREDENTIAL_STORAGE,
  canPersistAICredential,
  getAICredentialStorageMode,
  isValidEncryptedAICredential,
}
