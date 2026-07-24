import DOMPurify from 'dompurify'
import { marked, Renderer } from 'marked'
import hljs from 'highlight.js'

const renderer = new Renderer()
let showCodeLang = true

const SAFE_URI = /^(?:(?:https?|mailto|easymark-asset):|data:image\/(?:png|jpe?g|gif|webp);base64,|#)/i
const LOCAL_ASSET = /^(?:\.\/)?assets\/([^/?#\\]+)$/i
const SAFE_IMAGE_EXTENSION = /\.(?:png|jpe?g|gif|webp)$/i

DOMPurify.addHook('afterSanitizeAttributes', node => {
  if (node.tagName?.toLowerCase() !== 'a') return
  const href = node.getAttribute('href') || ''
  if (!href || href.startsWith('#')) {
    node.removeAttribute('target')
    node.removeAttribute('rel')
    return
  }
  node.setAttribute('target', '_blank')
  node.setAttribute('rel', 'noopener noreferrer')
})

DOMPurify.addHook('uponSanitizeAttribute', (node, hookEvent) => {
  const tagName = node.tagName?.toLowerCase()
  if (
    (tagName === 'th' || tagName === 'td') &&
    hookEvent.attrName === 'align' &&
    ['left', 'center', 'right'].includes(hookEvent.attrValue.toLowerCase())
  ) {
    hookEvent.forceKeepAttr = true
  }
})

export function setShowCodeLang(v: boolean) { showCodeLang = v }

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function normalizeMarkdownAssetUrl(rawUrl: string): string {
  const value = rawUrl.trim()
  const match = value.match(LOCAL_ASSET)
  if (!match) return value
  let filename: string
  try {
    filename = decodeURIComponent(match[1])
  } catch {
    return ''
  }
  if (!filename || filename === '.' || filename === '..' || !SAFE_IMAGE_EXTENSION.test(filename)) return ''
  return `easymark-asset://local/${encodeURIComponent(filename)}`
}

function sanitizeRenderedHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ALLOWED_URI_REGEXP: SAFE_URI,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'button', 'textarea', 'select', 'option', 'base', 'meta', 'link', 'svg', 'math'],
    FORBID_ATTR: ['style', 'srcdoc', 'formaction'],
    ADD_ATTR: ['target'],
  })
}

renderer.code = (text: string, lang: string) => {
  const language = lang || ''
  const safeLang = escapeHtml(language)
  let highlighted = text
  if (language && hljs.getLanguage(language)) {
    try {
      highlighted = hljs.highlight(text, { language }).value
    } catch {
      highlighted = escapeHtml(text)
    }
  } else {
    highlighted = escapeHtml(text)
  }
  const langLabel = language && showCodeLang ? `<span class="code-lang-label">${safeLang}</span>` : ''
  const languageClass = safeLang ? ` language-${safeLang}` : ''
  return `<pre data-lang="${safeLang}">${langLabel}<code class="hljs${languageClass}">${highlighted}</code></pre>`
}

renderer.image = (href: string, title: string | null, text: string) => {
  const normalized = normalizeMarkdownAssetUrl(href)
  if (!normalized) return escapeHtml(text)
  const safeHref = escapeHtml(normalized)
  const safeTitle = title ? ` title="${escapeHtml(title)}"` : ''
  return `<img src="${safeHref}" alt="${escapeHtml(text)}"${safeTitle}>`
}

renderer.link = (href: string, title: string | null, text: string) => {
  const value = href.trim()
  if (!SAFE_URI.test(value) || value.startsWith('easymark-asset:') || value.startsWith('data:')) return text
  const safeHref = escapeHtml(value)
  const safeTitle = title ? ` title="${escapeHtml(title)}"` : ''
  const externalAttrs = value.startsWith('#') ? '' : ' target="_blank" rel="noopener noreferrer"'
  return `<a href="${safeHref}"${safeTitle}${externalAttrs}>${text}</a>`
}

marked.setOptions({
  renderer,
  breaks: true,
  gfm: true,
})

export function renderMarkdown(markdown: string): string {
  try {
    const result = marked.parse(markdown)
    return sanitizeRenderedHtml(typeof result === 'string' ? result : '')
  } catch {
    return '<p>Error rendering markdown</p>'
  }
}

export function extractTitle(markdown: string): string {
  const lines = markdown.split('\n')
  for (const line of lines) {
    if (line.startsWith('# ')) return line.slice(2).trim()
  }
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const hMatch = line.match(/^#{1,6}\s+(.+)$/)
    if (hMatch) return hMatch[1].trim()
    return trimmed.length > 60 ? trimmed.slice(0, 60) + '...' : trimmed
  }
  return 'Untitled'
}

export function highlightMarkdown(md: string): string {
  const escaped = escapeHtml(md)
  const lines = escaped.split('\n')
  const result: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (/^```/.test(line)) {
      const lang = line.replace(/^```/, '').trim()
      i++
      const bodyLines: string[] = []
      while (i < lines.length && !/^```/.test(lines[i])) {
        bodyLines.push(lines[i])
        i++
      }

      result.push('<div class="src-fence-block">')
      result.push('<div class="src-line src-fence-header">' +
        (lang ? `<span class="src-fence-lang">${lang}</span>` : '') + '</div>')
      bodyLines.forEach(bl => {
        result.push(`<div class="src-line src-fence-line"><span class="src-fence-text">${bl}</span></div>`)
      })
      if (i < lines.length) {
        result.push(`<div class="src-line src-fence-footer"><span class="src-fence-text">${lines[i]}</span></div>`)
        i++
      }
      result.push('</div>')
      continue
    }

    const processed = line
      .replace(/(`[^`\n]+`)/g, '<span class="src-inline-code">$1</span>')
      .replace(/(\*\*[^*]+\*\*)/g, '<span class="src-bold">$1</span>')
      .replace(/(~~[^~]+~~)/g, '<span class="src-strikethrough">$1</span>')
      .replace(/(!\[[^\]]*\]\([^)]+\))/g, '<span class="src-image">$1</span>')
      .replace(/(\[[^\]]+\]\([^)]+\))/g, '<span class="src-link">$1</span>')
      .replace(/(\*[^*]+\*)/g, '<span class="src-italic">$1</span>')

    if (/^#{1,6}\s/.test(line)) {
      const level = line.match(/^(#+)/)![1].length
      result.push(`<div class="src-line src-h${level}">${processed}</div>`)
    } else if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      result.push(`<div class="src-line src-hr-line">${processed}</div>`)
    } else if (/^>\s?/.test(line)) {
      result.push(`<div class="src-line src-bq-line">${processed}</div>`)
    } else if (/^[\s]*[-*+]\s/.test(line) || /^[\s]*\d+\.\s/.test(line)) {
      result.push(`<div class="src-line src-list-line">${processed}</div>`)
    } else {
      result.push(`<div class="src-line">${processed}</div>`)
    }
    i++
  }

  return result.join('\n')
}

export function stripMarkdown(markdown: string, maxLen: number = 150): string {
  const doc = new DOMParser().parseFromString(renderMarkdown(markdown), 'text/html')
  const text = (doc.body.textContent || '').replace(/\s+/g, ' ').trim()
  return text.length > maxLen ? text.slice(0, maxLen) + '...' : text
}
