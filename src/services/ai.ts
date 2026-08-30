import { AIConnectionConfig, AIMessage, NoteDocument } from '../types'

export const DEFAULT_MODELS = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo']
const NON_COMPLETION_PATTERNS = /embedding|moderation|tts|whisper|dall-e|davinci|babbage|curie|ada|instruct|realtime|audio/i

// The main process rejects any AI request whose total UTF-8 size exceeds
// MAX_AI_MESSAGE_BYTES (100 KB) in electron/main.js. All renderer-side content
// budgets below are counted in UTF-8 bytes so CJK text cannot blow past the
// limit: 60k Chinese characters would be ~180 KB despite being only 60k chars.
const MAX_KNOWLEDGE_CONTEXT_BYTES = 80_000
const MAX_COMPLETION_CONTEXT_BYTES = 24_000
const MAX_SELECTION_BYTES = 48_000
const MAX_SUMMARY_BYTES = 48_000
const MAX_NOTE_CONTEXT_BYTES = 16_000
const MAX_USER_MESSAGE_BYTES = 12_000
const MAX_CHAT_HISTORY_BYTES = 48_000
const MAX_CHAT_HISTORY_MESSAGE_BYTES = 6_000
const MAX_CHAT_HISTORY_MESSAGES = 10
const MAX_INLINE_CONTEXT_BYTES = 8_000
const MAX_KNOWLEDGE_QUESTION_BYTES = 8_000

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder('utf-8')

export function utf8ByteLength(text: string): number {
  return textEncoder.encode(text).length
}

export function truncateToUtf8Bytes(text: string, maxBytes: number): string {
  const bytes = textEncoder.encode(text)
  if (bytes.length <= maxBytes) return text
  // Walk back to a UTF-8 lead byte so the cut never splits a sequence.
  let cut = Math.max(0, maxBytes)
  while (cut > 0 && (bytes[cut] & 0xc0) === 0x80) cut -= 1
  return textDecoder.decode(bytes.subarray(0, cut))
}

const PROVIDER_SUGGESTIONS: Record<string, string[]> = {
  'openai.com': ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo', 'o1', 'o3-mini'],
  'deepseek.com': ['deepseek-chat', 'deepseek-reasoner', 'deepseek-v3', 'deepseek-r1'],
  'dashscope.aliyuncs.com': ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen-long', 'qwen2.5-72b-instruct'],
  'api.moonshot.cn': ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
  'api.groq.com': ['llama-3.1-70b', 'llama-3.1-8b', 'mixtral-8x7b', 'gemma2-9b'],
  'api.together.xyz': ['mistralai/Mixtral-8x7B-Instruct-v0.1', 'meta-llama/Llama-3-70b-chat-hf'],
  'api.perplexity.ai': ['sonar-pro', 'sonar', 'mixtral-8x7b-instruct'],
  'openrouter.ai': ['openai/gpt-4o', 'openai/gpt-4o-mini', 'anthropic/claude-3.5-sonnet', 'google/gemini-pro'],
  localhost: ['llama3', 'mistral', 'codellama', 'phi3', 'qwen2.5'],
  '127.0.0.1': ['llama3', 'mistral', 'codellama', 'phi3', 'qwen2.5'],
}

function getProviderKey(url: string): string | null {
  try {
    const parsed = new URL(url)
    return Object.keys(PROVIDER_SUGGESTIONS).find(key => parsed.hostname.includes(key) || parsed.host === key) || null
  } catch {
    return null
  }
}

export function getDefaultModelsForProvider(apiUrl: string): string[] {
  const key = getProviderKey(apiUrl)
  if (key) return PROVIDER_SUGGESTIONS[key]
  return ['gpt-4o-mini', 'gpt-4o', 'qwen-plus', 'qwen-max', 'deepseek-chat', 'moonshot-v1-8k']
}

let connection: AIConnectionConfig = {
  configured: false,
  apiUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  credentialStorage: 'session',
  credentialPersisted: false,
}

const SYSTEM_PROMPT = `You are EasyMark AI, an assistant inside a Markdown note-taking app.
Follow these response rules:
1. Reply in the same language as the user's latest request unless they ask for another language.
2. Be concise, concrete, and factual. Do not add greetings, praise, filler, or generic closing remarks.
3. Use valid GitHub Flavored Markdown when structure helps. Never wrap the whole response in a code fence.
4. Do not emit unsafe HTML, scripts, style tags, or event-handler attributes.
5. Preserve the user's meaning and Markdown structure unless they explicitly request a rewrite.
6. Do not claim actions were performed when they were not.`

