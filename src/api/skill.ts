// ============================================
// Skill API
// ============================================

import { getSDKClient, unwrap } from './sdk'
import { formatPathForApi } from '../utils/directoryUtils'
import type { SkillList } from '../types/api/skill'

/**
 * 获取所有可用 Skills
 */
export async function getSkills(directory?: string): Promise<SkillList> {
  const sdk = getSDKClient()
  return unwrap(await sdk.app.skills({ directory: formatPathForApi(directory) }))
}

/**
 * 卸载指定 Skill
 */
export async function deleteSkill(name: string, directory?: string): Promise<void> {
  const sdk = getSDKClient()
  await unwrap(await sdk.app.deleteSkill({ name, directory: formatPathForApi(directory) }))
}
