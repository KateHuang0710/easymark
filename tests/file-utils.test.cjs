const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const {
  MAX_TITLE_BYTES,
  resolveNotePath,
  sanitizeTitle,
  validateImageDataUrl,
  validateNoteFilename,
} = require('../electron/file-utils')

test('sanitizeTitle removes cross-platform reserved characters and names', () => {
  assert.equal(sanitizeTitle('  report: Q3?.  '), 'report Q3')
  assert.equal(sanitizeTitle('CON'), '_CON')
  assert.equal(sanitizeTitle('***'), 'untitled')
})

test('validateNoteFilename rejects traversal and non-markdown files', () => {
  for (const value of ['../secret.md', '..\\secret.md', '/tmp/a.md', 'note.txt', '.md']) {
    assert.throws(() => validateNoteFilename(value))
  }
  assert.equal(validateNoteFilename('安全笔记.md'), '安全笔记.md')
})

test('resolveNotePath always stays in the notes directory', () => {
  const root = path.resolve('/tmp/easymark-notes')
  assert.equal(resolveNotePath(root, 'note.md'), path.join(root, 'note.md'))
  assert.throws(() => resolveNotePath(root, '../note.md'))
})

test('validateImageDataUrl accepts safe raster formats and enforces size', () => {
  const pngData = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('test')]).toString('base64')
  const png = validateImageDataUrl(`data:image/png;base64,${pngData}`)
  assert.equal(png.extension, 'png')
  assert.throws(() => validateImageDataUrl('data:image/svg+xml;base64,PHN2Zz4='))
  assert.throws(() => validateImageDataUrl('data:image/png;base64,aGVsbG8=', 2))
})

test('sanitizeTitle truncates oversized titles', () => {
  const long = 'a'.repeat(300)
  const title = sanitizeTitle(long)
  assert.ok(title.length <= 120)
  assert.equal(title, 'a'.repeat(120))
})

test('sanitizeTitle respects UTF-8 filesystem component limits', () => {
  const title = sanitizeTitle('汉'.repeat(120))
  const emojiTitle = sanitizeTitle('😀'.repeat(120))
  assert.ok(Buffer.byteLength(title, 'utf8') <= MAX_TITLE_BYTES)
  assert.ok(Buffer.byteLength(emojiTitle, 'utf8') <= MAX_TITLE_BYTES)
  assert.doesNotThrow(() => validateNoteFilename(`${title}.md`))
  assert.doesNotMatch(emojiTitle, /[\uD800-\uDBFF]$/, 'title must not end with a split surrogate pair')
})

test('validateImageDataUrl rejects spoofed MIME types', () => {
  const jpegMagic = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
  const spoofed = `data:image/png;base64,${jpegMagic.toString('base64')}`
  assert.throws(() => validateImageDataUrl(spoofed))
})
