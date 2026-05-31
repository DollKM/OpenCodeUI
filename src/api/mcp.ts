// ============================================
// MCP API - Model Context Protocol 服务器管理
// ============================================

import { getSDKClient, unwrap } from './sdk'
import { formatPathForApi } from '../utils/directoryUtils'
import { getConfig } from './config'
import type { MCPStatusResponse, McpServerConfig } from '../types/api/mcp'

const MCP_SERVERS_KEY = 'opencode:mcp:servers'

/** 本地注册表——持久化动态添加的 MCP 服务器名（后端不提供列表 API） */
function getKnownServers(): string[] {
  try {
    const raw = localStorage.getItem(MCP_SERVERS_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return []
}

function saveKnownServers(names: string[]) {
  try {
    localStorage.setItem(MCP_SERVERS_KEY, JSON.stringify([...new Set(names)]))
  } catch { /* ignore */ }
}

function addKnownServer(name: string) {
  const names = getKnownServers()
  if (!names.includes(name)) {
    names.push(name)
    saveKnownServers(names)
  }
}

/**
 * 获取所有 MCP 服务器状态
 */
export async function getMcpStatus(directory?: string): Promise<MCPStatusResponse> {
  const sdk = getSDKClient()
  return unwrap(await sdk.mcp.status({ directory: formatPathForApi(directory) }))
}

/**
 * 添加 MCP 服务器
 */
export async function addMcpServer(name: string, config: McpServerConfig, directory?: string): Promise<void> {
  const sdk = getSDKClient()
  unwrap(await sdk.mcp.add({ name, config, directory: formatPathForApi(directory) }))
  addKnownServer(name)
}

/**
 * 连接到 MCP 服务器
 */
export async function connectMcpServer(name: string, directory?: string): Promise<void> {
  const sdk = getSDKClient()
  unwrap(await sdk.mcp.connect({ name, directory: formatPathForApi(directory) }))
}

/**
 * 断开 MCP 服务器连接
 */
export async function disconnectMcpServer(name: string, directory?: string): Promise<void> {
  const sdk = getSDKClient()
  unwrap(await sdk.mcp.disconnect({ name, directory: formatPathForApi(directory) }))
}

/**
 * 开始 MCP 认证流程
 */
export async function startMcpAuth(name: string, directory?: string): Promise<{ url: string }> {
  const sdk = getSDKClient()
  const result = unwrap(await sdk.mcp.auth.start({ name, directory: formatPathForApi(directory) }))
  return { url: result.authorizationUrl }
}

/**
 * 移除 MCP 认证
 */
export async function removeMcpAuth(name: string, directory?: string): Promise<void> {
  const sdk = getSDKClient()
  unwrap(await sdk.mcp.auth.remove({ name, directory: formatPathForApi(directory) }))
}

/**
 * 完成 MCP OAuth 认证（使用授权码）
 */
export async function completeMcpAuth(name: string, code: string, directory?: string): Promise<void> {
  const sdk = getSDKClient()
  unwrap(await sdk.mcp.auth.callback({ name, code, directory: formatPathForApi(directory) }))
}

/**
 * 健康检查驱动获取 MCP 服务器状态
 *
 * 后端 `GET /mcp` 端点在此版本中不存在（返回 404），
 * 所以无法通过 `getMcpStatus` / `sdk.mcp.status()` 获取状态。
 *
 * 替代方案：
 * 1. 先试 `getMcpStatus()`（如果端点存在就用它）
 * 2. 如果失败，从以下来源合并服务器名：
 *    a. `getConfig().mcp`（配置文件中持久化的服务器）
 *    b. localStorage 注册表（之前动态添加的服务器）
 * 3. 用 `connectMcpServer()` 探测各服务器连通性
 * 4. 构建状态映射表
 */
export async function healthCheckMcpStatus(directory?: string): Promise<MCPStatusResponse> {
  // 先试官方 status API
  try {
    const status = await getMcpStatus(directory)
    // 把服务器名同步到本地注册表
    for (const name of Object.keys(status)) {
      addKnownServer(name)
    }
    return status
  } catch {
    // status API 不可用，用替代方案
  }

  try {
    // 收集已知的服务器名
    const knownNames = new Set(getKnownServers())

    // 从 config 补充
    const config = await getConfig(directory)
    if (config.mcp) {
      for (const name of Object.keys(config.mcp)) {
        knownNames.add(name)
      }
    }

    if (knownNames.size === 0) return {}

    const result: MCPStatusResponse = {}

    for (const name of knownNames) {
      try {
        await connectMcpServer(name, directory)
        result[name] = { status: 'connected' }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        result[name] = { status: 'failed', error: message }
      }
    }

    return result
  } catch {
    return {}
  }
}

/**
 * 从 mcp.tools.changed SSE 事件加入服务器名注册
 */
export function recordMcpServerName(name: string) {
  addKnownServer(name)
}

/**
 * 启动完整的 OAuth 认证流程
 */
export async function authenticateMcp(name: string, directory?: string): Promise<void> {
  const sdk = getSDKClient()
  unwrap(await sdk.mcp.auth.authenticate({ name, directory: formatPathForApi(directory) }))
}
