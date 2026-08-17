import DOMPurify from 'dompurify'
import { marked, Renderer } from 'marked'
// Import Highlight.js core plus the languages exposed by EasyMark's picker.
// Importing `highlight.js` directly bundles every grammar (~190 languages),
// which made the initial editor load unnecessarily heavy.
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import css from 'highlight.js/lib/languages/css'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import go from 'highlight.js/lib/languages/go'
import graphql from 'highlight.js/lib/languages/graphql'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import latex from 'highlight.js/lib/languages/latex'
import markdown from 'highlight.js/lib/languages/markdown'
import php from 'highlight.js/lib/languages/php'
import powershell from 'highlight.js/lib/languages/powershell'
import python from 'highlight.js/lib/languages/python'
import r from 'highlight.js/lib/languages/r'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import scala from 'highlight.js/lib/languages/scala'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

for (const [name, grammar] of Object.entries({
  bash, c, cpp, css, dockerfile, go, graphql, java, javascript, json, kotlin,
  latex, markdown, php, powershell, python, r, ruby, rust, scala, sql, swift,
  typescript, xml, yaml,
})) {
  hljs.registerLanguage(name, grammar)
}

const renderer = new Renderer()
let showCodeLang = true
let renderMode: 'editable' | 'preview' = 'preview'

const SAFE_URI = /^(?:(?:https?|mailto|easymark-asset):|data:image\/(?:png|jpe?g|gif|webp);base64,|#)/i
const LOCAL_ASSET = /^(?:\.\/)?assets\/([^/?#\\]+)$/i
const SAFE_IMAGE_EXTENSION = /\.(?:png|jpe?g|gif|webp)$/i

DOMPurify.addHook('afterSanitizeAttributes', node => {
  if (node instanceof Element && node.classList.contains('code-lang-label')) {
    node.setAttribute('contenteditable', 'false')
  }
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

function renderMathExpression(expression: string): string {
  const greek: Record<string, string> = {
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', theta: 'θ', lambda: 'λ', mu: 'μ', pi: 'π', sigma: 'σ', phi: 'φ', omega: 'ω',
    Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Omega: 'Ω',
  }
  let value = escapeHtml(expression.trim())
  value = value.replace(/\\(alpha|beta|gamma|delta|epsilon|theta|lambda|mu|pi|sigma|phi|omega|Gamma|Delta|Theta|Lambda|Pi|Sigma|Phi|Omega)\b/g, (_, name) => greek[name] || name)
  value = value.replace(/\\(?:times|cdot)\b/g, '×').replace(/\\leq?\b/g, '≤').replace(/\\geq?\b/g, '≥').replace(/\\neq?\b/g, '≠').replace(/\\infty\b/g, '∞').replace(/\\rightarrow\b/g, '→')
  value = value.replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, '<span class="math-frac"><span>$1</span><span>$2</span></span>')
  value = value.replace(/\^\{([^{}]+)\}|\^([A-Za-z0-9+-]+)/g, '<sup>$1$2</sup>')
  value = value.replace(/_\{([^{}]+)\}|_([A-Za-z0-9+-]+)/g, '<sub>$1$2</sub>')
  return value
}

function renderMermaidPreview(source: string): string {
  const lines = source.split('\n').map(line => line.trim()).filter(Boolean)
  const first = lines[0]?.toLowerCase() || ''
  if (/^(?:flowchart|graph)\b/.test(first)) {
    const labels = new Map<string, string>()
    const edges: Array<{ from: string; to: string; label: string }> = []
    const nodeLabel = (id: string, raw?: string) => {
      if (raw) labels.set(id, raw.replace(/^[\[({]+|[\])}]+$/g, '').trim())
      return labels.get(id) || id
    }
    for (const line of lines.slice(1)) {
      const edge = line.match(/^([\w.-]+)(\[[^\]]+\]|\([^)]*\)|\{[^}]*\})?\s*--(?:\|([^|]+)\|)?-?>\s*([\w.-]+)(\[[^\]]+\]|\([^)]*\)|\{[^}]*\})?$/)
      if (edge) {
        nodeLabel(edge[1], edge[2]); nodeLabel(edge[4], edge[5])
        edges.push({ from: edge[1], to: edge[4], label: edge[3]?.trim() || '' })
      } else {
        const node = line.match(/^([\w.-]+)(\[[^\]]+\]|\([^)]*\)|\{[^}]*\})$/)
        if (node) nodeLabel(node[1], node[2])
      }
    }
    if (edges.length) return `<div class="mermaid-flow">${edges.map(edge => `<div class="mermaid-edge"><span class="mermaid-node">${escapeHtml(nodeLabel(edge.from))}</span><span class="mermaid-arrow">${edge.label ? `<small>${escapeHtml(edge.label)}</small>` : ''}→</span><span class="mermaid-node">${escapeHtml(nodeLabel(edge.to))}</span></div>`).join('')}</div>`
  }
  if (first === 'sequencediagram') {
    const rows = lines.slice(1).flatMap(line => {
      const match = line.match(/^([\w.-]+)\s*-+>>?\s*([\w.-]+)\s*:\s*(.+)$/)
      return match ? [`<div class="mermaid-sequence-row"><strong>${escapeHtml(match[1])}</strong><span>→ ${escapeHtml(match[3])} →</span><strong>${escapeHtml(match[2])}</strong></div>`] : []
    })
    if (rows.length) return `<div class="mermaid-sequence">${rows.join('')}</div>`
  }
  return `<pre class="mermaid-source"><code>${escapeHtml(source)}</code></pre>`
}

