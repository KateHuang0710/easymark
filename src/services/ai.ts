import { AIConnectionConfig, AIMessage } from '../types'

export const DEFAULT_MODELS = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo']
const NON_COMPLETION_PATTERNS = /embedding|moderation|tts|whisper|dall-e|davinci|babbage|curie|ada|instruct|realtime|audio/i

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
      ? `Here is the current note content:\n\n${context}\n\n---\n\n${COMPLETION_PROMPT}${text}`
      : `${COMPLETION_PROMPT}${text}`,
  })
  return callAI(messages, 150, 0.7)
}

export async function getInlineCompletion(textBeforeCursor: string): Promise<string> {
  if (!connection.configured) return ''
  try {
    const response = await callAI([
      { role: 'system', content: INLINE_COMPLETION_PROMPT },
      { role: 'user', content: `Text before cursor:\n<content>\n${textBeforeCursor}\n</content>` },
    ], 30, 0.4)
    return sanitizeInlineCompletion(response, textBeforeCursor)
  } catch {
    return ''
  }
}

export async function getSuggestion(text: string): Promise<string> {
  return callAI([
    { role: 'system', content: `${SYSTEM_PROMPT}\n\n${SUGGESTION_PROMPT}` },
    { role: 'user', content: `Selected Markdown:\n<content>\n${text}\n</content>` },
  ], 350, 0.35)
}

export async function chatWithAI(
  message: string,
  noteContent?: string,
  history?: { role: 'user' | 'assistant'; content: string }[],
): Promise<string> {
  const messages: AIMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }]
  if (noteContent) messages.push({ role: 'user', content: `Current note:\n\n${noteContent}` })
  if (history?.length) messages.push(...history.slice(-10))
  messages.push({ role: 'user', content: message })
  return callAI(messages, 500, 0.7)
}

export async function getSummary(text: string): Promise<string> {
  return callAI([
    { role: 'system', content: 'Summarize the following text in 1-2 sentences. Be concise and factual. Respond in the same language as the text.' },
    { role: 'user', content: text },
  ], 200, 0.3)
}
