// ============================================
// IntegrationsPanel — MCP + Skills + Plugins 统一面板
// 在一个面板中展示当前所有集成（MCP 服务器、Skills、工具/插件）
// ============================================

import { memo, useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  PlugIcon,
  TeachIcon,
  RetryIcon,
  SpinnerIcon,
  AlertCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  LayersIcon,
  CheckIcon,
  CloseIcon,
  SearchIcon,
  PlusIcon,
} from './Icons'
import {
  healthCheckMcpStatus,
  connectMcpServer,
  disconnectMcpServer,
  addMcpServer,
  recordMcpServerName,
} from '../api/mcp'
import { getSkills } from '../api/skill'
import { getToolIds } from '../api/tool'
import type { MCPStatus, McpServerConfig } from '../types/api/mcp'
import type { Skill } from '../types/api/skill'


import { subscribeToEvents } from '../api/events'
import { useDirectory } from '../hooks'
import { apiErrorHandler } from '../utils'

// ============================================
// Types
// ============================================

type TabKey = 'mcp' | 'skills' | 'tools'

// ============================================
// IntegrationsPanel Component
// ============================================

interface IntegrationsPanelProps {
  isResizing?: boolean
}

export const IntegrationsPanel = memo(function IntegrationsPanel({ isResizing: _isResizing }: IntegrationsPanelProps) {
  const { t } = useTranslation(['components', 'common'])
  const { currentDirectory } = useDirectory()

  const [activeTab, setActiveTab] = useState<TabKey>('mcp')

  // MCP
  const [mcpServers, setMcpServers] = useState<{ name: string; status: MCPStatus }[]>([])
  const [mcpLoading, setMcpLoading] = useState(true)
  const [mcpError, setMcpError] = useState<string | null>(null)
  const [mcpActionLoading, setMcpActionLoading] = useState<string | null>(null)

  // Skills
  const [skills, setSkills] = useState<Skill[]>([])
  const [skillsLoading, setSkillsLoading] = useState(true)
  const [skillsError, setSkillsError] = useState<string | null>(null)
  const [skillFilter, setSkillFilter] = useState('')

  // Tools
  const [tools, setTools] = useState<string[]>([])
  const [toolsLoading, setToolsLoading] = useState(true)
  const [toolsError, setToolsError] = useState<string | null>(null)
  const [toolFilter, setToolFilter] = useState('')

  // 总加载状态
  const [loading, setLoading] = useState(true)

  // ============================================
  // 数据加载
  // ============================================

  const loadAll = useCallback(async () => {
    setLoading(true)

    // MCP
    setMcpLoading(true)
    setMcpError(null)
    try {
      const statusResponse = await healthCheckMcpStatus()
      const entries = Object.entries(statusResponse)
        .map(([name, status]) => ({ name, status: status as MCPStatus }))
        .sort((a, b) => a.name.localeCompare(b.name))
      setMcpServers(entries)
    } catch (err) {
      apiErrorHandler('load MCP status', err)
      setMcpError(t('mcpPanel.failedToLoad'))
    } finally {
      setMcpLoading(false)
    }

    // Skills
    setSkillsLoading(true)
    setSkillsError(null)
    try {
      const data = await getSkills(currentDirectory)
      setSkills(data)
    } catch (err) {
      apiErrorHandler('load skills', err)
      setSkillsError(t('skillPanel.failedToLoad'))
    } finally {
      setSkillsLoading(false)
    }

    // Tools
    setToolsLoading(true)
    setToolsError(null)
    try {
      const ids = await getToolIds(currentDirectory)
      const list: string[] = Array.isArray(ids) ? ids : (ids as { ids: string[] }).ids ?? []
      setTools(list)
    } catch (err) {
      apiErrorHandler('load tool IDs', err)
      setToolsError(t('integrationsPanel.failedToLoadPlugins'))
    } finally {
      setToolsLoading(false)
    }

    setLoading(false)
  }, [currentDirectory, t])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // 订阅 MCP 状态变更事件，后端状态变化时自动刷新
  useEffect(() => {
    const unsubscribe = subscribeToEvents({
      onMcpToolsChanged: (server) => {
        recordMcpServerName(server)
        loadAll()
      },
    })
    return unsubscribe
  }, [loadAll])

  // MCP 添加表单
  const [showMcpAddForm, setShowMcpAddForm] = useState(false)
  const [newMcpName, setNewMcpName] = useState('')
  const [newMcpUrl, setNewMcpUrl] = useState('')

  const handleAddServer = useCallback(async () => {
    if (!newMcpName.trim()) return
    if (!newMcpUrl.trim()) return
    setMcpActionLoading('__adding__')
    try {
      const config: McpServerConfig = { type: 'remote', url: newMcpUrl.trim() }
      await addMcpServer(newMcpName.trim(), config, currentDirectory)
      setShowMcpAddForm(false)
      setNewMcpName('')
      setNewMcpUrl('')
      await loadAll()
    } catch (err) {
      apiErrorHandler('add MCP server', err)
    } finally {
      setMcpActionLoading(null)
    }
  }, [newMcpName, newMcpUrl, currentDirectory, loadAll])

  // MCP 连接/断开
  const handleMcpConnect = useCallback(
    async (name: string) => {
      setMcpActionLoading(name)
      try {
        await connectMcpServer(name, currentDirectory)
        await new Promise(r => setTimeout(r, 500))
        await loadAll()
      } catch (err) {
        apiErrorHandler('connect MCP server', err)
      } finally {
        setMcpActionLoading(null)
      }
    },
    [currentDirectory, loadAll],
  )

  const handleMcpDisconnect = useCallback(
    async (name: string) => {
      setMcpActionLoading(name)
      try {
        await disconnectMcpServer(name, currentDirectory)
        await new Promise(r => setTimeout(r, 500))
        await loadAll()
      } catch (err) {
        apiErrorHandler('disconnect MCP server', err)
      } finally {
        setMcpActionLoading(null)
      }
    },
    [currentDirectory, loadAll],
  )

  const mcpCount = mcpServers.length
  const skillsCount = skills.length
  const toolsCount = tools.length

  // ============================================
  // Render
  // ============================================

  return (
    <div className="flex flex-col h-full bg-bg-100">
      {/* Header */}
      <div className="relative flex h-10 items-center justify-between px-3">
        <div className="flex h-6 min-w-0 items-center gap-1.5 text-text-100 text-[length:var(--fs-xs)] font-medium">
          <LayersIcon size={13} />
          <span>{t('integrationsPanel.title')}</span>
          {!loading && (
            <span className="inline-flex h-4 items-center text-[length:var(--fs-xs)] leading-none text-text-400">
              ({mcpCount + skillsCount + toolsCount})
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={loadAll}
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
        {/* Tab Bar */}
        <div className="flex border-b border-border-200/30 px-3 shrink-0">
          {([
            { key: 'mcp' as TabKey, icon: <PlugIcon size={13} />, label: t('integrationsPanel.mcpServers'), count: mcpCount, loading: mcpLoading },
            { key: 'skills' as TabKey, icon: <TeachIcon size={13} />, label: t('integrationsPanel.skills'), count: skillsCount, loading: skillsLoading },
            { key: 'tools' as TabKey, icon: <LayersIcon size={13} />, label: t('integrationsPanel.plugins'), count: toolsCount, loading: toolsLoading },
          ] as const).map(tab => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`
                flex items-center gap-1.5 px-3 py-2 text-[length:var(--fs-xs)] font-medium border-b-2 transition-colors shrink-0
                ${activeTab === tab.key
                  ? 'border-accent-main-100 text-text-100'
                  : 'border-transparent text-text-400 hover:text-text-100 hover:border-border-200/50'}
              `}
            >
              <span className="shrink-0">{tab.icon}</span>
              <span>{tab.label}</span>
              {tab.loading ? (
                <SpinnerIcon size={10} className="animate-spin opacity-50" />
              ) : (
                <span className="text-text-500">({tab.count})</span>
              )}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-auto">
          {activeTab === 'mcp' && (
            <div className="px-2 pb-1 pt-2">
              <div className="flex items-center justify-end mb-1">
                <button
                  type="button"
                  onClick={() => setShowMcpAddForm(!showMcpAddForm)}
                  className="inline-flex h-5 items-center gap-0.5 px-1.5 text-[length:var(--fs-xs)] text-accent-main-100 hover:text-accent-main-200 hover:bg-accent-main-100/10 rounded transition-colors"
                >
                  <PlusIcon size={10} />
                  <span>{t('mcpPanel.addServer')}</span>
                </button>
              </div>

              {showMcpAddForm && (
                <div className="mb-2 rounded-md border border-border-200/60 bg-bg-100/50 p-2">
                  <input
                    type="text"
                    value={newMcpName}
                    onChange={e => setNewMcpName(e.target.value)}
                    placeholder={t('mcpPanel.serverName')}
                    className="w-full px-2 py-1 text-[length:var(--fs-sm)] bg-bg-000 border border-border-200 rounded-md text-text-100 placeholder-text-500 mb-1.5"
                  />
                  <input
                    type="text"
                    value={newMcpUrl}
                    onChange={e => setNewMcpUrl(e.target.value)}
                    placeholder={t('mcpPanel.urlPlaceholder')}
                    className="w-full px-2 py-1 text-[length:var(--fs-sm)] bg-bg-000 border border-border-200 rounded-md text-text-100 placeholder-text-500 mb-1.5"
                  />
                  <div className="flex gap-1.5 justify-end">
                    <button
                      type="button"
                      onClick={() => { setShowMcpAddForm(false); setNewMcpName(''); setNewMcpUrl('') }}
                      className="px-2 py-0.5 text-[length:var(--fs-xs)] text-text-400 hover:text-text-100 hover:bg-bg-200/50 rounded transition-colors"
                    >
                      {t('common:cancel')}
                    </button>
                    <button
                      type="button"
                      disabled={mcpActionLoading === '__adding__'}
                      onClick={handleAddServer}
                      className="px-2 py-0.5 text-[length:var(--fs-xs)] bg-accent-main-100 hover:bg-accent-main-200 text-oncolor-100 rounded transition-colors disabled:opacity-50 flex items-center gap-1"
                    >
                      {mcpActionLoading === '__adding__' ? (
                        <SpinnerIcon size={10} className="animate-spin" />
                      ) : null}
                      {t('common:add')}
                    </button>
                  </div>
                </div>
              )}

              {mcpLoading ? (
                <SectionLoading />
              ) : mcpError ? (
                <SectionError message={mcpError} />
              ) : mcpServers.length === 0 ? (
                <SectionEmpty message={t('mcpPanel.noServers')} />
              ) : (
                mcpServers.map(server => (
                  <McpRow
                    key={server.name}
                    name={server.name}
                    status={server.status}
                    actionLoading={mcpActionLoading}
                    onConnect={handleMcpConnect}
                    onDisconnect={handleMcpDisconnect}
                  />
                ))
              )}
            </div>
          )}

          {activeTab === 'skills' && (
            <div className="px-2 pb-1 pt-2">
              {skillsLoading ? (
                <SectionLoading />
              ) : skillsError ? (
                <SectionError message={skillsError} />
              ) : (
                <>
                  <div className="relative mb-1">
                    <input
                      type="text"
                      value={skillFilter}
                      onChange={e => setSkillFilter(e.target.value)}
                      placeholder={t('skillPanel.filterPlaceholder')}
                      className="w-full bg-bg-200/40 hover:bg-bg-200/60 focus:bg-bg-000 border border-transparent focus:border-border-200 rounded-md py-1 pl-7 pr-2 text-[length:var(--fs-sm)] text-text-100 placeholder:text-text-400/70 focus-visible:ring-1 focus-visible:ring-border-200 transition-all"
                    />
                    <SearchIcon size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-400" />
                  </div>
                  {skills.length === 0 ? (
                    <SectionEmpty message={t('skillPanel.noSkills')} />
                  ) : (
                    skills
                      .filter(
                        s =>
                          s.name.toLowerCase().includes(skillFilter.toLowerCase()) ||
                          s.description.toLowerCase().includes(skillFilter.toLowerCase()),
                      )
                      .map(skill => <SkillRow key={skill.name} skill={skill} />)
                  )}
                </>
              )}
            </div>
          )}

          {activeTab === 'tools' && (
            <div className="px-2 pb-2 pt-2">
              {toolsLoading ? (
                <SectionLoading />
              ) : toolsError ? (
                <SectionError message={toolsError} />
              ) : (
                <>
                  <div className="relative mb-1">
                    <input
                      type="text"
                      value={toolFilter}
                      onChange={e => setToolFilter(e.target.value)}
                      placeholder={t('integrationsPanel.filterPlugins')}
                      className="w-full bg-bg-200/40 hover:bg-bg-200/60 focus:bg-bg-000 border border-transparent focus:border-border-200 rounded-md py-1 pl-7 pr-2 text-[length:var(--fs-sm)] text-text-100 placeholder:text-text-400/70 focus-visible:ring-1 focus-visible:ring-border-200 transition-all"
                    />
                    <SearchIcon size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-400" />
                  </div>
                  {tools.length === 0 ? (
                    <SectionEmpty message={t('integrationsPanel.noPlugins')} />
                  ) : (
                    <div className="flex flex-col">
                      {tools
                        .filter(p => p.toLowerCase().includes(toolFilter.toLowerCase()))
                        .map(id => (
                          <PluginRow key={id} id={id} />
                        ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
})
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
// MCP Row
// ============================================

const STATUS_ICON: Record<string, React.ReactNode> = {
  connected: <CheckIcon size={12} className="text-success-100" />,
  disabled: <CloseIcon size={12} className="text-text-400" />,
  failed: <AlertCircleIcon size={12} className="text-danger-100" />,
  needs_auth: <AlertCircleIcon size={12} className="text-warning-100" />,
  needs_client_registration: <AlertCircleIcon size={12} className="text-warning-100" />,
}

function statusLabel(status: string, t: (key: string) => string): string {
  switch (status) {
    case 'connected':
      return t('mcpPanel.connected')
    case 'disabled':
      return t('mcpPanel.disabled')
    case 'failed':
      return t('mcpPanel.failedToLoad')
    case 'needs_auth':
      return t('mcpPanel.needsAuth')
    case 'needs_client_registration':
      return t('mcpPanel.needsRegistration')
    default:
      return status
  }
}

interface McpRowProps {
  name: string
  status: MCPStatus
  actionLoading: string | null
  onConnect: (name: string) => void
  onDisconnect: (name: string) => void
}

const McpRow = memo(function McpRow({ name, status, actionLoading, onConnect, onDisconnect }: McpRowProps) {
  const { t } = useTranslation(['components', 'common'])
  const statusObj = typeof status === 'object' && status !== null ? status : { status: '' }
  const statusStr = (statusObj as Record<string, unknown>).status as string || ''
  const icon = STATUS_ICON[statusStr] ?? <PlugIcon size={12} className="text-text-400" />
  const isConnected = statusStr === 'connected'
  const isBusy = actionLoading === name

  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-bg-200/30 transition-colors">
      {isBusy ? <SpinnerIcon size={12} className="animate-spin text-text-400" /> : icon}
      <span className="flex-1 text-[length:var(--fs-sm)] text-text-100 truncate">{name}</span>
      <span className="text-[length:var(--fs-xs)] text-text-400 shrink-0 mr-1">{statusLabel(statusStr, t)}</span>
      <button
        type="button"
        disabled={isBusy}
        onClick={() => (isConnected ? onDisconnect(name) : onConnect(name))}
        className={`
          relative inline-flex h-5 w-8 shrink-0 items-center rounded-full
          transition-all duration-200 disabled:opacity-50
          ${isConnected ? 'bg-success-100' : 'bg-bg-300/60'}
        `}
      >
        <span
          className={`
            inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm
            transform transition-transform duration-200
            ${isConnected ? 'translate-x-[14px]' : 'translate-x-[2px]'}
          `}
        />
      </button>
    </div>
  )
})

// ============================================
// Skill Row
// ============================================

const SkillRow = memo(function SkillRow({ skill }: { skill: Skill }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 hover:bg-bg-200/30 transition-colors border-none bg-transparent text-left"
      >
        <span className="shrink-0 mt-0.5 text-text-400">
          {expanded ? <ChevronDownIcon size={11} /> : <ChevronRightIcon size={11} />}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[length:var(--fs-sm)] text-text-100 truncate">{skill.name}</div>
          <div className="text-[length:var(--fs-xs)] text-text-400 truncate">{skill.description}</div>
        </div>
      </button>
      {expanded && (
        <div className="ml-6 mr-2 mb-1 rounded-md border border-border-200/30 bg-bg-100/50 px-2 py-1.5">
          <div className="text-[length:var(--fs-xs)] text-text-500 mb-1 font-mono break-all">{skill.location}</div>
          <pre className="text-[length:var(--fs-xs)] text-text-200 font-mono whitespace-pre-wrap break-words max-h-40 overflow-auto">
            {skill.content}
          </pre>
        </div>
      )}
    </div>
  )
})

// ============================================
// Plugin Row (Tool ID)
// ============================================

const PluginRow = memo(function PluginRow({ id }: { id: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-bg-200/30 transition-colors">
      <LayersIcon size={12} className="text-text-400 shrink-0" />
      <span className="text-[length:var(--fs-sm)] text-text-100 font-mono truncate">{id}</span>
    </div>
  )
})
