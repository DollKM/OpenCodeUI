// ============================================
// Global API - 全局管理
// ============================================

import type { GlobalHealthResponse as HealthInfo } from '@opencode-ai/sdk/v2/client'
import { getSDKClient, unwrap } from './sdk'
import { formatPathForApi } from '../utils/directoryUtils'

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
 */
export async function upgradeOpencode(target?: string): Promise<UpgradeResult> {
  const sdk = getSDKClient()
  return unwrap(await sdk.global.upgrade(target ? { target } : undefined))
}
