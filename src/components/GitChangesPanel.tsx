// ============================================
// GitChangesPanel - Git 变更查看器（仅 git diff）
// 布局：上方文件列表 + 下方 Diff 预览（类似 FileExplorer）
// 支持拖拽调整高度，CSS 变量 + requestAnimationFrame 优化
// 不依赖 sessionId，没有活跃会话也能显示变更内容
// ============================================

import { memo, useState, useEffect, useCallback, useRef, useMemo, useId } from 'react'
import { useTranslation } from 'react-i18next'
import { RetryIcon, ChevronRightIcon, MaximizeIcon, SendIcon } from './Icons'
import { getMaterialIconUrl } from '../utils/materialIcons'
import { DiffViewer, useDiffViewerData, type ViewMode } from './DiffViewer'
import { FullscreenViewer, ViewModeSwitch } from './FullscreenViewer'
import { getCurrentProject, initGitProject } from '../api/client'
import { createSession } from '../api/session'
import { getVcsDiff } from '../api/vcs'
import { sendMessageAsync } from '../api/message'
import type { ApiProject, FileDiff } from '../api/types'
import { detectLanguage } from '../utils/languageUtils'
import { extractContentFromUnifiedDiff, computePatchStats } from '../utils/diffUtils'
import { getModelKey, findModelByKey, getSessionModelSelection, saveSessionModelSelection } from '../utils/modelUtils'
import { sessionErrorHandler } from '../utils'
import { PreviewTabsBar, type PreviewTabsBarItem } from './PreviewTabsBar'
import { useVerticalSplitResize } from '../hooks/useVerticalSplitResize'
import { DropdownMenu } from './ui'
import { useModels } from '../hooks/useModels'
import { useSessionNavigation } from '../contexts/SessionNavigationContext'

const MIN_LIST_HEIGHT = 80
const MIN_PREVIEW_HEIGHT = 120
const DIRECTORY_MODEL_KEY_PREFIX = 'git-changes-dir:'

function reconcileDiffPreviewState(diffs: FileDiff[], openFiles: string[], activeFile: string | null) {
  const availableFiles = new Set(diffs.map(diff => diff.file))
  const nextOpenFiles = openFiles.filter(file => availableFiles.has(file))

  if (nextOpenFiles.length === 0 && diffs.length > 0) {
    nextOpenFiles.push(diffs[0].file)
  }

  const nextActiveFile = activeFile && nextOpenFiles.includes(activeFile) ? activeFile : (nextOpenFiles[0] ?? null)

  return { nextOpenFiles, nextActiveFile }
}

interface GitChangesPanelProps {
  directory?: string
  isResizing?: boolean
}

