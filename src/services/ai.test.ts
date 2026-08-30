import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AIMessage } from '../types'
import { askKnowledgeBase, chatWithAI, fetchModels, initializeAI, sanitizeInlineCompletion, truncateToUtf8Bytes, utf8ByteLength } from './ai'

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

// Must match MAX_AI_MESSAGE_BYTES in electron/main.js, which rejects larger requests.
const MAIN_PROCESS_LIMIT_BYTES = 100 * 1024

function totalRequestBytes(messages: AIMessage[]): number {
  return messages.reduce((total, message) => total + utf8ByteLength(message.content), 0)
}

describe('truncateToUtf8Bytes', () => {
  it('leaves short text untouched', () => {
    expect(truncateToUtf8Bytes('hello', 10)).toBe('hello')
    expect(truncateToUtf8Bytes('hello', 5)).toBe('hello')
  })

  it('counts bytes, not characters, for CJK text', () => {
    const text = '中'.repeat(10)
    expect(utf8ByteLength(text)).toBe(30)
    const truncated = truncateToUtf8Bytes(text, 9)
    expect(utf8ByteLength(truncated)).toBeLessThanOrEqual(9)
    expect(truncated).toBe('中'.repeat(3))
  })

  it('never splits a multi-byte sequence at the cut point', () => {
    const text = 'a中b文c'
    for (let bytes = 0; bytes <= utf8ByteLength(text); bytes += 1) {
      const truncated = truncateToUtf8Bytes(text, bytes)
      expect(utf8ByteLength(truncated)).toBeLessThanOrEqual(bytes)
      expect(text.startsWith(truncated)).toBe(true)
    }
  })
})

describe('AI request byte budgets', () => {
  let chatCalls: AIMessage[][]

  beforeEach(() => {
    chatCalls = []
    const electronAPI = {
      getAIConfig: vi.fn(async () => ({
        configured: true,
        apiUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        credentialStorage: 'secure',
        credentialPersisted: true,
      })),
      chatWithAI: vi.fn(async (messages: AIMessage[]) => {
        chatCalls.push(messages)
        return 'ok'
      }),
    }
    vi.stubGlobal('window', { electronAPI })
  })

  it('keeps knowledge-base Q&A under the main-process limit for CJK notes', async () => {
    await initializeAI()
    const documents = Array.from({ length: 30 }, (_, index) => ({
      id: `doc-${index}`,
      filename: `note-${index}.md`,
      title: `笔记 ${index}`,
      content: '这是一段很长的中文笔记内容。'.repeat(300),
      lastModified: Date.now(),
    }))

    await askKnowledgeBase('这些笔记讲了什么？', documents)

    expect(chatCalls).toHaveLength(1)
    expect(totalRequestBytes(chatCalls[0])).toBeLessThanOrEqual(MAIN_PROCESS_LIMIT_BYTES)
    // The context must not collapse to nothing: several notes still fit.
    expect(chatCalls[0][1].content).toContain('<note title=')
  })

  it('keeps chat history within the budget and prefers the newest turns', async () => {
    await initializeAI()
    const history = Array.from({ length: 20 }, () => ({
      role: 'user' as const,
      content: '很长的中文聊天记录'.repeat(200),
    }))

    await chatWithAI('继续', '很长的中文笔记'.repeat(2000), history)

    expect(chatCalls).toHaveLength(1)
    expect(totalRequestBytes(chatCalls[0])).toBeLessThanOrEqual(MAIN_PROCESS_LIMIT_BYTES)
    const historyMessages = chatCalls[0].slice(2, -1)
    expect(historyMessages.length).toBeGreaterThan(0)
    expect(historyMessages.length).toBeLessThanOrEqual(10)
  })
})