const COMPLETION_PROMPT = `Continue the Markdown text below at the exact point where it ends.
Output contract:
- Return only the continuation to insert, with no label, explanation, quotation marks, or concluding sentence.
- Match the language, tone, tense, list indentation, heading level, and Markdown syntax already in use.
- Do not repeat the supplied ending.
- Do not start a new summary or conclusion unless the existing text clearly requires one.
- Keep the continuation to one short paragraph or one logical Markdown item.

Text to continue:
`

const INLINE_COMPLETION_PROMPT = `You generate ghost-text for an inline Markdown editor.
Your entire response is inserted at the cursor, so obey this output contract exactly:
- Return only the missing continuation. No preface, label, explanation, summary, conclusion, or quotation marks.
- Never output phrases such as "建议", "总结", "总之", "综上", "Here is", "Suggestion", or "Completion".
- Return exactly one line. Never output a Markdown code fence.
- For prose, return at most 8 Chinese characters or at most 5 words.
- For code, complete only the current line and return at most 80 characters.
- Match the surrounding language, spacing, punctuation, Markdown syntax, and code style.
- Do not repeat text that already appears before the cursor.
- If no confident short continuation exists, return an empty response.`

const SUGGESTION_PROMPT = `Review the selected Markdown and suggest specific improvements.
Output contract:
- Return valid GitHub Flavored Markdown that can be rendered directly.
- Start immediately with a short heading such as "### 建议" or its equivalent in the input language.
- Use concise bullet points. Each point must identify a concrete issue and an actionable change.
- When a rewrite is useful, add a "### 修改示例" heading (or equivalent) and place the revised text below it as normal Markdown so it renders as content.
- Use a fenced code block only when the selected text is source code. Do not fence ordinary Markdown examples or the entire response.
- Do not add greetings, praise, disclaimers, a recap, "总结", "总之", or any closing sentence.
- Preserve facts and intent; do not invent missing information.`

