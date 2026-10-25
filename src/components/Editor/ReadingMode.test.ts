// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { estimateReadingTime } from './ReadingMode'

describe('estimateReadingTime', () => {
  it('counts CJK characters instead of space-delimited words', () => {
    // A long Chinese note has no spaces; word-splitting alone reported 1 min.
    const chinese = '这是一段很长的中文笔记。'.repeat(200)
    expect(estimateReadingTime(chinese)).toBeGreaterThanOrEqual(5)
    expect(estimateReadingTime(chinese)).toBeLessThanOrEqual(10)
  })

  it('keeps space-delimited word counting for Latin text', () => {
    expect(estimateReadingTime('word '.repeat(400))).toBe(2)
    expect(estimateReadingTime('short text')).toBe(1)
  })

  it('handles mixed CJK and Latin content', () => {
    const mixed = '中文内容。'.repeat(150) + ' plus some latin words'
    expect(estimateReadingTime(mixed)).toBeGreaterThanOrEqual(2)
  })

  it('never reports less than one minute', () => {
    expect(estimateReadingTime('')).toBe(1)
  })
})
