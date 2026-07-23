const test = require('node:test')
const assert = require('node:assert/strict')
const { isHorizontalRule, parseInlineRuns, parseTableCells } = require('../electron/docx-utils')

test('applies blockquote styles without losing inline text', () => {
  const runs = parseInlineRuns('quoted **bold** text', { italics: true, color: '666666' })
  assert.equal(runs.map(run => run.text).join(''), 'quoted bold text')
  assert.ok(runs.every(run => run.italics === true))
  assert.equal(runs.find(run => run.text === 'bold').bold, true)
})

test('keeps an empty-alt image visible in DOCX output', () => {
  assert.deepEqual(parseInlineRuns('![](assets/image.png)').map(run => run.text), ['[image]'])
})

test('parses GFM table rows with or without a trailing pipe', () => {
  assert.deepEqual(parseTableCells('| A | B |'), ['A', 'B'])
  assert.deepEqual(parseTableCells('| A | B'), ['A', 'B'])
})

test('recognizes only complete horizontal-rule lines', () => {
  assert.equal(isHorizontalRule('***'), true)
  assert.equal(isHorizontalRule('***important***'), false)
})
