function isAdHocCodeSignature(details) {
  if (typeof details !== 'string') return false
  return /(?:^|\n)Signature=adhoc(?:\n|$)/.test(details)
    || /(?:^|\n)TeamIdentifier=not set(?:\n|$)/.test(details)
}

module.exports = { isAdHocCodeSignature }
