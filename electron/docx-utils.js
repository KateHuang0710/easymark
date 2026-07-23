function parseInlineRuns(text, baseStyle = {}) {
  const runs = []
  const inlineRegex = /(`[^`]+`)|(\[([^\]]+)\]\(([^)]+)\))|(!\[([^\]]*)\]\(([^)]+)\))|(\*\*(.+?)\*\*)|(\*(.+?)\*)|(~~(.+?)~~)/g
  let lastIndex = 0
  let match

  while ((match = inlineRegex.exec(text)) !== null) {
    if (match.index > lastIndex) runs.push({ ...baseStyle, text: text.slice(lastIndex, match.index) })

    if (match[1]) {
      runs.push({ ...baseStyle, text: match[1].slice(1, -1), font: 'Courier New', size: 18, color: 'E91E63' })
    } else if (match[2]) {
      runs.push({ ...baseStyle, text: match[3], style: 'Hyperlink', color: '1976D2', underline: { type: 'single' } })
    } else if (match[5]) {
      runs.push({ ...baseStyle, text: `[${match[6] || 'image'}]`, italics: true, color: '999999' })
    } else if (match[8]) {
      runs.push({ ...baseStyle, text: match[9], bold: true })
    } else if (match[10]) {
      runs.push({ ...baseStyle, text: match[11], italics: true })
    } else if (match[12]) {
      runs.push({ ...baseStyle, text: match[13], strike: true })
    }
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) runs.push({ ...baseStyle, text: text.slice(lastIndex) })
  return runs.length ? runs : [{ ...baseStyle, text }]
}

function parseTableCells(row) {
  const parts = row.split('|')
  if (parts[0]?.trim() === '') parts.shift()
  if (parts.at(-1)?.trim() === '') parts.pop()
  return parts.map(part => part.trim())
}

function isHorizontalRule(value) {
  return /^(?:-{3,}|\*{3,}|_{3,})$/.test(value.trim())
}

module.exports = { isHorizontalRule, parseInlineRuns, parseTableCells }
