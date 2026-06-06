// ============================================
// Global API - 全局管理
// ============================================

import type { GlobalHealthResponse as HealthInfo } from '@opencode-ai/sdk/v2/client'
import { getSDKClient, unwrap } from './sdk'
import { formatPathForApi } from '../utils/directoryUtils'
import { serverStore, makeBasicAuthHeader } from '../store/serverStore'

export type UpgradeResult = { success: true; version: string } | { success: false; error: string }

/**
 * 获取服务器健康状态
 */
export async function getHealth(): Promise<HealthInfo> {
  const sdk = getSDKClient()
  return unwrap(await sdk.global.health())
}

/**
 * 释放所有资源
 */
export async function disposeGlobal(): Promise<boolean> {
  const sdk = getSDKClient()
  unwrap(await sdk.global.dispose())
  return true
}

/**
 * 释放当前实例
 */
export async function disposeInstance(directory?: string): Promise<boolean> {
  const sdk = getSDKClient()
  unwrap(await sdk.instance.dispose({ directory: formatPathForApi(directory) }))
  return true
}

/**
 * 升级 opencode CLI 到指定版本（不传 target 则升级到最新版）
 * 可选传入 sourcePath 从本地源码编译升级
 */
export async function upgradeOpencode(params?: { target?: string; sourcePath?: string }): Promise<UpgradeResult> {
  const baseUrl = serverStore.getActiveBaseUrl()
  const auth = serverStore.getActiveAuth()

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (auth?.password) {
    headers['Authorization'] = makeBasicAuthHeader(auth)
  }

  const body: Record<string, string> = {}
  if (params?.target) {
    body.target = params.target
  }
  if (params?.sourcePath) {
    body.source_path = params.sourcePath
  }

  try {
    const response = await fetch(`${baseUrl}/global/upgrade`, {
      method: 'POST',
      headers,
      body: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
    })

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` }
    }

    const data: unknown = await response.json()
    if (typeof data === 'object' && data && 'success' in data) {
      const result = data as { success: boolean; version?: string; error?: string }
      if (result.success) {
        return { success: true, version: result.version ?? 'unknown' }
      }
      return { success: false, error: result.error ?? 'Unknown error' }
    }

    return { success: false, error: 'Invalid response' }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}
