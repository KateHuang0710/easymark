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
})
