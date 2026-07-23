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

const SYSTEM_PROMPT = `You are EasyMark AI, an assistant integrated into a Markdown note-taking app.
Help users write better Markdown notes. Follow these rules:
1. Provide concise, useful suggestions
2. Use Markdown formatting in your responses when appropriate
3. When completing a sentence, continue naturally from where the user left off
4. Keep suggestions brief - no more than 2-3 sentences unless asked
5. Do not be overly enthusiastic or use emojis excessively
6. Focus on clarity and substance
7. If the user asks about the note content, analyze and summarize accurately
8. When suggesting improvements, explain briefly why`

const COMPLETION_PROMPT = `Complete the following Markdown text naturally. Continue the thought, matching the style and context.
Only return the continuation without any prefix or explanation.\n\n`

const INLINE_COMPLETION_PROMPT = `You are an inline Markdown completion assistant. The user is typing and needs a short continuation.
Rules:
- Only return 1-3 words as a natural continuation (unless completing a code block)
- Match the style and context of the text
- Do NOT return explanations or prefixes
- For code blocks, you may complete the line of code
- Keep it brief and relevant\n\n`

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

export async function fetchModels(): Promise<string[]> {
  if (!connection.configured) throw new Error('AI not configured')
  const models = (await window.electronAPI.listAIModels())
    .filter(id => !NON_COMPLETION_PATTERNS.test(id))
    .sort()
  return models.length > 0 ? models : getDefaultModelsForProvider(connection.apiUrl)
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
    return await callAI([
      { role: 'system', content: INLINE_COMPLETION_PROMPT },
      { role: 'user', content: textBeforeCursor },
    ], 30, 0.4)
  } catch {
    return ''
  }
}

export async function getSuggestion(text: string): Promise<string> {
  return callAI([
    { role: 'system', content: SYSTEM_PROMPT + '\n\nProvide a brief suggestion for improvement of the selected text.' },
    { role: 'user', content: `Suggest improvements for this text:\n\n${text}` },
  ], 200, 0.5)
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