function preprocessAdvancedMarkdown(markdown: string): string {
  const lines = markdown.split('\n')
  const output: string[] = []
  const footnotes = new Map<string, string>()
  let inFence = false
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (/^```/.test(line.trim())) inFence = !inFence
    if (!inFence) {
      const footnote = line.match(/^\[\^([^\]]+)\]:\s*(.*)$/)
      if (footnote) { footnotes.set(footnote[1], footnote[2]); continue }
      if (line.trim() === '$$') {
        const body: string[] = []
        index += 1
        while (index < lines.length && lines[index].trim() !== '$$') { body.push(lines[index]); index += 1 }
        const expression = body.join(' ')
        output.push(`<div class="math-block" data-math-source="${escapeHtml(`$$${body.join('\n')}$$`)}">${renderMathExpression(expression)}</div>`)
        continue
      }
      if (index + 1 < lines.length && /^:\s+/.test(lines[index + 1])) {
        const definitions: string[] = []
        while (index + 1 < lines.length && /^:\s+/.test(lines[index + 1])) { definitions.push(lines[index + 1].replace(/^:\s+/, '')); index += 1 }
        output.push(`<dl><dt>${escapeHtml(line)}</dt>${definitions.map(definition => `<dd>${escapeHtml(definition)}</dd>`).join('')}</dl>`)
        continue
      }
    }
    output.push(line)
  }
  let result = output.join('\n')
  if (footnotes.size) {
    result = result.replace(/\[\^([^\]]+)\]/g, (reference, id) => footnotes.has(id) ? `<sup class="footnote-ref"><a href="#footnote-${encodeURIComponent(id)}">${escapeHtml(id)}</a></sup>` : reference)
    result += `\n\n<section class="footnotes"><ol>${Array.from(footnotes, ([id, definition]) => `<li id="footnote-${encodeURIComponent(id)}">${escapeHtml(definition)}</li>`).join('')}</ol></section>`
  }
  return result
}

function enhanceRenderedHtml(html: string, includeAdvanced: boolean): string {
  const documentNode = new DOMParser().parseFromString(html, 'text/html')
  if (includeAdvanced) {
    documentNode.querySelectorAll('blockquote').forEach(blockquote => {
      const first = blockquote.querySelector('p')
      const match = first?.textContent?.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i)
      if (!first || !match) return
      const type = match[1].toLowerCase()
      first.textContent = (first.textContent || '').slice(match[0].length)
      blockquote.classList.add('callout', `callout-${type}`)
      const title = documentNode.createElement('div')
      title.className = 'callout-title'
      title.textContent = match[1].toUpperCase()
      blockquote.insertBefore(title, blockquote.firstChild)
    })
  }

  const walker = documentNode.createTreeWalker(documentNode.body, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    const parent = node.parentElement
    if (!parent || parent.closest('code, pre, a, .math-block, .mermaid-diagram')) continue
    if (/\[\[[^\]\n]+\]\]/.test(node.data) || (includeAdvanced && (/==[^=\n]+==/.test(node.data) || /\$[^$\n]+\$/.test(node.data)))) textNodes.push(node)
  }
  for (const node of textNodes) {
    const pattern = includeAdvanced ? /(\[\[([^\]\n]+)\]\]|==([^=\n]+)==|\$([^$\n]+)\$)/g : /(\[\[([^\]\n]+)\]\])/g
    const fragment = documentNode.createDocumentFragment()
    let cursor = 0
    for (const match of node.data.matchAll(pattern)) {
      const index = match.index || 0
      fragment.append(node.data.slice(cursor, index))
      if (match[2]) {
        const anchor = documentNode.createElement('a')
        anchor.className = 'wiki-link'
        anchor.href = `#wiki:${encodeURIComponent(match[2].trim())}`
        anchor.dataset.wikiTitle = match[2].trim()
        anchor.textContent = match[2].trim()
        fragment.append(anchor)
      } else if (match[3]) {
        const mark = documentNode.createElement('mark')
        mark.textContent = match[3]
        fragment.append(mark)
      } else if (match[4]) {
        const math = documentNode.createElement('span')
        math.className = 'math-inline'
        math.dataset.mathSource = `$${match[4]}$`
        math.innerHTML = renderMathExpression(match[4])
        fragment.append(math)
      }
      cursor = index + match[0].length
    }
    fragment.append(node.data.slice(cursor))
    node.replaceWith(fragment)
  }
  return documentNode.body.innerHTML
}

