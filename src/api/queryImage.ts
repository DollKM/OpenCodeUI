import { API_BASE_URL } from '../constants/api'
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

export interface QueryImageParams {
  imageData: string
  provider: string
  model: string
  prompt: string
}

export interface QueryImageUsage {
  inputTokens: number
  outputTokens: number
}

export interface QueryImageResult {
  text: string
  usage?: QueryImageUsage
}

export async function queryImage(params: QueryImageParams): Promise<QueryImageResult> {
  // 直接连后端服务器，不走 Vite proxy（避免 proxy rewrite 吃掉 /api 前缀）
  // getActiveBaseUrl() 在 dev 模式下返回 /api（Vite proxy 前缀），不适用于此
  const server = serverStore.getActiveServer()
  const serverUrl = server?.url ?? API_BASE_URL
  const url = serverUrl + '/api/query-image'
  console.log(`[queryImage] serverUrl=${serverUrl}, url=${url}, provider=${params.provider}, model=${params.model}, prompt_length=${params.prompt.length}, imageData_length=${params.imageData.length}`)

  const body: Record<string, unknown> = {
    image_data: params.imageData,
    provider: params.provider,
    model: params.model,
    prompt: params.prompt,
  }

  const fetch = await getFetch()
  console.log(`[queryImage] POST ${url}`)
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...buildAuthHeaders(),
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '')
    console.error(`[queryImage] HTTP ${response.status}: ${errorBody}`)
    let message = `Query image failed: ${response.status}`
    try {
      const parsed = JSON.parse(errorBody)
      if (parsed?.error?.message) {
        message = parsed.error.message
      }
    } catch {
      if (errorBody) message += ' ' + errorBody
    }
    throw new Error(message)
  }

  console.log(`[queryImage] response status=${response.status}, starting to read SSE stream`)

  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''
  let usage: QueryImageUsage | undefined

  let chunkCount = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      console.log(`[queryImage] stream done, remaining buffer length=${buffer.length}, buffer_content=${buffer.slice(0, 500)}`)
      break
    }

    const decoded = decoder.decode(value, { stream: true })
    chunkCount++
    console.log(`[queryImage] chunk[${chunkCount}]: raw_length=${value.length}, decoded_length=${decoded.length}, content=${decoded.slice(0, 500)}`)

    buffer += decoded

    const blocks = buffer.split('\n\n')
    buffer = blocks.pop() ?? ''
    console.log(`[queryImage] blocks=${blocks.length}, buffer_remain=${buffer.length}`)

    for (const block of blocks) {
      console.log(`[queryImage] block: ${block.slice(0, 500)}`)
      for (const line of block.split('\n')) {
        if (!line.startsWith('data: ')) {
          if (line.trim()) console.log(`[queryImage] non-data line: ${line}`)
          continue
        }
        const raw = line.slice(6)

        console.log(`[queryImage] SSE data: ${raw.slice(0, 500)}`)

        if (raw === '[DONE]') continue

        try {
          const parsed = JSON.parse(raw)
          const eventType = parsed.type || parsed._tag
          console.log(`[queryImage] eventType=${eventType}, full object=`, JSON.stringify(parsed).slice(0, 500))

          if (eventType === 'text-delta' || eventType === 'TextDelta') {
            if (parsed.text) {
              fullText += parsed.text
            }
          } else if (eventType === 'finish' || eventType === 'Finish') {
            if (parsed.usage) {
              usage = {
                inputTokens: parsed.usage.inputTokens,
                outputTokens: parsed.usage.outputTokens,
              }
            }
          } else if (eventType === 'provider-error') {
            throw new Error(parsed.text || 'Provider error')
          }
        } catch (e) {
          if (e instanceof Error && e.message !== 'Provider error') {
            console.log(`[queryImage] parse error (skip):`, e.message)
            continue
          }
          throw e
        }
      }
    }
  }

  console.log(`[queryImage] done: text_length=${fullText.trim().length}, has_usage=${!!usage}`)
  return { text: fullText.trim(), usage }
}
