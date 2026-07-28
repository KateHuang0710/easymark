// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { normalizeMarkdownAssetUrl, renderMarkdown } from './markdown'

describe('renderMarkdown security', () => {
  it('removes scripts and event-handler attributes', () => {
    const html = renderMarkdown('<script>alert(1)</script><img src="https://example.com/a.png" onerror="alert(2)">')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('onerror')
  })

  it('blocks executable links and hardens external links', () => {
    const blocked = renderMarkdown('[bad](javascript:alert(1))')
    expect(blocked).not.toContain('javascript:')

    const safe = renderMarkdown('[safe](https://example.com)')
    expect(safe).toContain('target="_blank"')
    expect(safe).toContain('rel="noopener noreferrer"')
  })

  it('rewrites generated local assets to the protected protocol', () => {
    expect(normalizeMarkdownAssetUrl('assets/image-1.png')).toBe('easymark-asset://local/image-1.png')
    expect(renderMarkdown('![image](assets/image-1.png)')).toContain('easymark-asset://local/image-1.png')
    expect(normalizeMarkdownAssetUrl('assets/../secret.png')).toBe('assets/../secret.png')
  })

  it('keeps the rendered language label non-editable', () => {
    const html = renderMarkdown('```python\nprint(1)\n```')
    const doc = new DOMParser().parseFromString(html, 'text/html')
    expect(doc.querySelector('.code-lang-label')?.getAttribute('contenteditable')).toBe('false')
  })

  it('hides language labels without losing code language metadata', () => {
    const html = renderMarkdown('```typescript\nconst value = 1\n```', false)
    expect(html).not.toContain('code-lang-label')
    expect(html).toContain('data-lang="typescript"')
    expect(html).toContain('<code data-lang="typescript"')
    expect(html).toContain('language-typescript')
  })

  it('renders extended Markdown safely in preview mode', () => {
    const html = renderMarkdown(`> [!NOTE] Important\n\nTerm\n: Definition\n\n==marked== and $x^2$ with [[Other Note]]\n\n[^a]\n\n[^a]: Footnote`)
    expect(html).toContain('callout-note')
    expect(html).toContain('<dl>')
    expect(html).toContain('<mark>marked</mark>')
    expect(html).toContain('class="math-inline"')
    expect(html).toContain('data-wiki-title="Other Note"')
    expect(html).toContain('class="footnotes"')
    expect(html).not.toContain('<script')
  })

  it('renders flowchart and sequence Mermaid blocks without executable SVG', () => {
    const flow = renderMarkdown('```mermaid\nflowchart TD\nA[Start] --> B[Done]\n```')
    expect(flow).toContain('mermaid-diagram')
    expect(flow).toContain('Start')
    expect(flow).toContain('Done')
    expect(flow).not.toContain('<svg')

    const editable = renderMarkdown('```mermaid\nflowchart TD\nA --> B\n```', true, 'editable')
    expect(editable).toContain('<pre')
    expect(editable).toContain('data-lang="mermaid"')
  })
})
