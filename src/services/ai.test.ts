import { describe, expect, it } from 'vitest'
import { sanitizeInlineCompletion } from './ai'

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