const INLINE_META_PREFIX = /^(?:(?:续写|补全|建议|答案|输出|结果|completion|suggestion|answer|output|continue|here(?:'s| is))\s*[:：-]\s*)+/i
const INLINE_META_STATEMENT = /^(?:总之|综上(?:所述)?|总结(?:来说)?|以上(?:就是|是)|希望(?:这些|这能|以上)|(?:here(?:'s| is)|in summary|overall|to summarize)\b)/i

export function sanitizeInlineCompletion(raw: string, textBeforeCursor = ''): string {
  if (!raw || /```/.test(raw)) return ''
  let value = raw.replace(/\r/g, '').trim()
  if (!value || value.includes('\n')) return ''
  value = value.replace(INLINE_META_PREFIX, '').trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1).trim()
  }
  if (!value || value.length > 80 || INLINE_META_STATEMENT.test(value)) return ''
  if (/^(?:#{1,6}|[-*+]|>)\s/.test(value)) return ''
  const inCodeFence = (textBeforeCursor.match(/```/g)?.length || 0) % 2 === 1
  if (!inCodeFence) {
    const chineseCharacterCount = value.match(/[\u3400-\u9fff]/g)?.length || 0
    if (chineseCharacterCount > 8) return ''
    if (!chineseCharacterCount && value.split(/\s+/).filter(Boolean).length > 5) return ''
  }
  if (/[A-Za-z0-9]$/.test(textBeforeCursor) && /^[A-Za-z0-9]/.test(value)) value = ` ${value}`
  return value
}

export async function initializeAI(): Promise<AIConnectionConfig> {
  connection = await window.electronAPI.getAIConfig()
  return connection
}

export async function configureAI(apiKey: string | undefined, baseURL: string, model: string): Promise<AIConnectionConfig> {
  connection = await window.electronAPI.configureAI({
    apiKey: apiKey?.trim() || undefined,
    apiUrl: baseURL,
    model,
  })
  return connection
}

export async function clearAIKey(): Promise<AIConnectionConfig> {
  connection = await window.electronAPI.clearAIKey()
  return connection
}

export function setModel(model: string) {
  connection = { ...connection, model }
}

export function getModel(): string {
  return connection.model
}

export function isConfigured(): boolean {
  return connection.configured
}

export async function fetchModels(config?: { apiKey?: string; apiUrl?: string }): Promise<string[]> {
  if (!config?.apiKey?.trim() && !connection.configured) throw new Error('AI not configured')
  const models = (await window.electronAPI.listAIModels({
    apiKey: config?.apiKey?.trim() || undefined,
    apiUrl: config?.apiUrl,
  }))
    .filter(id => !NON_COMPLETION_PATTERNS.test(id))
    .sort()
  return models.length > 0 ? models : getDefaultModelsForProvider(config?.apiUrl || connection.apiUrl)
}

async function callAI(messages: AIMessage[], maxTokens = 200, temperature = 0.7): Promise<string> {
  if (!connection.configured) throw new Error('AI not configured')
  return window.electronAPI.chatWithAI(messages, { maxTokens, temperature })
}

export async function getCompletion(text: string, context?: string): Promise<string> {
  const messages: AIMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }]
  messages.push({
    role: 'user',
    content: context
      ? `Here is the current note content:\n\n${truncateToUtf8Bytes(context, MAX_COMPLETION_CONTEXT_BYTES)}\n\n---\n\n${COMPLETION_PROMPT}${truncateToUtf8Bytes(text, MAX_USER_MESSAGE_BYTES)}`
      : `${COMPLETION_PROMPT}${truncateToUtf8Bytes(text, MAX_USER_MESSAGE_BYTES)}`,
  })
  return callAI(messages, 150, 0.7)
}

export async function getInlineCompletion(textBeforeCursor: string): Promise<string> {
  if (!connection.configured) return ''
  try {
    const response = await callAI([
      { role: 'system', content: INLINE_COMPLETION_PROMPT },
      { role: 'user', content: `Text before cursor:\n<content>\n${truncateToUtf8Bytes(textBeforeCursor, MAX_INLINE_CONTEXT_BYTES)}\n</content>` },
    ], 30, 0.4)
    return sanitizeInlineCompletion(response, textBeforeCursor)
  } catch {
    return ''
  }
}

export async function getSuggestion(text: string): Promise<string> {
  return callAI([
    { role: 'system', content: `${SYSTEM_PROMPT}\n\n${SUGGESTION_PROMPT}` },
    { role: 'user', content: `Selected Markdown:\n<content>\n${truncateToUtf8Bytes(text, MAX_SELECTION_BYTES)}\n</content>` },
  ], 350, 0.35)
}

export type AITransformAction = 'polish' | 'translate-zh' | 'translate-en' | 'shorten' | 'expand' | 'summarize' | 'to-list' | 'to-table'

const TRANSFORM_INSTRUCTIONS: Record<AITransformAction, string> = {
  polish: 'Polish the text for clarity and correctness while preserving its language, facts, tone, and Markdown structure.',
  'translate-zh': 'Translate the text into natural Simplified Chinese. Preserve Markdown structure and return only the translation.',
  'translate-en': 'Translate the text into natural English. Preserve Markdown structure and return only the translation.',
  shorten: 'Make the text substantially shorter without losing important facts. Preserve useful Markdown.',
  expand: 'Expand the text with concrete detail that follows directly from the existing content. Do not invent facts.',
  summarize: 'Summarize the text concisely in the same language. Return only the summary.',
  'to-list': 'Convert the text into a concise Markdown bullet list. Return only the list.',
  'to-table': 'Convert the text into a valid GitHub Flavored Markdown table. Return only the table.',
}

export async function transformSelection(text: string, action: AITransformAction): Promise<string> {
  if (!text.trim()) return ''
  return callAI([
    { role: 'system', content: `${SYSTEM_PROMPT}\n\nYour response replaces selected editor text. Return only the replacement Markdown: no heading, label, commentary, quotation wrapper, or closing sentence.` },
    { role: 'user', content: `${TRANSFORM_INSTRUCTIONS[action]}\n\n<selected-markdown>\n${truncateToUtf8Bytes(text, MAX_SELECTION_BYTES)}\n</selected-markdown>` },
  ], action === 'expand' ? 700 : 450, 0.25)
}

function knowledgeContext(documents: NoteDocument[], maxBytes = MAX_KNOWLEDGE_CONTEXT_BYTES): string {
  // Reserve a small overhead per section for the <note> wrapper and joiners so
  // the assembled context never exceeds maxBytes even when titles are long.
  const SECTION_OVERHEAD_BYTES = 256
  const PER_NOTE_MAX_BYTES = 20_000
  let used = 0
  const sections: string[] = []
  for (const document of documents) {
    const remaining = maxBytes - used
    if (remaining <= SECTION_OVERHEAD_BYTES) break
    const content = truncateToUtf8Bytes(document.content, Math.min(PER_NOTE_MAX_BYTES, remaining - SECTION_OVERHEAD_BYTES))
    sections.push(`<note title="${document.title.replace(/["<>]/g, '')}">\n${content}\n</note>`)
    used += utf8ByteLength(content) + SECTION_OVERHEAD_BYTES
  }
  return sections.join('\n\n')
}

export async function askKnowledgeBase(question: string, documents: NoteDocument[]): Promise<string> {
  return callAI([
    { role: 'system', content: `${SYSTEM_PROMPT}\nAnswer only from the supplied notes. Cite supporting notes using [[Note Title]] after each relevant claim. If the notes do not contain the answer, say so directly. Do not invent sources.` },
    { role: 'user', content: `Question: ${truncateToUtf8Bytes(question, MAX_KNOWLEDGE_QUESTION_BYTES)}\n\nNotes:\n${knowledgeContext(documents)}` },
  ], 800, 0.2)
}

function localSemanticScore(query: string, document: NoteDocument): number {
  const normalized = query.toLocaleLowerCase().trim()
  const haystack = `${document.title}\n${document.content}`.toLocaleLowerCase()
  const terms = normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  const bigrams = Array.from({ length: Math.max(0, normalized.length - 1) }, (_, index) => normalized.slice(index, index + 2)).filter(value => value.trim().length === 2)
  let score = document.title.toLocaleLowerCase().includes(normalized) ? 20 : 0
  for (const term of terms) {
    if (document.title.toLocaleLowerCase().includes(term)) score += 8
    const matches = haystack.split(term).length - 1
    score += Math.min(matches, 8) * 2
  }
  for (const bigram of bigrams) if (haystack.includes(bigram)) score += 0.25
  return score
}

export async function semanticSearchNotes(query: string, documents: NoteDocument[]): Promise<Array<NoteDocument & { score: number }>> {
  return documents
    .map(document => ({ ...document, score: localSemanticScore(query, document) }))
    .filter(document => document.score > 0)
    .sort((a, b) => b.score - a.score || b.lastModified - a.lastModified)
    .slice(0, 20)
}

export async function chatWithAI(
  message: string,
  noteContent?: string,
  history?: { role: 'user' | 'assistant'; content: string }[],
): Promise<string> {
  const messages: AIMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }]
  if (noteContent) messages.push({ role: 'user', content: `Current note:\n\n${truncateToUtf8Bytes(noteContent, MAX_NOTE_CONTEXT_BYTES)}` })
  if (history?.length) {
    const clipped = history
      .slice(-MAX_CHAT_HISTORY_MESSAGES)
      .map(entry => ({ role: entry.role, content: truncateToUtf8Bytes(entry.content, MAX_CHAT_HISTORY_MESSAGE_BYTES) }))
    // Keep the newest turns that fit the total history budget.
    const kept: typeof clipped = []
    let historyBytes = 0
    for (let index = clipped.length - 1; index >= 0; index -= 1) {
      const entryBytes = utf8ByteLength(clipped[index].content)
      if (historyBytes + entryBytes > MAX_CHAT_HISTORY_BYTES) break
      historyBytes += entryBytes
      kept.unshift(clipped[index])
    }
    messages.push(...kept)
  }
  messages.push({ role: 'user', content: truncateToUtf8Bytes(message, MAX_USER_MESSAGE_BYTES) })
  return callAI(messages, 500, 0.7)
}

export async function getSummary(text: string): Promise<string> {
  return callAI([
    { role: 'system', content: 'Summarize the following text in 1-2 sentences. Be concise and factual. Respond in the same language as the text.' },
    { role: 'user', content: truncateToUtf8Bytes(text, MAX_SUMMARY_BYTES) },
  ], 200, 0.3)
}
