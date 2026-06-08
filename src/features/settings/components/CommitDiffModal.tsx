import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog } from '../../../components/ui/Dialog'
import { Button } from '../../../components/ui/Button'
import { GitCommitIcon, GitBranchIcon } from '../../../components/Icons'
import { InteractivePtySession } from '../../../utils/runViaPty'
import { stripAnsi } from '../../../utils/ansiUtils'
import { isTauri } from '../../../utils/tauri'

interface CommitInfo {
  hash: string
  message: string
}

interface BranchDiff {
  label: string
  commits: CommitInfo[]
  error: string | null
}

interface CommitDiffModalProps {
  isOpen: boolean
  onClose: () => void
  sourcePath: string
}

const DIFF_COMMANDS: { cmd: string; args: string[] }[] = [
  { cmd: 'git', args: ['--no-pager', 'log', '--oneline', '--no-decorate', 'dev-cli..dev'] },
]

const DIFF_LABELS = ['dev-cli → dev']



function extractCommitLines(raw: string): CommitInfo[] {
  const clean = stripAnsi(raw)
  const lines = clean.split(/\r?\n/)
  const seen = new Set<string>()
  const commits: CommitInfo[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const match = trimmed.match(/^([a-f0-9]{7,40})\s(.+)$/)
    if (match && !seen.has(match[1])) {
      seen.add(match[1])
      commits.push({ hash: match[1], message: match[2] })
    }
  }
  return commits
}

