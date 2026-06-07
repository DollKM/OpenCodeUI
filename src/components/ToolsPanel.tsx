// ============================================
// ToolsPanel — Tool IDs / Plugins 面板
// 展示当前所有可用的工具/插件列表
// ============================================

import { memo, useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RetryIcon,
  SpinnerIcon,
  AlertCircleIcon,
  LayersIcon,
  SearchIcon,
} from './Icons'
import { getToolIds, getTools } from '../api/tool'
import { getDefaultModels } from '../api/client'
import { useDirectory } from '../hooks'
import { apiErrorHandler } from '../utils'
import type { ToolListItem } from '../types/api/tool'

// ============================================
// ToolsPanel Component
// ============================================

interface ToolsPanelProps {
  isResizing?: boolean
}

export const ToolsPanel = memo(function ToolsPanel({ isResizing: _isResizing }: ToolsPanelProps) {
  const { t } = useTranslation(['components', 'common'])
  const { currentDirectory } = useDirectory()

  // Tools
  const [tools, setTools] = useState<ToolListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  const loadTools = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // 1. 获取所有工具 ID
      const ids = await getToolIds(currentDirectory)
      const idList: string[] = Array.isArray(ids) ? ids : (ids as { ids: string[] }).ids ?? []

      // 2. 尝试获取工具详细信息（含描述）
      let items: ToolListItem[] = idList.map(id => ({ id, description: '', parameters: null }))
      try {
        const defaults = await getDefaultModels(currentDirectory)
        const providerEntry = Object.entries(defaults)[0]
        if (providerEntry) {
          const [provider, model] = providerEntry
          const detailed = await getTools(provider, model, currentDirectory)
          if (Array.isArray(detailed)) {
            const detailMap = new Map(detailed.map(d => [d.id, d.description]))
            items = idList.map(id => ({
              id,
              description: detailMap.get(id) ?? '',
              parameters: null,
            }))
          }
        }
      } catch {
        // 获取详细信息失败时，仅显示 ID
      }

      setTools(items)
    } catch (err) {
      apiErrorHandler('load tool IDs', err)
      setError(t('toolsPanel.failedToLoadPlugins'))
    } finally {
      setLoading(false)
    }
  }, [currentDirectory, t])

  useEffect(() => {
    loadTools()
  }, [loadTools])

  const filtered = tools.filter(item => {
    const q = filter.toLowerCase()
    return item.id.toLowerCase().includes(q) || item.description.toLowerCase().includes(q)
  })

  return (
    <div className="flex flex-col h-full bg-bg-100">
      {/* Header */}
      <div className="relative flex h-10 items-center justify-between px-3">
        <div className="flex h-6 min-w-0 items-center gap-1.5 text-text-100 text-[length:var(--fs-xs)] font-medium">
          <LayersIcon size={13} />
          <span>{t('toolsPanel.title')}</span>
          {!loading && (
            <span className="inline-flex h-4 items-center text-[length:var(--fs-xs)] leading-none text-text-400">
              ({tools.length})
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={loadTools}
          disabled={loading}
          aria-label={t('common:refresh')}
          className="inline-flex h-6 w-6 items-center justify-center hover:bg-bg-200/50 rounded-md text-text-300 hover:text-text-100 transition-colors disabled:opacity-50"
          title={t('common:refresh')}
        >
          <RetryIcon size={12} className={loading ? 'animate-spin' : ''} />
        </button>
        <div className="pointer-events-none absolute inset-x-3 bottom-0 h-px bg-border-200/30" />
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 overflow-auto px-2 pb-2 pt-2">
          {loading ? (
            <SectionLoading />
          ) : error ? (
            <SectionError message={error} />
          ) : (
            <>
              <div className="relative mb-1">
                <input
                  type="text"
                  value={filter}
                  onChange={e => setFilter(e.target.value)}
                  placeholder={t('toolsPanel.filterPlugins')}
                  className="w-full bg-bg-200/40 hover:bg-bg-200/60 focus:bg-bg-000 border border-transparent focus:border-border-200 rounded-md py-1 pl-7 pr-2 text-[length:var(--fs-sm)] text-text-100 placeholder:text-text-400/70 focus-visible:ring-1 focus-visible:ring-border-200 transition-all"
                />
                <SearchIcon size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-400" />
              </div>
              {tools.length === 0 ? (
                <SectionEmpty message={t('toolsPanel.noPlugins')} />
              ) : (
                <div className="flex flex-col">
                  {filtered.map(item => (
                    <PluginRow key={item.id} id={item.id} description={item.description} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
})

// ============================================
// Sub-components
// ============================================

/** 加载中状态 */
function SectionLoading() {
  const { t } = useTranslation(['components', 'common'])
  return (
    <div className="flex items-center justify-center py-6 text-text-400 text-[length:var(--fs-sm)] gap-1.5">
      <SpinnerIcon size={14} className="animate-spin opacity-50" />
      <span>{t('common:loading')}</span>
    </div>
  )
}

/** 错误状态 */
function SectionError({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-6 text-text-400 text-[length:var(--fs-sm)] gap-1.5">
      <AlertCircleIcon size={14} className="text-danger-100 shrink-0" />
      <span className="text-center">{message}</span>
    </div>
  )
}

/** 空状态 */
function SectionEmpty({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-6 text-text-400 text-[length:var(--fs-sm)]">
      {message}
    </div>
  )
}

// ============================================
// Plugin Row (Tool ID)
// ============================================

const PluginRow = memo(function PluginRow({ id, description }: { id: string; description: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-bg-200/30 transition-colors">
      <LayersIcon size={12} className="text-text-400 shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="text-[length:var(--fs-sm)] text-text-100 font-mono truncate">{id}</div>
        {description && (
          <div className="text-[length:var(--fs-xs)] text-text-400 mt-0.5 line-clamp-2">{description}</div>
        )}
      </div>
    </div>
  )
})
