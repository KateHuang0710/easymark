const path = require('path')

const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i
const NOTE_EXTENSION = '.md'
const MAX_TITLE_LENGTH = 120

function sanitizeTitle(value, fallback = 'untitled') {
  let title = typeof value === 'string' ? value : ''
  title = title
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, MAX_TITLE_LENGTH)
    .trim()

  if (!title) title = fallback
  if (WINDOWS_RESERVED_NAMES.test(title)) title = `_${title}`
  return title
}

function validateNoteFilename(filename) {
  if (typeof filename !== 'string' || !filename || filename.length > MAX_TITLE_LENGTH + NOTE_EXTENSION.length + 8) {
    throw new Error('Invalid note filename')
  }
  if (filename.includes('\0') || path.posix.basename(filename) !== filename || path.win32.basename(filename) !== filename) {
    throw new Error('Invalid note filename')
  }
  if (path.extname(filename).toLowerCase() !== NOTE_EXTENSION || filename === NOTE_EXTENSION) {
    throw new Error('Invalid note filename')
  }
  return filename
}

function resolveNotePath(notesDir, filename) {
  const validFilename = validateNoteFilename(filename)
  const root = path.resolve(notesDir)
  const resolved = path.resolve(root, validFilename)
  if (path.dirname(resolved) !== root) {
    throw new Error('Invalid note path')
  }
  return resolved
}

function sanitizeExportFilename(title, fallback = 'EasyMark') {
  return sanitizeTitle(title, fallback)
}

function validateImageDataUrl(dataUrl, maxBytes = 10 * 1024 * 1024) {
  if (typeof dataUrl !== 'string') throw new Error('Invalid image data')
  const matches = dataUrl.match(/^data:image\/(png|jpe?g|gif|webp);base64,([A-Za-z0-9+/=]+)$/i)
  if (!matches) throw new Error('Unsupported image format')
  const subtype = matches[1].toLowerCase()
  const extension = subtype === 'jpeg' || subtype === 'jpg' ? 'jpg' : subtype
  const buffer = Buffer.from(matches[2], 'base64')
  if (!buffer.length || buffer.length > maxBytes) throw new Error('Image is empty or too large')
  const signatures = {
    png: buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    jpg: buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
    gif: buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii')),
    webp: buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP',
  }
  if (!signatures[extension]) throw new Error('Image content does not match its declared format')
  return { extension, buffer }
}

module.exports = {
  MAX_TITLE_LENGTH,
  resolveNotePath,
  sanitizeExportFilename,
  sanitizeTitle,
  validateImageDataUrl,
  validateNoteFilename,
}
