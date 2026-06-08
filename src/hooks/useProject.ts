import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { getCurrentProject, getProjects, type ApiProject } from '../api'
import { apiErrorHandler } from '../utils'
import { serverStorage } from '../utils/perServerStorage'

export interface UseProjectResult {
  currentProject: ApiProject | null
  projects: ApiProject[]
  isLoading: boolean
  error: string | null
  selectProject: (projectId: string) => void
  refresh: () => Promise<void>
}

const STORAGE_KEY = 'selected-project-id'
const PROJECTS_CACHE_KEY = 'opencode:projects-cache'

export function useProject(): UseProjectResult {
  const { t } = useTranslation(['commands'])
  const [currentProject, setCurrentProject] = useState<ApiProject | null>(null)
  const [projects, setProjects] = useState<ApiProject[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadProjects = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const [current, all] = await Promise.all([getCurrentProject(), getProjects()])

      setProjects(all)
      localStorage.setItem(PROJECTS_CACHE_KEY, JSON.stringify(all))

      const savedProjectId = serverStorage.get(STORAGE_KEY)

      if (savedProjectId) {
        const savedProject = all.find(p => p.id === savedProjectId)
        if (savedProject) {
          setCurrentProject(savedProject)
        } else {
          setCurrentProject(current)
          serverStorage.remove(STORAGE_KEY)
        }
      } else {
        setCurrentProject(current)
      }
    } catch (e) {
      apiErrorHandler('load projects', e)
      setError(e instanceof Error ? e.message : t('sessions.failedToLoadProjects'))
    } finally {
      setIsLoading(false)
    }
  }, [t])

  useEffect(() => {
    try {
      const cached = localStorage.getItem(PROJECTS_CACHE_KEY)
      if (cached) {
        const parsed = JSON.parse(cached)
        if (Array.isArray(parsed) && parsed.length > 0) {
          setProjects(parsed)
          setIsLoading(false)
        }
      }
    } catch {}
    loadProjects()
  }, [loadProjects])

  const selectProject = useCallback(
    (projectId: string) => {
      const project = projects.find(p => p.id === projectId)
      if (project) {
        setCurrentProject(project)
        serverStorage.set(STORAGE_KEY, projectId)
      }
    },
    [projects],
  )

  return {
    currentProject,
    projects,
    isLoading,
    error,
    selectProject,
    refresh: loadProjects,
  }
}