export function highlightCode(text: string, language: string): string {
  if (language && hljs.getLanguage(language)) {
    try {
      return hljs.highlight(text, { language }).value
    } catch {
      return escapeHtml(text)
    }
  }
  return escapeHtml(text)
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
  if (renderMode === 'preview' && language.toLowerCase() === 'mermaid') {
    return `<div class="mermaid-diagram" data-mermaid-source="${escapeHtml(text)}"><div class="mermaid-diagram-title">Mermaid</div>${renderMermaidPreview(text)}</div>`
  }
  const safeLang = escapeHtml(language)
  const highlighted = highlightCode(text, language)
  const langLabel = language && showCodeLang ? `<span class="code-lang-label" contenteditable="false">${safeLang}</span>` : ''
  const languageClass = safeLang ? ` language-${safeLang}` : ''
  return `<div class="code-block-wrapper"><pre data-lang="${safeLang}">${langLabel}<code data-lang="${safeLang}" class="hljs${languageClass}">${highlighted}</code></pre></div>`
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

export function renderMarkdown(markdown: string, showCodeLanguage = showCodeLang, mode: 'editable' | 'preview' = 'preview'): string {
  const previousShowCodeLang = showCodeLang
  const previousRenderMode = renderMode
  showCodeLang = showCodeLanguage
  renderMode = mode
  try {
    const source = mode === 'preview' ? preprocessAdvancedMarkdown(markdown) : markdown
    const result = marked.parse(source)
    const enhanced = enhanceRenderedHtml(typeof result === 'string' ? result : '', mode === 'preview')
    return sanitizeRenderedHtml(enhanced)
  } catch {
    return '<p>Error rendering markdown</p>'
  } finally {
    showCodeLang = previousShowCodeLang
    renderMode = previousRenderMode
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
