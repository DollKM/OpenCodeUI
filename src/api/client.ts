// ============================================
// API Client for OpenCode Backend
// 基于 @opencode-ai/sdk: /config, /project, /provider 相关接口
// ============================================

import { getSDKClient, unwrap } from './sdk'
import { formatPathForApi } from '../utils/directoryUtils'
import { isTauri } from '../utils/tauri'
import { serverStore } from '../store/serverStore'
import type { ModelInfo, ApiProject, ApiPath } from './types'

// Re-export all types
export * from './types'

// Re-export from Attachment feature
export { fromFilePart, fromAgentPart } from '../features/attachment'

// Re-export from sub-modules
export * from './session'
export * from './message'
export * from './permission'
export * from './file'
export * from './agent'
export * from './skill'
export * from './events'
export * from './config'
export * from './vcs'
export * from './mcp'
export * from './pty'
export * from './worktree'
export * from './command'
export * from './global'
export * from './tool'
export * from './lsp'
export * from './directChat'
export * from './queryImage'

// ============================================
// Model API Functions
// 基于 SDK: config.providers()
// ============================================

export async function getActiveModels(directory?: string): Promise<ModelInfo[]> {
  const sdk = getSDKClient()
  const data = unwrap(await sdk.config.providers({ directory: formatPathForApi(directory) }))
  const models: ModelInfo[] = []

  for (const provider of data.providers) {
    for (const [, model] of Object.entries(provider.models)) {
      if (model.status === 'active') {
        const variants = model.variants ? Object.keys(model.variants) : []

        models.push({
          id: model.id,
          name: model.name || model.id,
          providerId: provider.id,
          providerName: provider.name || provider.id,
          family: model.family || '',
          contextLimit: model.limit.context,
          outputLimit: model.limit.output,
          supportsReasoning: model.capabilities.reasoning,
          supportsImages: model.capabilities.input.image,
          supportsPdf: model.capabilities.input.pdf,
          supportsAudio: model.capabilities.input.audio,
          supportsVideo: model.capabilities.input.video,
          supportsToolcall: model.capabilities.toolcall,
          variants,
        })
      }
    }
  }

  return models
}

export async function getDefaultModels(directory?: string): Promise<Record<string, string>> {
  const sdk = getSDKClient()
  const data = unwrap(await sdk.config.providers({ directory: formatPathForApi(directory) }))
  return data.default
}

// ============================================
// Project API Functions
// 基于 SDK: project.*
// ============================================

/**
 * 获取当前项目
 */
export async function getCurrentProject(directory?: string): Promise<ApiProject> {
  const sdk = getSDKClient()
  return unwrap(await sdk.project.current({ directory: formatPathForApi(directory) }))
}

/**
 * 获取项目列表
 */
export async function getProjects(directory?: string): Promise<ApiProject[]> {
  const sdk = getSDKClient()
  return unwrap(await sdk.project.list({ directory: formatPathForApi(directory) }))
}

/**
 * 初始化 Git 仓库
 */
export async function initGitProject(directory?: string): Promise<ApiProject> {
  const sdk = getSDKClient()
  return unwrap(await sdk.project.initGit({ directory: formatPathForApi(directory) }))
}

/**
 * 更新项目
 */
export async function updateProject(
  projectId: string,
  params: {
    name?: string
    icon?: { url?: string; override?: string; color?: string }
  },
  directory?: string,
): Promise<ApiProject> {
  const sdk = getSDKClient()
  return unwrap(
    await sdk.project.update({
      projectID: projectId,
      directory: formatPathForApi(directory),
      ...params,
    }),
  )
}

// ============================================
// Project Cleanup - 通过 DELETE /project API 删除
// ============================================

/**
 * 通过服务端的 DELETE /project API 删除项目
 */
export async function deleteProjectViaServer(directory: string): Promise<void> {
  const baseUrl = serverStore.getActiveBaseUrl()
  const headers: Record<string, string> = {}
  const auth = serverStore.getActiveAuth()
  if (auth?.password) {
    headers['Authorization'] = `Basic ${btoa(`${auth.username}:${auth.password}`)}`
  }

  const f = isTauri()
    ? await import('@tauri-apps/plugin-http').then(mod => mod.fetch as typeof fetch)
    : globalThis.fetch

  const res = await f(`${baseUrl}/project?directory=${encodeURIComponent(directory)}`, {
    method: 'DELETE',
    headers,
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Failed to delete project: ${res.status} ${body}`)
  }
}

// ============================================
// Path API Functions
// ============================================

export async function getPath(): Promise<ApiPath> {
  const sdk = getSDKClient()
  return unwrap(await sdk.path.get())
}
