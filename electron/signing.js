function isAdHocCodeSignature(details) {
  if (typeof details !== 'string') return false
  return /(?:^|\n)Signature=adhoc(?:\n|$)/.test(details)
    || /(?:^|\n)TeamIdentifier=not set(?:\n|$)/.test(details)
}

const APPLE_SIGNED_AUTHORITY_PATTERN = /(?:^|\n)Authority=(?:Developer ID Application|Apple Development|Mac App Distribution|3rd Party Mac Developer Application):[^\n]*/

function isDeveloperIdSigned(details) {
  if (typeof details !== 'string') return false
  if (isAdHocCodeSignature(details)) return false
  if (!APPLE_SIGNED_AUTHORITY_PATTERN.test(details)) return false
  if (/(?:^|\n)TeamIdentifier=not set(?:\n|$)/.test(details)) return false
  return true
}

module.exports = { isAdHocCodeSignature, isDeveloperIdSigned }