export function CommitDiffModal({ isOpen, onClose, sourcePath }: CommitDiffModalProps) {
  const { t } = useTranslation(['settings'])
  const [diffs, setDiffs] = useState<BranchDiff[]>([])
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [terminalLines, setTerminalLines] = useState<string[]>([])
  const [activeCommand, setActiveCommand] = useState(-1)
  const [mergeLoading, setMergeLoading] = useState(false)
  const [mergeError, setMergeError] = useState<string | null>(null)
  const [buildLoading, setBuildLoading] = useState(false)
  const [buildError, setBuildError] = useState<string | null>(null)
  const cancelRef = useRef<(() => void) | null>(null)
  const mergeCancelRef = useRef<(() => void) | null>(null)
  const buildCancelRef = useRef<(() => void) | null>(null)
  const terminalRef = useRef<HTMLDivElement>(null)
  const lineBufRef = useRef<string[]>([])

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (terminalRef.current) {
        terminalRef.current.scrollTop = terminalRef.current.scrollHeight
      }
    })
  }, [])

  const addToTerminal = useCallback((text: string) => {
    const lines = text.split('\n')
    for (const line of lines) {
      lineBufRef.current.push(line)
    }
    setTerminalLines([...lineBufRef.current])
    scrollToBottom()
  }, [scrollToBottom])

  const fetchDiffs = useCallback(async () => {
    if (!sourcePath.trim()) return
    setLoading(true)
    setFetchError(null)
    setDiffs([])
    setTerminalLines([])
    setActiveCommand(-1)
    lineBufRef.current = []

    const session = new InteractivePtySession(sourcePath, { timeout: 120000 })
    session.onOutput = text => addToTerminal(text)
    cancelRef.current = () => session.close()

    let oldHead: string | null = null

    try {
      await session.connect()

      // old-head
      addToTerminal('$ git rev-parse dev\n')
      const { output: headOut } = await session.exec('git rev-parse dev')
      oldHead = headOut.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
        .find(l => /^[a-f0-9]{40}$/i.test(l)) || null
      addToTerminal(`[旧 HEAD] ${oldHead ?? '不存在'}\n`)

      // fetch
      addToTerminal('$ git fetch upstream --force\n')
      const { output: fetchOut } = await session.exec('git fetch upstream --force')
      if (/fatal:|error:|could not/i.test(fetchOut)) {
        setFetchError('Fetch 失败，请查看终端输出')
        return
      }

      // update-dev
      addToTerminal('$ git branch -f dev upstream/dev\n')
      const { output: updateOut } = await session.exec('git branch -f dev upstream/dev')
      if (/fatal:|error:|could not/i.test(updateOut)) {
        setFetchError('更新本地 dev 分支失败')
        return
      }

      // new-head
      addToTerminal('$ git rev-parse dev\n')
      const { output: newHeadOut } = await session.exec('git rev-parse dev')
      if (/fatal:|error:|could not/i.test(newHeadOut)) {
        setFetchError('获取新 HEAD 失败')
        return
      }
      const newHead = newHeadOut.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
        .find(l => /^[a-f0-9]{40}$/i.test(l)) || null
      addToTerminal(`[新 HEAD] ${newHead ?? '不存在'}\n`)

      if (oldHead === newHead) {
        addToTerminal('[跳过] dev 无变化，跳过推送\n')
      } else {
        addToTerminal('[推送] dev 已更新，推送到 origin/dev\n')
        const { output: pushOut } = await session.exec('git push origin dev --no-verify')
        if (/fatal:|error:|! \[rejected\]/i.test(pushOut)) {
          setFetchError('推送失败，请查看终端输出')
          return
        }
      }

      // diff
      const { output: diffOut } = await session.exec(`${DIFF_COMMANDS[0].cmd} ${DIFF_COMMANDS[0].args.join(' ')}`)
      const commits = extractCommitLines(diffOut)
      console.log(`[CommitDiff] dev-cli → dev: ${commits.length} commits`)
      if (commits.length > 0) {
        console.log(`[CommitDiff]   first: ${commits[0].hash} ${commits[0].message}`)
        console.log(`[CommitDiff]   last:  ${commits[commits.length - 1].hash} ${commits[commits.length - 1].message}`)
      }
      setDiffs([{ label: 'dev-cli → dev', commits, error: null }])
      setActiveCommand(1)
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : '执行失败')
    } finally {
      setLoading(false)
      session.close()
    }
  }, [sourcePath, addToTerminal])

  const openVSCode = useCallback((error: string) => {
    const vscodeUri = `vscode://file/${sourcePath.replace(/\\/g, '/')}?windowId=_blank`
    addToTerminal(`\n[错误] ${error}\n`)
    if (isTauri()) {
      import('@tauri-apps/plugin-opener')
        .then(mod => mod.openUrl(vscodeUri))
        .catch(() => window.open(vscodeUri))
    } else {
      window.open(vscodeUri)
    }
  }, [sourcePath, addToTerminal])

  const handleBuild = useCallback(async () => {
    if (!sourcePath.trim()) return
    setBuildLoading(true)
    setBuildError(null)
    addToTerminal('\n========== 开始构建 ==========\n')

    const session = new InteractivePtySession(sourcePath, { timeout: 600000 })
    session.onOutput = text => addToTerminal(text)
    buildCancelRef.current = () => session.close()

    try {
      await session.connect()

      addToTerminal('$ opencode --version\n')
      const { output: versionOut } = await session.exec('opencode --version')
      const savedVersion = versionOut.split(/\r?\n/).map(l => l.trim()).filter(Boolean).pop() || ''
      addToTerminal(`[版本] ${savedVersion}\n`)

      addToTerminal('$ bun install\n')
      const { output: bunOut } = await session.exec('bun install')
      if (/error|ERR_PNPM|ELIFECYCLE/i.test(bunOut)) {
        setBuildError('bun install 失败')
        return
      }

      const exePath = 'packages\\opencode\\dist\\opencode-windows-x64\\bin\\opencode.exe'
      if (savedVersion) {
        addToTerminal(`$ move -Force ${exePath} ${exePath}.${savedVersion}\n`)
        const { output: backupOut } = await session.exec(`move -Force ${exePath} ${exePath}.${savedVersion}`)
        if (/error:|could not|The process cannot/i.test(backupOut) && !/The system cannot find the file/i.test(backupOut)) {
          setBuildError('备份 exe 失败')
          return
        }
      } else {
        addToTerminal('[跳过] 版本号为空，跳过备份\n')
      }

      addToTerminal('$ bun run build --single\n')
      const { output: buildOut } = await session.exec('bun run ./packages/opencode/script/build.ts --single')
      if (/error:|ELIFECYCLE|Build failed|FAILED/i.test(buildOut)) {
        setBuildError('构建失败，请查看终端输出')
        return
      }

      addToTerminal('$ git push origin dev-cli --no-verify\n')
      const { output: pushOut } = await session.exec('git push origin dev-cli --no-verify')
      if (/fatal:|error:|! \[rejected\]/i.test(pushOut)) {
        setBuildError('推送 dev-cli 到 origin 失败')
        return
      }

      addToTerminal('\n========== 构建完成 ==========\n')
    } catch (err) {
      setBuildError(err instanceof Error ? err.message : '构建失败')
    } finally {
      setBuildLoading(false)
      session.close()
    }
  }, [sourcePath, addToTerminal])

  const handleMerge = useCallback(async () => {
    if (!sourcePath.trim()) return
    setMergeLoading(true)
    setMergeError(null)
    setFetchError(null)
    addToTerminal('\n========== 合并 dev → dev-cli ==========\n')

    const session = new InteractivePtySession(sourcePath, { timeout: 300000 })
    session.onOutput = text => addToTerminal(text)
    mergeCancelRef.current = () => session.close()

    try {
      await session.connect()

      addToTerminal('$ git status --porcelain\n')
      const { output: statusOut } = await session.exec('git status --porcelain')
      const modifiedLines = statusOut.split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => /^(?:[MADRCU?! ][MADRCU?! ])\s/.test(l))
      if (modifiedLines.length > 0) {
        openVSCode('dev-cli 有未提交的修改，请先提交或 stash')
        return
      }

      addToTerminal('$ git merge dev --no-ff\n')
      const { output: mergeOut } = await session.exec('git merge dev --no-ff')
      if (/CONFLICT|fatal:|error:|could not/i.test(mergeOut)) {
        openVSCode('合并冲突，请手动解决')
        return
      }

      addToTerminal('[完成] 合并成功，继续构建...\n')
      session.close()
      setMergeLoading(false)
      handleBuild()
      return
    } catch (err) {
      setMergeError(err instanceof Error ? err.message : '合并失败')
    } finally {
      setMergeLoading(false)
      session.close()
    }
  }, [sourcePath, addToTerminal, openVSCode, handleBuild])

  useEffect(() => {
    if (isOpen && !cancelRef.current) {
      const id = setTimeout(fetchDiffs, 0)
      return () => clearTimeout(id)
    }
    if (!isOpen) {
      cancelRef.current?.()
      cancelRef.current = null
      mergeCancelRef.current?.()
      mergeCancelRef.current = null
      buildCancelRef.current?.()
      buildCancelRef.current = null
    }
  }, [isOpen, fetchDiffs])

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title={t('about.commitDiffTitle') || 'Branch Commit Diff'} width={1024} allowBackdropClose={false}>
      <div className="flex gap-4 min-h-[360px]">
        <div className="flex-1 flex flex-col min-w-0">
          <div className="text-xs font-medium text-text-400 mb-1.5 uppercase tracking-wider">Terminal</div>
          <div
            ref={terminalRef}
            className="flex-1 rounded-lg border border-border-200/50 bg-[#1a1a1a] p-3 overflow-auto font-mono text-xs leading-relaxed whitespace-pre"
            style={{ maxHeight: '55vh', minHeight: 200 }}
          >
            {terminalLines.length === 0 && !loading && !mergeLoading && !buildLoading && !fetchError && !mergeError && !buildError && (
              <span className="text-text-500">Waiting...</span>
            )}
            {terminalLines.map((line, i) => {
              const trimmed = line.trim()
              const isCmdLine = /^\$ (git |bun |opencode |move )/.test(trimmed) || trimmed.includes('echo ___CMD_END___')
              const isMarker = trimmed.includes('___CMD_END___')
              const isContinuation = trimmed === '>>' || trimmed.startsWith('>> ')
              const isBanner = /^(Microsoft Windows|\(c\) Microsoft|保留)/.test(trimmed) || /^[A-Z]:\\.+>$/.test(trimmed)
              const isBlank = !trimmed
              const isErrorLine = (fetchError || mergeError || buildError) && i === terminalLines.length - 1
              return (
                <div
                  key={i}
                  className={
                    isMarker || isContinuation || isBanner || isBlank ? 'hidden' :
                    isCmdLine ? 'text-cyan-400' :
                    isErrorLine ? 'text-red-400' :
                    'text-gray-300'
                  }
                >
                  {line || '\u00A0'}
                </div>
              )
            })}
            {(loading || mergeLoading || buildLoading) && (
              <div className="text-gray-500 animate-pulse mt-1">▌</div>
            )}
          </div>
        </div>

        <div className="w-[1px] bg-border-200/30 self-stretch" />

        <div className="flex-1 flex flex-col min-w-0">
          <div className="text-xs font-medium text-text-400 mb-1.5 uppercase tracking-wider">Commits</div>
          <div className="flex-1 overflow-auto space-y-2" style={{ maxHeight: '55vh' }}>
            {fetchError && !loading && (
              <div className="rounded-lg border border-danger-100/20 bg-danger-100/10 px-3 py-2 text-xs text-danger-100">
                {fetchError}
              </div>
            )}

            {mergeError && !mergeLoading && (
              <div className="rounded-lg border border-danger-100/20 bg-danger-100/10 px-3 py-2 text-xs text-danger-100">
                {mergeError}
              </div>
            )}

            {buildError && !buildLoading && (
              <div className="rounded-lg border border-danger-100/20 bg-danger-100/10 px-3 py-2 text-xs text-danger-100">
                {buildError}
              </div>
            )}

            {!loading && !fetchError && diffs.length === 0 && terminalLines.length > 0 && !mergeLoading && !buildLoading && (
              <div className="text-text-400 text-xs py-4 text-center">
                {t('about.commitDiffEmpty') || 'No differences found between branches.'}
              </div>
            )}

            {DIFF_LABELS.map((label, i) => {
              const diff = diffs.find(d => d.label === label)
              const isActive = i <= activeCommand
              return (
                <div
                  key={label}
                  className={`rounded-lg border transition-opacity ${
                    isActive ? 'border-border-200/50 bg-bg-000/35' : 'border-border-200/20 bg-bg-000/15 opacity-40'
                  }`}
                >
                  <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-border-200/30">
                    <GitBranchIcon size={12} className="text-text-400 shrink-0" />
                    <span className="text-xs font-medium text-text-100 truncate">{label}</span>
                    {diff && (
                      <span className="text-[10px] text-text-400 ml-auto shrink-0">
                        {diff.commits.length} commit{diff.commits.length !== 1 ? 's' : ''}
                      </span>
                    )}
                    {!diff && isActive && loading && (
                      <span className="text-[10px] text-text-400 ml-auto shrink-0 animate-pulse">...</span>
                    )}
                  </div>
                  {diff?.error && (
                    <div className="px-2.5 py-1.5 text-[10px] text-danger-100">{diff.error}</div>
                  )}
                  {diff?.commits && diff.commits.length > 0 && (
                    <div className="divide-y divide-border-200/20">
                      {diff.commits.map(commit => (
                        <div key={commit.hash} className="flex items-start gap-1.5 px-2.5 py-1 hover:bg-bg-100/30">
                          <GitCommitIcon size={10} className="text-text-400 mt-0.5 shrink-0" />
                          <code className="text-[10px] font-mono text-accent-main-100 shrink-0">{commit.hash}</code>
                          <span className="text-[10px] text-text-300">{commit.message}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border-200/30">
        <Button size="sm" variant="primary" isLoading={mergeLoading} disabled={loading || mergeLoading || buildLoading} onClick={handleMerge}>
          Merge dev → dev-cli
        </Button>
        <Button size="sm" variant="secondary" isLoading={buildLoading} disabled={loading || mergeLoading || buildLoading} onClick={handleBuild}>
          Build & Push
        </Button>
        <div className="flex-1" />
        {loading && <span className="text-xs text-text-400">{t('about.commitDiffLoading') || 'Executing...'}</span>}
        {mergeLoading && <span className="text-xs text-text-400">Merging...</span>}
        {buildLoading && <span className="text-xs text-text-400">Building...</span>}
        <Button size="sm" variant="secondary" isLoading={loading} disabled={loading || mergeLoading || buildLoading} onClick={fetchDiffs}>
          {t('common:refresh') || 'Refresh'}
        </Button>
        <Button size="sm" variant="ghost" disabled={mergeLoading || buildLoading} onClick={onClose}>
          {t('common:close') || 'Close'}
        </Button>
      </div>
    </Dialog>
  )
}
