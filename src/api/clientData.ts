// ============================================
// Client Data API - /config/client_data
// 客户端设置云端同步
// ============================================
//
// 所有用户偏好设置（主题、音效、快捷键等）不再只存 localStorage，
// 而是通过此模块同步到服务端的 /config/client_data 端点。
//
// API 设计：
//   GET  /config/client_data?key=xxx  → 读取单条或全量
//   PUT  /config/client_data?key=xxx  → 写入单条或全量替换
//
// 详见 docs/ 中的 API 设计文档。

import { getApiBaseUrl, getAuthHeader } from './http'
import { formatPathForApi } from '../utils/directoryUtils'

// ============================================
// Types
// ============================================

export interface ClientDataResponse {
  [key: string]: string
}

// ============================================
// GET /config/client_data
// ============================================

/**
 * 获取客户端设置
 * @param key 可选，指定 key 时只返回该条记录
 * @param directory 当前工作目录
 */
export async function getClientData(key?: string, directory?: string): Promise<ClientDataResponse> {
  const baseUrl = getApiBaseUrl()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...getAuthHeader(),
  }

  const params = new URLSearchParams()
  if (key) params.set('key', key)
  const dir = formatPathForApi(directory)
  if (dir) params.set('directory', dir)

  const queryStr = params.toString()
  const url = `${baseUrl}/config/client_data${queryStr ? '?' + queryStr : ''}`

  console.log('[ClientData] GET', url)
  const response = await fetch(url, { headers })

  if (!response.ok) {
    throw new Error(`GET /config/client_data failed: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()
  console.log('[ClientData] GET 响应:', JSON.stringify(data).slice(0, 500))
  return data
}

// ============================================
// PUT /config/client_data
// ============================================

/**
 * 写入客户端设置
 * @param data 要写入的键值对
 * @param key 可选，指定 key 时只合并该条记录
 * @param directory 当前工作目录
 */
export async function putClientData(
  data: ClientDataResponse,
  key?: string,
  directory?: string,
): Promise<void> {
  const baseUrl = getApiBaseUrl()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...getAuthHeader(),
  }

  const params = new URLSearchParams()
  if (key) params.set('key', key)
  const dir = formatPathForApi(directory)
  if (dir) params.set('directory', dir)

  const queryStr = params.toString()
  const url = `${baseUrl}/config/client_data${queryStr ? '?' + queryStr : ''}`

  console.log('[ClientData] PUT', url, JSON.stringify(data))
  const response = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify(data),
  })

  if (!response.ok) {
    throw new Error(`PUT /config/client_data failed: ${response.status} ${response.statusText}`)
  }
  console.log('[ClientData] PUT 成功:', url)
}
