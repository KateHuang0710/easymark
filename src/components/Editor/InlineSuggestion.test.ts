import { describe, expect, it } from 'vitest'
import { hasEnoughInlineCompletionContext } from './InlineSuggestion'

describe('hasEnoughInlineCompletionContext', () => {
  it('allows Chinese prose without requiring whitespace-separated words', () => {
    expect(hasEnoughInlineCompletionContext('这是中文')).toBe(true)
    expect(hasEnoughInlineCompletionContext('中文')).toBe(false)
  })

  it('keeps the existing short-context guard for prose and code', () => {
    expect(hasEnoughInlineCompletionContext('one two three')).toBe(true)
    expect(hasEnoughInlineCompletionContext('one two')).toBe(false)
    expect(hasEnoughInlineCompletionContext('```ts\nabc')).toBe(true)
    expect(hasEnoughInlineCompletionContext('```ts\nab')).toBe(false)
  })
})
