import { serverStore } from '../store/serverStore'
import { isTauri } from '../utils/tauri'

function buildAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {}
  const auth = serverStore.getActiveAuth()
  if (auth?.password) {
    headers['Authorization'] = 'Basic ' + btoa(auth.username + ':' + auth.password)
  }
  return headers
}

async function getFetch(): Promise<typeof globalThis.fetch> {
  if (isTauri()) {
    return import('@tauri-apps/plugin-http').then(mod => mod.fetch as typeof fetch)
  }
  return globalThis.fetch
}

interface DirectChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string | Array<Record<string, unknown>>
}

interface DirectChatParams {
  model: string
  messages: DirectChatMessage[]
  system?: string
  temperature?: number
  maxTokens?: number
}

export async function directChat(params: DirectChatParams): Promise<string> {
  const baseUrl = serverStore.getActiveBaseUrl()

  const messages = params.system
    ? [{ role: 'system' as const, content: params.system }, ...params.messages]
    : params.messages

  const body: Record<string, unknown> = {
    model: params.model,
    messages,
    stream: true,
    temperature: params.temperature ?? 0.7,
    max_tokens: params.maxTokens ?? 4096,
  }

  const fetch = await getFetch()
  const response = await fetch(baseUrl + '/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...buildAuthHeaders(),
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error('Chat request failed: ' + response.status + ' ' + errorText)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6)
        if (data === '[DONE]') continue

        try {
          const parsed = JSON.parse(data)
          const delta = parsed.choices?.[0]?.delta
          if (delta?.content) {
            fullText += delta.content
          }
        } catch {
          // skip malformed JSON lines
        }
      }
    }
  }

  return fullText.trim()
}
