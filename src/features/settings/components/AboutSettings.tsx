import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/ui/Button'
import { DownloadIcon, ExternalLinkIcon, RetryIcon, UploadIcon } from '../../../components/Icons'
import {
  compareVersions,
  normalizeVersion,
  hasUpdateAvailable,
  updateStore,
  useUpdateStore,
  RELEASES_PAGE_URL,
} from '../../../store/updateStore'
import { serverStore } from '../../../store/serverStore'
import { useServerStore } from '../../../hooks/useServerStore'
import { upgradeOpencode, type UpgradeResult } from '../../../api'
import { saveData } from '../../../utils/downloadUtils'
import { exportSettingsBackup, importSettingsBackup, previewBackupMeta } from '../../../utils/settingsBackup'
import { isTauri } from '../../../utils/tauri'
import { SettingsCard, SettingsSection } from './SettingsUI'
import { CommitDiffModal } from './CommitDiffModal'
import { clientDataStorage } from '../../../lib/clientDataStorage'

const OPENCODE_CLI_RELEASES_API = 'https://api.github.com/repos/anomalyco/opencode/releases/latest'
const OPENCODE_CLI_RELEASES_PAGE = 'https://github.com/anomalyco/opencode/releases/latest'

async function openExternalUrl(url: string): Promise<void> {
  if (isTauri()) {
    await import('@tauri-apps/plugin-opener')
      .then(mod => mod.openUrl(url))
      .catch(() => window.open(url, '_blank', 'noopener,noreferrer'))
    return
  }

  window.open(url, '_blank', 'noopener,noreferrer')
}

