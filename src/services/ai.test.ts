import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchModels, sanitizeInlineCompletion } from './ai'

describe('sanitizeInlineCompletion', () => {
  it('keeps a short single-line continuation', () => {
    expect(sanitizeInlineCompletion('提高可读性')).toBe('提高可读性')
    expect(sanitizeInlineCompletion('the current section')).toBe('the current section')
    expect(sanitizeInlineCompletion('next step', 'the')).toBe(' next step')
  })

  it('removes a simple response label', () => {
    expect(sanitizeInlineCompletion('补全：提高可读性')).toBe('提高可读性')
    expect(sanitizeInlineCompletion('Completion: the next step')).toBe('the next step')
  })

  it('rejects summaries, multiple lines, fences, and oversized output', () => {
    expect(sanitizeInlineCompletion('总之，这就是最终结果。')).toBe('')
    expect(sanitizeInlineCompletion('first\nsecond')).toBe('')
    expect(sanitizeInlineCompletion('```ts\nconst value = 1\n```')).toBe('')
    expect(sanitizeInlineCompletion('x'.repeat(81))).toBe('')
    expect(sanitizeInlineCompletion('one two three four five six')).toBe('')
    expect(sanitizeInlineCompletion('这是超过八个汉字的内联补全')).toBe('')
    expect(sanitizeInlineCompletion('const value = createSomethingLong()', '```ts\n')).toBe('const value = createSomethingLong()')
  })
})


afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchModels', () => {
  it('uses draft credentials without persisting the AI connection', async () => {
    const listAIModels = vi.fn().mockResolvedValue(['text-embedding-3-small', 'z-model', 'a-model'])
    vi.stubGlobal('window', { electronAPI: { listAIModels } })

    await expect(fetchModels({ apiKey: '  draft-key  ', apiUrl: 'https://example.com/v1' }))
      .resolves.toEqual(['a-model', 'z-model'])
    expect(listAIModels).toHaveBeenCalledWith({
      apiKey: 'draft-key',
      apiUrl: 'https://example.com/v1',
    })
  })

  it('uses the draft provider for fallback suggestions', async () => {
    const listAIModels = vi.fn().mockResolvedValue([])
    vi.stubGlobal('window', { electronAPI: { listAIModels } })

    const models = await fetchModels({ apiKey: 'draft-key', apiUrl: 'https://api.deepseek.com/v1' })
    expect(models).toContain('deepseek-chat')
  })
})
