// ============================================
// Session API Functions
// 基于 @opencode-ai/sdk: /session 相关接口
// ============================================

import { getSDKClient, unwrap } from './sdk'
import { normalizeTodoItems } from './todo'
import { formatPathForApi } from '../utils/directoryUtils'
import type { ApiSession, SessionListParams } from './types'
import type { SessionStatusMap } from '../types/api/session'
import type { TodoItem } from '../types/api/event'

// ============================================
// Session Status
// ============================================

export async function getSessionStatus(directory?: string): Promise<SessionStatusMap> {
  const sdk = getSDKClient()
  return unwrap(await sdk.session.status({ directory: formatPathForApi(directory) }))
}

// ============================================
// Session CRUD
// ============================================

/**
 * 获取 session 列表
 */
export async function getSessions(params: SessionListParams = {}): Promise<ApiSession[]> {
  const sdk = getSDKClient()
  const { directory, roots, start, search, limit } = params
  return unwrap(
    await sdk.session.list({
      directory: formatPathForApi(directory),
      roots,
      start,
      search,
      limit,
    }),
  )
}

/**
 * 获取单个 session
 */
export async function getSession(sessionId: string, directory?: string): Promise<ApiSession> {
  const sdk = getSDKClient()
  return unwrap(await sdk.session.get({ sessionID: sessionId, directory: formatPathForApi(directory) }))
}

/**
 * 创建 session
 */
export async function createSession(
  params: {
    directory?: string
    title?: string
    parentID?: string
  } = {},
): Promise<ApiSession> {
  const sdk = getSDKClient()
  const { directory, title, parentID } = params
  return unwrap(
    await sdk.session.create({
      directory: formatPathForApi(directory),
      title,
      parentID,
    }),
  )
}

/**
 * 更新 session
 */
export async function updateSession(
  sessionId: string,
  params: { title?: string; time?: { archived?: number } },
  directory?: string,
): Promise<ApiSession> {
  const sdk = getSDKClient()
  return unwrap(
    await sdk.session.update({
      sessionID: sessionId,
      directory: formatPathForApi(directory),
      ...params,
    }),
  )
}

/**
 * 删除 session
 */
export async function deleteSession(sessionId: string, directory?: string): Promise<boolean> {
  const sdk = getSDKClient()
  unwrap(await sdk.session.delete({ sessionID: sessionId, directory: formatPathForApi(directory) }))
  return true
}

// ============================================
// Session Actions
// ============================================

/**
 * 中止 session
 */
export async function abortSession(sessionId: string, directory?: string): Promise<boolean> {
  const sdk = getSDKClient()
  unwrap(await sdk.session.abort({ sessionID: sessionId, directory: formatPathForApi(directory) }))
  return true
}

/**
 * 回退消息
 */
export async function revertMessage(
  sessionId: string,
  messageId: string,
  partId?: string,
  directory?: string,
): Promise<ApiSession> {
  const sdk = getSDKClient()
  return unwrap(
    await sdk.session.revert({
      sessionID: sessionId,
      directory: formatPathForApi(directory),
      messageID: messageId,
      partID: partId,
    }),
  )
}

/**
 * 恢复已回退的消息
 */
export async function unrevertSession(sessionId: string, directory?: string): Promise<ApiSession> {
  const sdk = getSDKClient()
  return unwrap(await sdk.session.unrevert({ sessionID: sessionId, directory: formatPathForApi(directory) }))
}

/**
 * 分享 session
 */
export async function shareSession(sessionId: string, directory?: string): Promise<ApiSession> {
  const sdk = getSDKClient()
  return unwrap(await sdk.session.share({ sessionID: sessionId, directory: formatPathForApi(directory) }))
}

/**
 * 取消分享 session
 */
export async function unshareSession(sessionId: string, directory?: string): Promise<ApiSession> {
  const sdk = getSDKClient()
  return unwrap(await sdk.session.unshare({ sessionID: sessionId, directory: formatPathForApi(directory) }))
}

/**
 * Fork session
 */
export async function forkSession(sessionId: string, messageId?: string, directory?: string): Promise<ApiSession> {
  const sdk = getSDKClient()
  return unwrap(
    await sdk.session.fork({
      sessionID: sessionId,
      directory: formatPathForApi(directory),
      messageID: messageId,
    }),
  )
}

/**
 * 总结 session
 */
export async function summarizeSession(
  sessionId: string,
  params: { providerID: string; modelID: string; auto?: boolean },
  directory?: string,
): Promise<boolean> {
  const sdk = getSDKClient()
  unwrap(
    await sdk.session.summarize({
      sessionID: sessionId,
      directory: formatPathForApi(directory),
      ...params,
    }),
  )
  return true
}

/**
 * 获取子 session
 */
export async function getSessionChildren(sessionId: string, directory?: string): Promise<ApiSession[]> {
  const sdk = getSDKClient()
  return unwrap(await sdk.session.children({ sessionID: sessionId, directory: formatPathForApi(directory) }))
}

/**
 * Session Todo
 */
export type ApiTodo = TodoItem

/**
 * 获取 session 的 todo 列表
 * SDK 的 Todo 没有 id 字段，用 index+content+status 合成
 */
export async function getSessionTodos(sessionId: string, directory?: string): Promise<ApiTodo[]> {
  const sdk = getSDKClient()
  const todos = unwrap(await sdk.session.todo({ sessionID: sessionId, directory: formatPathForApi(directory) }))
  return normalizeTodoItems(todos)
}