export const GitChangesPanel = memo(function GitChangesPanel({
  directory,
  isResizing: isPanelResizing = false,
}: GitChangesPanelProps) {
  const { t } = useTranslation(['components', 'common'])
  const containerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const {
    splitHeight: listHeight,
    isResizing,
    resetSplitHeight,
    handleResizeStart,
    handleTouchResizeStart,
  } = useVerticalSplitResize({
    containerRef,
    primaryRef: listRef,
    cssVariableName: '--list-height',
    minPrimaryHeight: MIN_LIST_HEIGHT,
    minSecondaryHeight: MIN_PREVIEW_HEIGHT,
  })

  const [project, setProject] = useState<ApiProject | null>(null)
  const [projectLoading, setProjectLoading] = useState(false)
  const [initializingGit, setInitializingGit] = useState(false)
  const [diffs, setDiffs] = useState<FileDiff[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('unified')
  const [listMode, setListMode] = useState<'flat' | 'tree'>('flat')

  // 模型选择
  const { models: allModels } = useModels()
  const [selectedModelKey, setSelectedModelKey] = useState<string | null>(null)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const modelMenuTriggerRef = useRef<HTMLButtonElement>(null)
  const modelMenuRef = useRef<HTMLDivElement>(null)
  const modelMenuId = useId()
  const { navigateToSession } = useSessionNavigation()
  const [committing, setCommitting] = useState(false)

  const visibleModels = useMemo(() => allModels, [allModels])
  const selectedModel = useMemo(
    () => (selectedModelKey ? findModelByKey(visibleModels, selectedModelKey) : visibleModels[0]),
    [selectedModelKey, visibleModels],
  )

  // 追踪 directory 变化以重置模型选择
  const prevDirectoryRef = useRef<string | undefined>(directory)

  // 初始化默认模型（按目录保存偏好）
  useEffect(() => {
    if (visibleModels.length === 0) return

    const directoryChanged = prevDirectoryRef.current !== directory
    prevDirectoryRef.current = directory

    if (!directoryChanged && selectedModelKey) return

    const storageKey = DIRECTORY_MODEL_KEY_PREFIX + (directory ?? 'default')
    const saved = getSessionModelSelection(storageKey)
    if (saved && findModelByKey(visibleModels, saved.modelKey)) {
      setSelectedModelKey(saved.modelKey)
    } else {
      setSelectedModelKey(getModelKey(visibleModels[0]))
    }
  }, [visibleModels, selectedModelKey, directory])

  const handleModelSelect = useCallback(
    (key: string) => {
      setSelectedModelKey(key)
      const storageKey = DIRECTORY_MODEL_KEY_PREFIX + (directory ?? 'default')
      saveSessionModelSelection(storageKey, key, undefined)
      setModelMenuOpen(false)
    },
    [directory],
  )

  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [openDiffFiles, setOpenDiffFiles] = useState<string[]>([])
  const [mountedPreviewFiles, setMountedPreviewFiles] = useState<Set<string>>(new Set())
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())

  const projectRequestIdRef = useRef(0)
  const diffRequestIdRef = useRef(0)
  const openDiffFilesRef = useRef<string[]>([])
  const selectedFileRef = useRef<string | null>(null)

  const isAnyResizing = isPanelResizing || isResizing

  useEffect(() => {
    openDiffFilesRef.current = openDiffFiles
  }, [openDiffFiles])

  useEffect(() => {
    setMountedPreviewFiles(prev => {
      const openFiles = new Set(openDiffFiles)
      const next = new Set([...prev].filter(file => openFiles.has(file)))
      if (selectedFile) next.add(selectedFile)
      if (next.size === prev.size && [...next].every(file => prev.has(file))) return prev
      return next
    })
  }, [openDiffFiles, selectedFile])

  useEffect(() => {
    selectedFileRef.current = selectedFile
  }, [selectedFile])

  const loadProjectState = useCallback(async () => {
    const requestId = ++projectRequestIdRef.current
    setProjectLoading(true)
    setError(null)

    try {
      const nextProject = await getCurrentProject(directory)
      if (requestId !== projectRequestIdRef.current) return null
      setProject(nextProject)
      return nextProject
    } catch (err) {
      if (requestId !== projectRequestIdRef.current) return null
      sessionErrorHandler('load current project', err)
      setProject(null)
      setError(t('sessionChanges.failedToLoad'))
      return null
    } finally {
      if (requestId === projectRequestIdRef.current) {
        setProjectLoading(false)
      }
    }
  }, [directory, t])

  const loadGitDiff = useCallback(
    async (options?: { force?: boolean; project?: ApiProject | null }) => {
      const currentProject = options?.project ?? project
      if (!currentProject?.vcs) return

      const requestId = ++diffRequestIdRef.current
      setLoading(true)
      setError(null)

      try {
        const data = await getVcsDiff('git', directory)
        if (requestId !== diffRequestIdRef.current) return

        const corrected = data.map(d => ({
          ...d,
          ...(d.patch ? computePatchStats(d.patch) : { additions: 0, deletions: 0 }),
        }))

        setDiffs(corrected)
      } catch (err) {
        if (requestId !== diffRequestIdRef.current) return
        sessionErrorHandler('load git diff', err)
        setError(t('sessionChanges.failedToLoad'))
      } finally {
        if (requestId === diffRequestIdRef.current) {
          setLoading(false)
        }
      }
    },
    [directory, project, t],
  )

  useEffect(() => {
    diffRequestIdRef.current++
    setProject(null)
    setDiffs([])
    setLoading(false)
    setError(null)
    setOpenDiffFiles([])
    setSelectedFile(null)
    setSelectedModelKey(null)
    setMountedPreviewFiles(new Set())
    setExpandedDirs(new Set())
    resetSplitHeight()

    void loadProjectState()
  }, [directory, loadProjectState, resetSplitHeight])

  useEffect(() => {
    if (!project?.vcs) return
    void loadGitDiff()
  }, [project, loadGitDiff])

  useEffect(() => {
    setExpandedDirs(collectExpandedDirPaths(buildChangesTree(diffs)))
    const { nextOpenFiles, nextActiveFile } = reconcileDiffPreviewState(
      diffs,
      openDiffFilesRef.current,
      selectedFileRef.current,
    )
    setOpenDiffFiles(nextOpenFiles)
    setSelectedFile(nextActiveFile)
    if (diffs.length === 0) {
      resetSplitHeight()
    }
  }, [diffs, resetSplitHeight])

  const handleRefresh = useCallback(async () => {
    const nextProject = await loadProjectState()
    if (!nextProject?.vcs) return
    await loadGitDiff({ force: true, project: nextProject })
  }, [loadGitDiff, loadProjectState])

  const handleInitGit = useCallback(async () => {
    setInitializingGit(true)
    setError(null)

    try {
      await initGitProject(directory)
      setDiffs([])
      void loadProjectState()
    } catch (err) {
      sessionErrorHandler('init git project', err)
      setError(t('sessionChanges.failedToInitGit'))
    } finally {
      setInitializingGit(false)
    }
  }, [directory, loadProjectState, t])

  const handleSelectFile = useCallback((file: string) => {
    setOpenDiffFiles(prev => (prev.includes(file) ? prev : [...prev, file]))
    setSelectedFile(prev => (prev === file ? prev : file))
  }, [])

  const handleToggleDir = useCallback((path: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }, [])

  const changesTree = useMemo(() => buildChangesTree(diffs), [diffs])

  const handleClosePreview = useCallback(() => {
    setOpenDiffFiles([])
    setSelectedFile(null)
    resetSplitHeight()
  }, [resetSplitHeight])

  const handleActivatePreview = useCallback((file: string) => {
    setSelectedFile(prev => (prev === file ? prev : file))
  }, [])

  const handleClosePreviewTab = useCallback((file: string) => {
    setOpenDiffFiles(prev => {
      const index = prev.indexOf(file)
      if (index === -1) return prev

      const next = prev.filter(item => item !== file)
      setSelectedFile(current => {
        if (current !== file) return current
        return next[Math.min(index, next.length - 1)] ?? null
      })
      return next
    })
  }, [])

  const handleReorderPreviewTabs = useCallback((draggedFile: string, targetFile: string) => {
    setOpenDiffFiles(prev => {
      const draggedIndex = prev.indexOf(draggedFile)
      const targetIndex = prev.indexOf(targetFile)
      if (draggedIndex === -1 || targetIndex === -1 || draggedIndex === targetIndex) return prev

      const next = [...prev]
      const [dragged] = next.splice(draggedIndex, 1)
      next.splice(targetIndex, 0, dragged)
      return next
    })
  }, [])

  const selectedDiff = selectedFile ? diffs.find(d => d.file === selectedFile) : null
  const previewDiffs = useMemo(
    () =>
      openDiffFiles
        .map(file => diffs.find(diff => diff.file === file))
        .filter((diff): diff is FileDiff => Boolean(diff)),
    [diffs, openDiffFiles],
  )
  const mountedPreviewDiffs = useMemo(
    () => previewDiffs.filter(diff => diff.file === selectedFile || mountedPreviewFiles.has(diff.file)),
    [mountedPreviewFiles, previewDiffs, selectedFile],
  )
  const showPreview = !loading && selectedDiff !== null && !(error && diffs.length === 0)

  if (projectLoading && !project) {
    return <div className="p-4 text-center text-text-400 text-[length:var(--fs-sm)]">{t('sessionChanges.loadingChanges')}</div>
  }

  if (!project && error) {
    return <div className="p-4 text-center text-danger-100 text-[length:var(--fs-sm)]">{error}</div>
  }

  if (!project?.vcs) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div className="max-w-xs text-center space-y-3">
          <div className="space-y-1">
            <div className="text-[length:var(--fs-base)] font-medium text-text-200">{t('sessionChanges.noGit')}</div>
            <div className="text-[length:var(--fs-sm)] text-text-400">{t('sessionChanges.noGitHint')}</div>
          </div>
          <button
            onClick={handleInitGit}
            disabled={initializingGit}
            className="inline-flex items-center justify-center rounded px-3 py-1.5 text-[length:var(--fs-sm)] font-medium bg-accent-main-100 text-white hover:bg-accent-main-90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {initializingGit ? t('sessionChanges.initializingGit') : t('sessionChanges.initGit')}
          </button>
          {error && <div className="text-[length:var(--fs-sm)] text-danger-100">{error}</div>}
        </div>
      </div>
    )
  }

  const totalStats = diffs.reduce(
    (acc, d) => ({
      additions: acc.additions + d.additions,
      deletions: acc.deletions + d.deletions,
    }),
    { additions: 0, deletions: 0 },
  )

  const compactFileCountLabel = t('sessionChanges.fileCountCompact', { count: diffs.length })
  const fullFileCountLabel = t('sessionChanges.fileCount', { count: diffs.length })
  const statFadeMaskStyle = {
    WebkitMaskImage: 'linear-gradient(to right, black 0, black calc(100% - 10px), transparent 100%)',
    maskImage: 'linear-gradient(to right, black 0, black calc(100% - 10px), transparent 100%)',
  } as const

  return (
    <div ref={containerRef} className="flex flex-col h-full">
      <div
        ref={listRef}
        className="overflow-hidden flex flex-col shrink-0"
        style={
          {
            '--list-height': listHeight !== null ? `${listHeight}px` : '40%',
            height: showPreview ? 'var(--list-height)' : '100%',
            minHeight: showPreview ? MIN_LIST_HEIGHT : undefined,
          } as React.CSSProperties
        }
      >
        <div className="relative flex h-10 items-center gap-2 px-3 shrink-0 overflow-hidden">
          <div
            className="min-w-0 flex flex-1 overflow-hidden"
            title={`+${totalStats.additions} -${totalStats.deletions} ${fullFileCountLabel}`}
            style={statFadeMaskStyle}
          >
            <div className="inline-flex h-6 min-w-max items-center gap-1.5 whitespace-nowrap text-[length:var(--fs-xxs)] font-mono tabular-nums">
              <span className="text-success-100">+{totalStats.additions}</span>
              <span className="text-danger-100">-{totalStats.deletions}</span>
              <span className="text-text-400">{compactFileCountLabel}</span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <button
              ref={modelMenuTriggerRef}
              type="button"
              onClick={() => setModelMenuOpen(open => !open)}
              aria-label={t('sessionChanges.selectModel')}
              aria-haspopup="menu"
              aria-expanded={modelMenuOpen}
              aria-controls={modelMenuOpen ? modelMenuId : undefined}
              title={selectedModel?.name || t('sessionChanges.selectModel')}
              className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[length:var(--fs-xxs)] transition-colors text-text-400 hover:text-text-100 hover:bg-bg-200/50"
            >
              <span className="truncate max-w-[80px]">{selectedModel?.name || 'Model'}</span>
            </button>

            <DropdownMenu
              triggerRef={modelMenuTriggerRef}
              isOpen={modelMenuOpen}
              position="bottom"
              align="left"
              minWidth="140px"
              maxWidth="min(200px, calc(100vw - 24px))"
              constrainToRef={containerRef}
              className="!rounded-lg !p-1"
            >
              <div
                id={modelMenuId}
                ref={modelMenuRef}
                role="menu"
                aria-label={t('sessionChanges.selectModel')}
                className="space-y-px max-h-[300px] overflow-y-auto"
              >
                {visibleModels.map(model => {
                  const key = getModelKey(model)
                  const isSelected = key === (selectedModelKey || getModelKey(visibleModels[0]))
                  return (
                    <button
                      key={key}
                      type="button"
                      role="menuitemradio"
                      aria-checked={isSelected}
                      onClick={() => handleModelSelect(key)}
                      className={`group flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-[length:var(--fs-xs)] transition-colors ${
                        isSelected
                          ? 'bg-bg-200/70 text-text-100 font-medium'
                          : 'text-text-200 hover:bg-bg-200/60 hover:text-text-100'
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate">{model.name}</span>
                    </button>
                  )
                })}
              </div>
            </DropdownMenu>

            <button
              type="button"
              disabled={committing || !selectedModel || diffs.length === 0}
              onClick={async () => {
                if (!selectedModel) return
                setCommitting(true)
                try {
                  const newSession = await createSession({
                    title: '按修改分批提交git',
                    directory: directory || undefined,
                  })
                  await sendMessageAsync({
                    sessionId: newSession.id,
                    text: '按修改分批提交git',
                    attachments: [],
                    model: {
                      providerID: selectedModel.providerId,
                      modelID: selectedModel.id,
                    },
                    directory: directory || undefined,
                  })
                  navigateToSession(newSession.id, directory)
                } catch (err) {
                  sessionErrorHandler('batch commit', err)
                } finally {
                  setCommitting(false)
                }
              }}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors text-accent-main-100 hover:bg-accent-main-100/10 disabled:opacity-40 disabled:cursor-not-allowed"
              title={t('sessionChanges.batchCommit')}
            >
              <SendIcon size={13} />
            </button>

            <div className="flex shrink-0 items-center bg-bg-200/50 rounded-md overflow-hidden border border-border-200/50">
              <button
                type="button"
                onClick={() => setListMode('flat')}
                aria-pressed={listMode === 'flat'}
                className={`px-2 py-0.5 text-[length:var(--fs-xxs)] transition-colors ${
                  listMode === 'flat' ? 'bg-bg-000 text-text-100 shadow-sm' : 'text-text-400 hover:text-text-200'
                }`}
                title={t('sessionChanges.flatList')}
              >
                {t('sessionChanges.list')}
              </button>
              <button
                type="button"
                onClick={() => setListMode('tree')}
                aria-pressed={listMode === 'tree'}
                className={`px-2 py-0.5 text-[length:var(--fs-xxs)] transition-colors ${
                  listMode === 'tree' ? 'bg-bg-000 text-text-100 shadow-sm' : 'text-text-400 hover:text-text-200'
                }`}
                title={t('sessionChanges.treeView')}
              >
                {t('sessionChanges.tree')}
              </button>
            </div>

            <div className="flex shrink-0 items-center bg-bg-200/50 rounded-md overflow-hidden border border-border-200/50">
              <button
                type="button"
                onClick={() => setViewMode('unified')}
                aria-pressed={viewMode === 'unified'}
                className={`px-2 py-0.5 text-[length:var(--fs-xxs)] transition-colors ${
                  viewMode === 'unified' ? 'bg-bg-000 text-text-100 shadow-sm' : 'text-text-400 hover:text-text-200'
                }`}
              >
                {t('sessionChanges.unified')}
              </button>
              <button
                type="button"
                onClick={() => setViewMode('split')}
                aria-pressed={viewMode === 'split'}
                className={`px-2 py-0.5 text-[length:var(--fs-xxs)] transition-colors ${
                  viewMode === 'split' ? 'bg-bg-000 text-text-100 shadow-sm' : 'text-text-400 hover:text-text-200'
                }`}
              >
                {t('sessionChanges.split')}
              </button>
            </div>

            <button
              type="button"
              onClick={handleRefresh}
              disabled={loading}
              aria-label={t('common:refresh')}
              className="inline-flex h-6 w-6 items-center justify-center text-text-400 hover:text-text-100 hover:bg-bg-200/50 rounded-md transition-colors disabled:opacity-50"
              title={t('common:refresh')}
            >
              <RetryIcon size={12} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
          <div className="pointer-events-none absolute inset-x-3 bottom-0 h-px bg-border-200/30" />
        </div>

        <div className="flex-1 overflow-auto panel-scrollbar-y">
          {loading ? (
            <div className="p-4 text-center text-text-400 text-[length:var(--fs-sm)]">{t('sessionChanges.loadingChanges')}</div>
          ) : error && diffs.length === 0 ? (
            <div className="p-4 text-center text-danger-100 text-[length:var(--fs-sm)]">{error}</div>
          ) : diffs.length === 0 ? (
            <div className="p-4 text-center text-text-400 text-[length:var(--fs-sm)]">{t('sessionChanges.noGitChanges')}</div>
          ) : (
            <div className="py-0.5">
              {listMode === 'tree'
                ? changesTree.map(node => (
                    <ChangesTreeItem
                      key={node.path}
                      node={node}
                      depth={0}
                      expandedDirs={expandedDirs}
                      onSelectFile={handleSelectFile}
                      onToggleDir={handleToggleDir}
                    />
                  ))
                : diffs.map(diff => {
                    const fileStatus = getFileStatus(diff)

                    return (
                      <button
                        key={diff.file}
                        onClick={() => handleSelectFile(diff.file)}
                        className={`
                       w-full min-w-0 flex items-center gap-2 px-3 py-1 text-left
                       hover:bg-bg-200/50 transition-colors text-[length:var(--fs-sm)]
                       text-text-300
                     `}
                      >
                        <img
                          src={getMaterialIconUrl(diff.file, 'file')}
                          alt=""
                          width={16}
                          height={16}
                          className="shrink-0"
                          loading="lazy"
                          decoding="async"
                          onError={e => {
                            e.currentTarget.style.visibility = 'hidden'
                          }}
                        />
                        <span className={`flex-1 min-w-0 font-mono truncate ${FILE_STATUS_COLOR[fileStatus]}`}>
                          {diff.file}
                        </span>
                        <div className="flex items-center gap-2 text-[length:var(--fs-xxs)] font-mono shrink-0">
                          {diff.additions > 0 && <span className="text-success-100">+{diff.additions}</span>}
                          {diff.deletions > 0 && <span className="text-danger-100">-{diff.deletions}</span>}
                        </div>
                      </button>
                    )
                  })}
            </div>
          )}
        </div>
      </div>

      {showPreview && (
        <div
          className={`
            h-1.5 cursor-row-resize shrink-0 relative
            hover:bg-accent-main-100/50 active:bg-accent-main-100 transition-colors
            ${isResizing ? 'bg-accent-main-100' : 'bg-bg-200/60'}
          `}
          onMouseDown={handleResizeStart}
          onTouchStart={handleTouchResizeStart}
        />
      )}

      {showPreview && selectedDiff && (
        <div className="flex-1 flex flex-col min-h-0" style={{ minHeight: MIN_PREVIEW_HEIGHT }}>
          {mountedPreviewDiffs.map(previewDiff => (
            <div key={previewDiff.file} className={previewDiff.file === selectedFile ? 'h-full min-h-0' : 'hidden'}>
              <DiffPreviewPanel
                diff={previewDiff}
                previewDiffs={previewDiffs}
                viewMode={viewMode}
                isResizing={isAnyResizing}
                onActivatePreview={handleActivatePreview}
                onClosePreview={handleClosePreviewTab}
                onReorderPreview={handleReorderPreviewTabs}
                onClose={handleClosePreview}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
})

// ============================================
// Diff Preview Panel - 下方预览区
// ============================================

interface DiffPreviewPanelProps {
  diff: FileDiff
  previewDiffs: FileDiff[]
  viewMode: ViewMode
  isResizing: boolean
  onActivatePreview: (file: string) => void
  onClosePreview: (file: string) => void
  onReorderPreview: (draggedFile: string, targetFile: string) => void
  onClose: () => void
}

const DiffPreviewPanel = memo(function DiffPreviewPanel({
  diff,
  previewDiffs,
  viewMode,
  isResizing,
  onActivatePreview,
  onClosePreview,
  onReorderPreview,
  onClose,
}: DiffPreviewPanelProps) {
  const language = detectLanguage(diff.file) || 'text'
  const { before, after } = useMemo(() => {
    if (diff.patch) return extractContentFromUnifiedDiff(diff.patch)
    if (diff.before !== undefined && diff.after !== undefined) return { before: diff.before, after: diff.after }
    return { before: '', after: '' }
  }, [diff.patch, diff.before, diff.after])
  const diffViewerData = useDiffViewerData(before, after, language, isResizing)
  const { t } = useTranslation(['components', 'common'])
  const [fullscreenOpen, setFullscreenOpen] = useState(false)
  const [fullscreenViewMode, setFullscreenViewMode] = useState<ViewMode>(viewMode)
  const fileName = diff.file.split(/[/\\]/).pop() || diff.file
  const previewTabItems = useMemo<PreviewTabsBarItem[]>(
    () =>
      previewDiffs.map(previewDiff => {
        const currentFileName = previewDiff.file.split(/[/\\]/).pop() || previewDiff.file

        return {
          id: previewDiff.file,
          title: previewDiff.file,
          closeTitle: `${t('common:close')} ${currentFileName}`,
          iconPath: previewDiff.file,
          label: (
            <>
              <span className="block whitespace-nowrap text-[length:var(--fs-xs)] font-mono">{currentFileName}</span>
              <span className="shrink-0 text-[length:var(--fs-xxs)] font-mono text-success-100/90">
                {previewDiff.additions > 0 ? `+${previewDiff.additions}` : ''}
              </span>
              <span className="shrink-0 text-[length:var(--fs-xxs)] font-mono text-danger-100/90">
                {previewDiff.deletions > 0 ? `-${previewDiff.deletions}` : ''}
              </span>
            </>
          ),
        }
      }),
    [previewDiffs, t],
  )

  return (
    <div className="flex flex-col h-full">
      <PreviewTabsBar
        items={previewTabItems}
        activeId={diff.file}
        closeAllTitle={t('common:closeAllTabs')}
        onActivate={onActivatePreview}
        onClose={onClosePreview}
        onCloseAll={onClose}
        onReorder={onReorderPreview}
        tabWidthClassName="w-auto max-w-none min-w-max"
        rightActions={
          <button
            onClick={() => {
              setFullscreenViewMode(viewMode)
              setFullscreenOpen(true)
            }}
            className="p-1 text-text-400 hover:text-text-100 hover:bg-bg-300/50 rounded transition-colors"
            title={t('contentBlock.fullscreen')}
          >
            <MaximizeIcon size={12} />
          </button>
        }
      />

      <div className="flex-1 min-h-0">
        <DiffViewer before={before} after={after} language={language} viewMode={viewMode} isResizing={isResizing} data={diffViewerData} />
      </div>

      <FullscreenViewer
        isOpen={fullscreenOpen}
        onClose={() => setFullscreenOpen(false)}
        title={fileName}
        titleExtra={
          <div className="flex items-center gap-1.5 text-[length:var(--fs-xs)] font-mono tabular-nums shrink-0">
            {diff.additions > 0 && <span className="text-success-100">+{diff.additions}</span>}
            {diff.deletions > 0 && <span className="text-danger-100">-{diff.deletions}</span>}
          </div>
        }
        headerRight={<ViewModeSwitch viewMode={fullscreenViewMode} onChange={setFullscreenViewMode} />}
        deferContent
      >
        <DiffViewer before={before} after={after} language={language} viewMode={fullscreenViewMode} data={diffViewerData} />
      </FullscreenViewer>
    </div>
  )
})

// ============================================
// File Status Helpers
// ============================================

type FileStatus = 'added' | 'modified' | 'deleted'

function getFileStatus(diff: FileDiff): FileStatus {
  if (diff.status) return diff.status as FileStatus
  if (diff.deletions === 0 && diff.additions > 0) return 'added'
  if (diff.additions === 0 && diff.deletions > 0) return 'deleted'
  if (diff.before !== undefined && diff.after !== undefined) {
    if (!diff.before.trim()) return 'added'
    if (!diff.after.trim()) return 'deleted'
  }
  return 'modified'
}

const FILE_STATUS_COLOR: Record<FileStatus, string> = {
  added: 'text-success-100',
  deleted: 'text-danger-100',
  modified: 'text-warning-100',
}

// ============================================
// Changes Tree Data Structure
// ============================================

interface ChangesTreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
  diff?: FileDiff
  children: ChangesTreeNode[]
  additions: number
  deletions: number
  status?: FileStatus
}

function buildChangesTree(diffs: FileDiff[]): ChangesTreeNode[] {
  const root: ChangesTreeNode[] = []

  for (const diff of diffs) {
    const parts = diff.file.split(/[/\\]/).filter(Boolean)
    let currentLevel = root

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isFile = i === parts.length - 1
      const currentPath = parts.slice(0, i + 1).join('/')

      let existing = currentLevel.find(n => n.name === part)

      if (!existing) {
        const status = isFile ? getFileStatus(diff) : undefined
        existing = {
          name: part,
          path: currentPath,
          type: isFile ? 'file' : 'directory',
          diff: isFile ? diff : undefined,
          children: [],
          additions: isFile ? diff.additions : 0,
          deletions: isFile ? diff.deletions : 0,
          status,
        }
        currentLevel.push(existing)
      }

      if (!isFile) {
        existing.additions += diff.additions
        existing.deletions += diff.deletions
        currentLevel = existing.children
      }
    }
  }

  const processNodes = (nodes: ChangesTreeNode[]): ChangesTreeNode[] => {
    return nodes
      .map(n => {
        const processedChildren = processNodes(n.children)
        let dirStatus: FileStatus | undefined = undefined
        if (n.type === 'directory' && processedChildren.length > 0) {
          const hasAdded = processedChildren.some(c => c.status === 'added')
          const hasModified = processedChildren.some(c => c.status === 'modified')
          const hasDeleted = processedChildren.some(c => c.status === 'deleted')
          if (hasAdded) dirStatus = 'added'
          else if (hasModified) dirStatus = 'modified'
          else if (hasDeleted) dirStatus = 'deleted'
        }
        return {
          ...n,
          children: processedChildren,
          status: n.type === 'directory' ? dirStatus : n.status,
        }
      })
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
        return a.name.localeCompare(b.name)
      })
  }

  return processNodes(root)
}

function collectExpandedDirPaths(nodes: ChangesTreeNode[]): Set<string> {
  const allDirPaths = new Set<string>()

  const collectDirs = (entries: ChangesTreeNode[]) => {
    for (const node of entries) {
      if (node.type === 'directory') {
        allDirPaths.add(node.path)
        collectDirs(node.children)
      }
    }
  }

  collectDirs(nodes)
  return allDirPaths
}

// ============================================
// ChangesTreeItem Component
// ============================================

interface ChangesTreeItemProps {
  node: ChangesTreeNode
  depth: number
  expandedDirs: Set<string>
  onSelectFile: (path: string) => void
  onToggleDir: (path: string) => void
}

const ChangesTreeItem = memo(function ChangesTreeItem({
  node,
  depth,
  expandedDirs,
  onSelectFile,
  onToggleDir,
}: ChangesTreeItemProps) {
  const isExpanded = expandedDirs.has(node.path)
  const paddingLeft = 8 + depth * 16

  const statusColor = node.status ? FILE_STATUS_COLOR[node.status] : 'text-text-400'

  if (node.type === 'directory') {
    return (
      <>
        <button
          onClick={() => onToggleDir(node.path)}
          className="w-full min-w-0 flex items-center gap-1.5 py-1 hover:bg-bg-200/50 transition-colors text-[length:var(--fs-sm)] text-text-300"
          style={{ paddingLeft }}
        >
          <ChevronRightIcon size={12} className={`shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
          <img
            src={getMaterialIconUrl(node.path, 'directory', isExpanded)}
            alt=""
            width={16}
            height={16}
            className="shrink-0"
            loading="lazy"
            decoding="async"
            onError={e => {
              e.currentTarget.style.visibility = 'hidden'
            }}
          />
          <span className={`flex-1 min-w-0 font-mono truncate ${statusColor}`}>{node.name}</span>
          <div className="flex items-center gap-2 text-[length:var(--fs-xxs)] font-mono shrink-0">
            {node.additions > 0 && <span className="text-success-100">+{node.additions}</span>}
            {node.deletions > 0 && <span className="text-danger-100">-{node.deletions}</span>}
          </div>
        </button>

        {isExpanded &&
          node.children.map(child => (
            <ChangesTreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              expandedDirs={expandedDirs}
              onSelectFile={onSelectFile}
              onToggleDir={onToggleDir}
            />
          ))}
      </>
    )
  }

  return (
    <button
      onClick={() => onSelectFile(node.path)}
      className="w-full min-w-0 flex items-center gap-2 py-1 hover:bg-bg-200/50 transition-colors text-[length:var(--fs-sm)] text-text-300"
      style={{ paddingLeft }}
    >
      <img
        src={getMaterialIconUrl(node.path, 'file')}
        alt=""
        width={16}
        height={16}
        className="shrink-0"
        loading="lazy"
        decoding="async"
        onError={e => {
          e.currentTarget.style.visibility = 'hidden'
        }}
      />
      <span className={`flex-1 min-w-0 font-mono truncate ${statusColor}`}>{node.name}</span>
      <div className="flex items-center gap-2 text-[length:var(--fs-xxs)] font-mono shrink-0">
        {node.additions > 0 && <span className="text-success-100">+{node.additions}</span>}
        {node.deletions > 0 && <span className="text-danger-100">-{node.deletions}</span>}
      </div>
    </button>
  )
})