export function AboutSettings() {
  const { t } = useTranslation(['settings'])
  const updateState = useUpdateStore()
  const hasUpdate = hasUpdateAvailable(updateState)
  const latestRelease = updateState.latestRelease
  const latestVersion = latestRelease?.tagName || t('about.unknownVersion')
  const releaseDate = latestRelease?.publishedAt ? new Date(latestRelease.publishedAt).toLocaleString() : null
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [backupBusy, setBackupBusy] = useState<'export' | 'import' | null>(null)
  const [backupError, setBackupError] = useState<string | null>(null)

  const handleCheckUpdates = useCallback(() => {
    void updateStore.checkForUpdates({ force: true })
  }, [])

  const handleOpenRelease = useCallback(() => {
    const targetUrl = latestRelease?.url || RELEASES_PAGE_URL
    updateStore.hideToastForCurrentVersion()
    void openExternalUrl(targetUrl)
  }, [latestRelease?.url])

  const { activeServer, getHealth, checkHealth } = useServerStore()
  const activeHealth = activeServer ? getHealth(activeServer.id) : null
  const cliVersion = activeHealth?.version ?? null
  const cliConnected = activeHealth?.status === 'online'
  const [cliUpgradeBusy, setCliUpgradeBusy] = useState(false)
  const [cliUpgradeResult, setCliUpgradeResult] = useState<UpgradeResult | null>(null)
  const [cliUpgradingWait, setCliUpgradingWait] = useState(false)
  const [cliLatestVersion, setCliLatestVersion] = useState<string | null>(null)
  const [cliCheckingUpdate, setCliCheckingUpdate] = useState(false)
  const [cliUpdateError, setCliUpdateError] = useState<string | null>(null)
  const [cliUpdateChecked, setCliUpdateChecked] = useState(false)
  const [cliSourcePath, setCliSourcePath] = useState(() => clientDataStorage.getItem('opencode-cli-source-path') ?? '')
  const [commitDiffModalOpen, setCommitDiffModalOpen] = useState(false)

  // 持久化 source_path 到云端 + localStorage
  useEffect(() => {
    clientDataStorage.setItem('opencode-cli-source-path', cliSourcePath)
  }, [cliSourcePath])

  const handleCheckCliHealth = useCallback(() => {
    if (activeServer) {
      checkHealth(activeServer.id)
    }
  }, [activeServer, checkHealth])

  const handleCheckCliUpdates = useCallback(async () => {
    if (!cliVersion || cliCheckingUpdate) return

    if (cliSourcePath.trim()) {
      setCommitDiffModalOpen(true)
      return
    }

    setCliCheckingUpdate(true)
    setCliUpdateError(null)
    setCliUpdateChecked(true)
    try {
      const response = await fetch(OPENCODE_CLI_RELEASES_API, {
        headers: { Accept: 'application/vnd.github+json' },
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload: unknown = await response.json()
      if (typeof payload === 'object' && payload && typeof (payload as Record<string, unknown>).tag_name === 'string') {
        const tagName = (payload as Record<string, unknown>).tag_name as string
        setCliLatestVersion(tagName.replace(/^v/i, ''))
      } else {
        throw new Error('Invalid release payload')
      }
    } catch (error) {
      setCliUpdateError(error instanceof Error ? error.message : 'Failed to check CLI updates')
    } finally {
      setCliCheckingUpdate(false)
    }
  }, [cliVersion, cliCheckingUpdate, cliSourcePath])

  const handleOpenCliReleases = useCallback(() => {
    void openExternalUrl(OPENCODE_CLI_RELEASES_PAGE)
  }, [])

  const isLocalProject = !!cliSourcePath.trim()
  const cliHasUpdate = !isLocalProject && !!(cliVersion && cliLatestVersion && compareVersions(cliLatestVersion, cliVersion) > 0)

  let cliUpdateStatusText: string | null = null
  if (cliCheckingUpdate) {
    cliUpdateStatusText = t('about.cliUpdateChecking')
  } else if (cliUpdateError) {
    cliUpdateStatusText = t('about.cliUpdateError', { error: cliUpdateError })
  } else if (cliHasUpdate) {
    cliUpdateStatusText = t('about.cliUpdateAvailable', { version: `v${cliLatestVersion}` })
  } else if (cliUpdateChecked && cliLatestVersion) {
    cliUpdateStatusText = t('about.cliUpToDate')
  }

  const handleUpgradeCli = useCallback(async () => {
    if (!activeServer || cliUpgradeBusy) return
    setCliUpgradeBusy(true)
    setCliUpgradeResult(null)
    try {
      const result = await upgradeOpencode({ sourcePath: cliSourcePath })
      setCliUpgradeResult(result)

      if (result.success) {
        setCliUpgradingWait(true)
        // 升级后 serve 可能重启，轮询等待新版本出现
        for (let attempt = 0; attempt < 15; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 2000))
          const health = await serverStore.checkHealth(activeServer.id)
          if (health.version && compareVersions(health.version, normalizeVersion(cliVersion ?? '')) > 0) {
            break
          }
        }
        setCliUpgradingWait(false)
      }
    } catch (error) {
      setCliUpgradeResult({ success: false, error: error instanceof Error ? error.message : 'Unknown error' })
    } finally {
      setCliUpgradeBusy(false)
    }
  }, [activeServer, cliUpgradeBusy, cliSourcePath, cliVersion])

  const handleExportBackup = useCallback(async () => {
    setBackupError(null)
    setBackupBusy('export')
    try {
      const { fileName, data } = await exportSettingsBackup()
      saveData(data, fileName, 'application/json;charset=utf-8')
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : t('about.backupExportFailed'))
    } finally {
      setBackupBusy(null)
    }
  }, [t])

  const handleImportClick = useCallback(() => {
    setBackupError(null)
    fileInputRef.current?.click()
  }, [])

  const handleImportBackup = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) return

      setBackupError(null)
      setBackupBusy('import')

      try {
        const { createdAt } = await previewBackupMeta(file)
        const confirmed = window.confirm(
          createdAt
            ? t('about.backupImportConfirmWithDate', { date: new Date(createdAt).toLocaleString() })
            : t('about.backupImportConfirm'),
        )
        if (!confirmed) return

        await importSettingsBackup(file)
        window.location.reload()
      } catch (error) {
        setBackupError(error instanceof Error ? error.message : t('about.backupImportFailed'))
      } finally {
        setBackupBusy(null)
      }
    },
    [t],
  )

  let statusText = t('about.statusIdle')
  if (updateState.checking) {
    statusText = t('about.statusChecking')
  } else if (updateState.error) {
    statusText = t('about.statusError', { error: updateState.error })
  } else if (hasUpdate) {
    statusText = t('about.statusUpdateAvailable', { version: latestVersion })
  } else if (latestRelease) {
    statusText = t('about.statusUpToDate')
  }

  return (
    <div className="space-y-7">
      <SettingsSection title={t('about.title')}>
        <SettingsCard title={t('about.versionCardTitle')} description={t('about.versionCardDesc')}>
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-border-200/50 bg-bg-000/35 px-3 py-2.5">
                <div className="text-[length:var(--fs-xs)] text-text-400 mb-1">{t('about.currentVersion')}</div>
                <div className="text-[length:var(--fs-base)] font-semibold text-text-100 font-mono">
                  v{updateState.currentVersion}
                </div>
              </div>
              <div className="rounded-lg border border-border-200/50 bg-bg-000/35 px-3 py-2.5">
                <div className="text-[length:var(--fs-xs)] text-text-400 mb-1">{t('about.latestVersion')}</div>
                <div className="text-[length:var(--fs-base)] font-semibold text-text-100 font-mono">
                  {latestVersion}
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-border-200/50 bg-bg-100/35 px-3 py-3 text-[length:var(--fs-sm)] text-text-300 leading-relaxed">
              <div className="font-medium text-text-100">{statusText}</div>
              {releaseDate && <div className="mt-1 text-text-400">{t('about.publishedAt', { date: releaseDate })}</div>}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" isLoading={updateState.checking} onClick={handleCheckUpdates}>
                {!updateState.checking && <RetryIcon size={12} />}
                {t('about.checkNow')}
              </Button>
              <Button size="sm" variant="ghost" onClick={handleOpenRelease}>
                <ExternalLinkIcon size={12} />
                {hasUpdate ? t('about.viewUpdate') : t('about.openReleases')}
              </Button>
            </div>
          </div>
        </SettingsCard>

        <SettingsCard title={t('about.cliCardTitle')} description={t('about.cliCardDesc')}>
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-border-200/50 bg-bg-000/35 px-3 py-2.5">
                <div className="text-[length:var(--fs-xs)] text-text-400 mb-1">{t('about.cliVersion')}</div>
                <div className="text-[length:var(--fs-base)] font-semibold text-text-100 font-mono">
                  {cliVersion ? `v${cliVersion}` : '—'}
                </div>
              </div>
              <div className="rounded-lg border border-border-200/50 bg-bg-000/35 px-3 py-2.5">
                <div className="text-[length:var(--fs-xs)] text-text-400 mb-1">
                  {isLocalProject ? t('about.cliLocalDiff') : t('about.cliLatestRelease')}
                </div>
                <div className="text-[length:var(--fs-base)] font-semibold text-text-100 font-mono">
                  {isLocalProject ? '—' : (cliLatestVersion ? `v${cliLatestVersion}` : '—')}
                </div>
              </div>
              <div className="rounded-lg border border-border-200/50 bg-bg-000/35 px-3 py-2.5">
                <div className="text-[length:var(--fs-xs)] text-text-400 mb-1">{t('about.cliStatus')}</div>
                <div className="text-[length:var(--fs-base)] font-semibold text-text-100 font-mono flex items-center gap-1.5">
                  <span
                    className={`inline-block w-2 h-2 rounded-full ${
                      cliConnected ? 'bg-green-500' : 'bg-text-400'
                    }`}
                  />
                  {cliConnected ? t('about.cliStatusOnline') : t('about.cliStatusOffline')}
                </div>
              </div>
            </div>

            {/* 本地源码路径输入框 */}
            <div>
              <label className="block text-[length:var(--fs-xs)] font-medium text-text-300 mb-1">
                {t('about.cliSourcePath')}
              </label>
              <input
                type="text"
                value={cliSourcePath}
                onChange={e => setCliSourcePath(e.target.value)}
                placeholder={t('about.cliSourcePathPlaceholder')}
                className="w-full h-8 px-3 text-[length:var(--fs-md)] bg-bg-000 border border-border-200 rounded-md focus:outline-none focus:border-accent-main-100/50 text-text-100 placeholder:text-text-400"
              />
            </div>

            {cliUpdateStatusText && !isLocalProject && (
              <div
                className={`rounded-lg border px-3 py-3 text-[length:var(--fs-sm)] leading-relaxed ${
                  cliHasUpdate
                    ? 'border-accent-main-100/20 bg-accent-main-100/5 text-accent-main-100'
                    : cliUpdateError
                      ? 'border-danger-100/20 bg-danger-100/10 text-danger-100'
                      : 'border-border-200/50 bg-bg-100/35 text-text-300'
                }`}
              >
                <div className="font-medium text-text-100">{cliUpdateStatusText}</div>
              </div>
            )}

            {(cliUpgradeResult || cliUpgradingWait) && (
              <div
                className={`rounded-lg border px-3 py-3 text-[length:var(--fs-sm)] leading-relaxed ${
                  cliUpgradingWait
                    ? 'border-accent-main-100/20 bg-accent-main-100/5 text-accent-main-100'
                    : cliUpgradeResult?.success
                      ? 'border-green-500/20 bg-green-500/10 text-green-600'
                      : 'border-danger-100/20 bg-danger-100/10 text-danger-100'
                }`}
              >
                {cliUpgradingWait
                  ? t('about.cliUpgradingWait')
                  : cliUpgradeResult?.success
                    ? t('about.cliUpgradeSuccess', { version: cliUpgradeResult.version })
                    : t('about.cliUpgradeFailed', { error: cliUpgradeResult?.error ?? '' })}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                isLoading={cliUpgradeBusy || cliUpgradingWait}
                disabled={!cliConnected || !cliHasUpdate || cliUpgradeBusy || cliUpgradingWait}
                onClick={handleUpgradeCli}
              >
                {t('about.cliUpgradeNow')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                isLoading={cliCheckingUpdate}
                disabled={isLocalProject ? !cliSourcePath.trim() : (!cliConnected || cliCheckingUpdate)}
                onClick={handleCheckCliUpdates}
              >
                {!cliCheckingUpdate && <RetryIcon size={12} />}
                {isLocalProject ? (t('about.cliViewDiff') || 'View Diff') : t('about.cliCheckUpdates')}
              </Button>
              {cliLatestVersion && (
                <Button size="sm" variant="ghost" onClick={handleOpenCliReleases}>
                  <ExternalLinkIcon size={12} />
                  {t('about.openReleases')}
                </Button>
              )}
              <Button size="sm" variant="ghost" disabled={!activeServer} onClick={handleCheckCliHealth}>
                {t('about.cliRefresh')}
              </Button>
            </div>
          </div>
        </SettingsCard>

        <SettingsCard title={t('about.backupCardTitle')} description={t('about.backupCardDesc')}>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleImportBackup}
            className="hidden"
          />
          <div className="space-y-4">
            <div className="rounded-lg border border-border-200/50 bg-bg-100/35 px-3 py-3 text-[length:var(--fs-sm)] text-text-300 leading-relaxed">
              {t('about.backupWarning')}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" isLoading={backupBusy === 'export'} onClick={handleExportBackup}>
                {backupBusy !== 'export' && <DownloadIcon size={12} />}
                {t('about.exportBackup')}
              </Button>
              <Button size="sm" variant="ghost" isLoading={backupBusy === 'import'} onClick={handleImportClick}>
                {backupBusy !== 'import' && <UploadIcon size={12} />}
                {t('about.importBackup')}
              </Button>
            </div>

            {backupError && (
              <div className="rounded-lg border border-danger-100/20 bg-danger-100/10 px-3 py-2 text-[length:var(--fs-sm)] text-danger-100 leading-relaxed">
                {backupError}
              </div>
            )}
          </div>
        </SettingsCard>
      </SettingsSection>

      <CommitDiffModal
        isOpen={commitDiffModalOpen}
        onClose={() => setCommitDiffModalOpen(false)}
        sourcePath={cliSourcePath}
      />
    </div>
  )
}
