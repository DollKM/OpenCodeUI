// ============================================
// SkillPanel - Skill 管理面板
// 显示所有可用 Skill，支持查看详情
// ============================================

import { memo, useState, useEffect, useCallback, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import {
  TeachIcon,
  RetryIcon,
  SpinnerIcon,
  AlertCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  SearchIcon,
  TrashIcon,
} from './Icons'
import { getSkills, deleteSkill } from '../api/skill'
import type { Skill } from '../types/api/skill'
import { useDirectory } from '../hooks'
import { apiErrorHandler } from '../utils'
import { skillUsageStore } from '../store/skillUsageStore'

// ============================================
// SkillPanel Component
// ============================================

interface SkillPanelProps {
  isResizing?: boolean
}

export const SkillPanel = memo(function SkillPanel({ isResizing: _isResizing }: SkillPanelProps) {
  const { t } = useTranslation(['components', 'common'])
  const { currentDirectory } = useDirectory()
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const skillUsage = useSyncExternalStore(
    useCallback(cb => skillUsageStore.subscribe(cb), []),
    useCallback(() => skillUsageStore.getUsage(), []),
    useCallback(() => skillUsageStore.getUsage(), []),
  )

  const loadSkills = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await getSkills(currentDirectory)
      setSkills(data)
      skillUsageStore.registerSkillNames(data.map(s => s.name))
    } catch (err) {
      apiErrorHandler('load skills', err)
      setError(t('skillPanel.failedToLoad'))
    } finally {
      setLoading(false)
    }
  }, [currentDirectory, t])

  useEffect(() => {
    loadSkills()
  }, [loadSkills])

  // Filter skills
  const filteredSkills = skills.filter(
    skill =>
      skill.name.toLowerCase().includes(filter.toLowerCase()) ||
      (skill.description ?? '').toLowerCase().includes(filter.toLowerCase()),
  )

  // Sort by usage descending, preserve original order for ties
  const originalOrder = new Map(skills.map((s, i) => [s.name, i]))
  const sortedSkills = [...filteredSkills].sort((a, b) => {
    const usageA = skillUsage[a.name] ?? 0
    const usageB = skillUsage[b.name] ?? 0
    if (usageB !== usageA) return usageB - usageA
    return (originalOrder.get(a.name) ?? 0) - (originalOrder.get(b.name) ?? 0)
  })

  const handleDeleteSkill = useCallback(async (name: string) => {
    try {
      await deleteSkill(name, currentDirectory)
      setSkills(prev => prev.filter(s => s.name !== name))
    } catch (err) {
      apiErrorHandler('uninstall skill', err)
      throw err
    }
  }, [currentDirectory])

  return (
    <div className="flex flex-col h-full bg-bg-100">
      {/* Header */}
      <div className="relative flex h-10 items-center justify-between px-3">
          <div className="flex h-6 min-w-0 items-center gap-1.5 text-text-100 text-[length:var(--fs-xs)] font-medium">
          <span>{t('skillPanel.title')}</span>
          {!loading && <span className="inline-flex h-4 items-center text-[length:var(--fs-xs)] leading-none text-text-400">({skills.length})</span>}
        </div>
        <button
          type="button"
          onClick={loadSkills}
          disabled={loading}
          aria-label={t('common:refresh')}
          className="inline-flex h-6 w-6 items-center justify-center hover:bg-bg-200/50 rounded-md text-text-300 hover:text-text-100 transition-colors disabled:opacity-50"
          title={t('common:refresh')}
        >
          <RetryIcon size={12} className={loading ? 'animate-spin' : ''} />
        </button>
        <div className="pointer-events-none absolute inset-x-3 bottom-0 h-px bg-border-200/30" />
      </div>

      {/* Search Bar */}
      <div className="relative px-3 py-2">
        <div className="relative group">
          <input
            type="text"
            name="skill-filter"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder={t('skillPanel.filterPlaceholder')}
            aria-label={t('skillPanel.filterPlaceholder')}
            autoComplete="off"
            className="w-full bg-bg-200/40 hover:bg-bg-200/60 focus:bg-bg-000 border border-transparent focus:border-border-200 rounded-md py-1.5 pl-[30px] pr-2 text-[length:var(--fs-sm)] text-text-100 placeholder:text-text-400/70 focus-visible:ring-1 focus-visible:ring-border-200 focus-visible:ring-inset transition-all"
          />
          <SearchIcon size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-400 group-focus-within:text-accent-main-100 transition-colors" />
        </div>
        <div className="pointer-events-none absolute inset-x-3 bottom-0 h-px bg-border-200/30" />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {loading && skills.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-text-400 text-[length:var(--fs-base)] gap-2">
            <SpinnerIcon size={20} className="animate-spin opacity-50" />
            <span>{t('skillPanel.loadingSkills')}</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full text-text-400 text-[length:var(--fs-base)] gap-2">
            <AlertCircleIcon size={20} className="text-danger-100" />
            <span>{error}</span>
            <button
              type="button"
              onClick={loadSkills}
              className="px-3 py-1.5 text-[length:var(--fs-sm)] bg-bg-200/50 hover:bg-bg-200 text-text-200 rounded-md transition-colors"
            >
              {t('common:retry')}
            </button>
          </div>
        ) : filteredSkills.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-text-400 text-[length:var(--fs-base)] gap-2 px-4 text-center">
            <TeachIcon size={24} className="opacity-30" />
            <span>{t('skillPanel.noSkills')}</span>
          </div>
        ) : (
          <div className="flex flex-col h-full">
            <div className="flex items-center justify-end px-3 py-1 shrink-0">
              <button
                type="button"
                onClick={() => skillUsageStore.clearAll()}
                className="text-[length:var(--fs-xs)] px-2 py-1 rounded-md bg-danger-100/10 text-danger-100 hover:bg-danger-100 hover:text-bg-000 transition-colors"
              >
                {t('skillPanel.clearUsage')}
              </button>
            </div>
            <div className="flex-1 overflow-auto p-1">
              {sortedSkills.map(skill => (
                <SkillItem key={skill.name} skill={skill} usage={skillUsage[skill.name] ?? 0} onDelete={handleDeleteSkill} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
})

// ============================================
// SkillItem Component
// ============================================

const SkillItem = memo(function SkillItem({ skill, usage, onDelete }: { skill: Skill; usage: number; onDelete: (name: string) => Promise<void> }) {
  const [expanded, setExpanded] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const { t } = useTranslation(['components', 'common'])

  const handleUninstall = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!window.confirm(t('skillPanel.uninstallConfirm', { name: skill.name }))) return
    setDeleting(true)
    try {
      await onDelete(skill.name)
    } catch {
      setDeleting(false)
    }
  }, [skill.name, onDelete, t])

  return (
    <div className="group">
      <button
        type="button"
        aria-expanded={expanded}
        className="flex w-full items-start gap-2 rounded-md px-2 py-2 hover:bg-bg-200/50 transition-colors bg-transparent border-none text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-text-400 shrink-0 mt-0.5">
          {expanded ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
        </span>

        <div className="flex-1 min-w-0">
          <div className="text-[length:var(--fs-base)] text-text-100 font-medium">{skill.name}</div>
          <div className="text-[length:var(--fs-sm)] text-text-400 truncate">{skill.description ?? ''}</div>
        </div>
        <button
          type="button"
          onClick={handleUninstall}
          disabled={deleting}
          className="shrink-0 inline-flex items-center gap-1 px-1.5 py-1 rounded-md text-text-400 opacity-0 group-hover:opacity-100 hover:bg-danger-100/10 hover:text-danger-100 transition-all disabled:opacity-50"
          title={t('skillPanel.uninstall')}
        >
          <TrashIcon size={12} />
          {deleting && <span className="text-[length:var(--fs-xs)]">{t('skillPanel.uninstalling')}</span>}
        </button>
        <span className="shrink-0 inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-accent-main-100/10 text-accent-main-100 text-[length:var(--fs-xs)] font-medium">
          {usage}
        </span>
      </button>

      {expanded && (
        <div className="mx-2 mb-2 ml-7 rounded-md border border-border-200/40 bg-bg-100/50 px-3 py-2">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[length:var(--fs-sm)] text-text-500 font-mono break-all">{skill.location}</div>
            <button
              type="button"
              onClick={handleUninstall}
              disabled={deleting}
              className="inline-flex items-center gap-1 px-2 py-1 text-[length:var(--fs-xs)] rounded-md bg-danger-100/10 text-danger-100 hover:bg-danger-100 hover:text-bg-000 transition-colors disabled:opacity-50"
            >
              <TrashIcon size={11} />
              {deleting ? t('skillPanel.uninstalling') : t('skillPanel.uninstall')}
            </button>
          </div>
          <div className="bg-bg-200/50 rounded-md p-2 overflow-x-auto">
            <pre className="text-[length:var(--fs-sm)] text-text-200 font-mono whitespace-pre-wrap break-words">{skill.content}</pre>
          </div>
        </div>
      )}
    </div>
  )
})
