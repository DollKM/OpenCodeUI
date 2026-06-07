import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog } from '../../../components/ui/Dialog'
import { Button } from '../../../components/ui/Button'
import { GitCommitIcon, GitBranchIcon } from '../../../components/Icons'
import { createPtySession, getPtyConnectUrl, removePtySession } from '../../../api/pty'
import { parsePtyFrame } from '../../../utils/ptyProtocol'
import { stripAnsi } from '../../../utils/ansiUtils'
import { isTauri } from '../../../utils/tauri'
import type { InteractiveCommand } from '../../../utils/runViaPty'

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

const DIFF_COMMANDS: InteractiveCommand[] = [
  { cmd: 'git', args: ['--no-pager', 'log', '--oneline', '--no-decorate', 'dev-cli..dev'] },
]

const DIFF_LABELS = ['dev-cli → dev']

const MAX_TERMINAL_LINES = 500

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
  const cancelRef = useRef<(() => void) | null>(null)
  const mergeCancelRef = useRef<(() => void) | null>(null)
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
      if (lineBufRef.current.length >= MAX_TERMINAL_LINES) {
        lineBufRef.current.shift()
      }
      lineBufRef.current.push(line)
    }
    setTerminalLines([...lineBufRef.current])
    scrollToBottom()
  }, [scrollToBottom])

  const fetchDiffs = useCallback(() => {
    if (!sourcePath.trim()) return
    setLoading(true)
    setFetchError(null)
    setDiffs([])
    setTerminalLines([])
    setActiveCommand(-1)
    lineBufRef.current = []

    let ws: WebSocket | null = null
    let timer: ReturnType<typeof setTimeout>
    let closed = false
    let ptyId: string | null = null
    const SEP = '___CMD_END___'

    let phase: 'old-head' | 'fetch' | 'update-dev' | 'new-head' | 'push' | 'diff' | 'done' = 'old-head'
    let oldHead: string | null = null
    let cmdBuffer = ''
    let markerIdx = 0

    const cleanup = () => {
      if (closed) return
      closed = true
      clearTimeout(timer)
      ws?.close()
      if (ptyId) removePtySession(ptyId, sourcePath).catch(() => {})
    }

    const abort = () => {
      cleanup()
    }

    const sendNext = (cmd: string, args: string[]) => {
      const cur = markerIdx++
      const cmdText = `${cmd} ${args.join(' ')}`
      addToTerminal(`$ ${cmdText}\n`)
      ws?.send(`${cmdText} & echo ${SEP}${cur}\r`)
    }

    const handleDone = (output: string) => {
      switch (phase) {
        case 'old-head': {
          const headLines = output.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
          oldHead = headLines.find(l => /^[a-f0-9]{40}$/i.test(l)) || null
          addToTerminal(`[旧 HEAD] ${oldHead ?? '不存在'}\n`)
          phase = 'fetch'
          sendNext('git', ['fetch', 'upstream', '--force'])
          break
        }
        case 'fetch': {
          if (/fatal:|error:|could not/i.test(output)) {
            setFetchError('Fetch 失败，请查看终端输出')
            setLoading(false)
            cleanup()
            return
          }
          phase = 'update-dev'
          sendNext('git', ['branch', '-f', 'dev', 'upstream/dev'])
          break
        }
        case 'update-dev': {
          if (/fatal:|error:|could not/i.test(output)) {
            setFetchError('更新本地 dev 分支失败')
            setLoading(false)
            cleanup()
            return
          }
          phase = 'new-head'
          sendNext('git', ['rev-parse', 'dev'])
          break
        }
        case 'new-head': {
          if (/fatal:|error:|could not/i.test(output)) {
            setFetchError('获取新 HEAD 失败')
            setLoading(false)
            cleanup()
            return
          }
          const newHeadLines = output.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
          const newHead = newHeadLines.find(l => /^[a-f0-9]{40}$/i.test(l)) || null
          addToTerminal(`[新 HEAD] ${newHead ?? '不存在'}\n`)
          if (oldHead === newHead) {
            addToTerminal('[跳过] dev 无变化，跳过推送\n')
            phase = 'diff'
            sendNext(DIFF_COMMANDS[0].cmd, DIFF_COMMANDS[0].args)
          } else {
            addToTerminal('[推送] dev 已更新，推送到 origin/dev\n')
            phase = 'push'
            sendNext('git', ['push', 'origin', 'dev', '--no-verify'])
          }
          break
        }
        case 'push': {
          if (/fatal:|error:|! \[rejected\]/i.test(output)) {
            setFetchError('推送失败，请查看终端输出')
            setLoading(false)
            cleanup()
            return
          }
          phase = 'diff'
          sendNext(DIFF_COMMANDS[0].cmd, DIFF_COMMANDS[0].args)
          break
        }
        case 'diff': {
          const commits = extractCommitLines(output)
          console.log(`[CommitDiff] dev-cli → dev: ${commits.length} commits`)
          if (commits.length > 0) {
            console.log(`[CommitDiff]   first: ${commits[0].hash} ${commits[0].message}`)
            console.log(`[CommitDiff]   last:  ${commits[commits.length - 1].hash} ${commits[commits.length - 1].message}`)
          }
          setDiffs([{ label: 'dev-cli → dev', commits, error: null }])
          setActiveCommand(1)
          phase = 'done'
          setLoading(false)
          cleanup()
          break
        }
        default:
          break
      }
    }

    createPtySession({ command: 'cmd', cwd: sourcePath }, sourcePath).then(pty => {
      if (closed) {
        removePtySession(pty.id, sourcePath).catch(() => {})
        return
      }
      ptyId = pty.id
      timer = setTimeout(() => {
        setFetchError('执行超时 (120s)')
        setLoading(false)
        cleanup()
      }, 120_000)

      const wsUrl = getPtyConnectUrl(ptyId, sourcePath, { includeAuthInUrl: true })
      ws = new WebSocket(wsUrl)
      ws.binaryType = 'arraybuffer'

      ws.onopen = () => {
        if (closed) { ws?.close(); return }
        sendNext('git', ['rev-parse', 'dev'])
      }

      ws.onmessage = event => {
        if (closed) return
        const frame = parsePtyFrame(event.data)
        if (frame?.kind === 'data') {
          const clean = stripAnsi(frame.data)
          cmdBuffer += clean
          addToTerminal(clean)

          const markerMatch = cmdBuffer.match(new RegExp(`(?:^|\\r?\\n)${SEP}(\\d+)`))
          if (markerMatch) {
            const cmdOut = cmdBuffer.substring(0, markerMatch.index).trim()
            cmdBuffer = ''
            handleDone(cmdOut)
          }
        }
      }

      ws.onerror = () => {
        if (!closed) {
          setFetchError('WebSocket 连接错误')
          setLoading(false)
          cleanup()
        }
      }

      ws.onclose = () => {
        if (!closed && phase !== 'done') {
          setFetchError('连接意外关闭')
          setLoading(false)
          cleanup()
        }
      }
    }).catch(error => {
      setFetchError(error instanceof Error ? error.message : '创建 PTY 会话失败')
      setLoading(false)
    })

    cancelRef.current = abort
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

  const handleMerge = useCallback(() => {
    if (!sourcePath.trim()) return
    setMergeLoading(true)
    setMergeError(null)
    setFetchError(null)
    addToTerminal('\n========== 开始合并 dev → dev-cli ==========\n')

    let ws: WebSocket | null = null
    let timer: ReturnType<typeof setTimeout>
    let closed = false
    let ptyId: string | null = null
    const SEP = '___CMD_END___'

    type MergePhase = 'check-status' | 'merge' | 'version' | 'bun-install' | 'backup' | 'build' | 'push' | 'done'
    let phase: MergePhase = 'check-status'
    let savedVersion = ''
    let cmdBuffer = ''
    let markerIdx = 0

    const cleanup = () => {
      if (closed) return
      closed = true
      clearTimeout(timer)
      ws?.close()
      if (ptyId) removePtySession(ptyId, sourcePath).catch(() => {})
    }

    const sendNext = (cmd: string, args: string[]) => {
      const cur = markerIdx++
      const cmdText = `${cmd} ${args.join(' ')}`
      addToTerminal(`$ ${cmdText}\n`)
      ws?.send(`${cmdText} & echo ${SEP}${cur}\r`)
    }

    const handleDone = (output: string) => {
      switch (phase) {
        case 'check-status': {
          const lines = output.split(/\r?\n/)
            .map(l => l.trim())
            .filter(l => /^(?:[MADRCU?! ][MADRCU?! ])\s/.test(l))
          if (lines.length > 0) {
            openVSCode('dev-cli 有未提交的修改，请先提交或 stash')
            setMergeLoading(false)
            cleanup()
            return
          }
          phase = 'merge'
          sendNext('git', ['merge', 'dev', '--no-ff'])
          break
        }
        case 'merge': {
          if (/CONFLICT|fatal:|error:|could not/i.test(output)) {
            openVSCode('合并冲突，请手动解决')
            setMergeLoading(false)
            cleanup()
            return
          }
          phase = 'version'
          sendNext('opencode', ['--version'])
          break
        }
        case 'version': {
          savedVersion = output.split(/\r?\n/).map(l => l.trim()).filter(Boolean).pop() || ''
          addToTerminal(`[版本] ${savedVersion}\n`)
          phase = 'bun-install'
          sendNext('bun', ['install'])
          break
        }
        case 'bun-install': {
          if (/error|ERR_PNPM|ELIFECYCLE/i.test(output)) {
            setMergeError('bun install 失败')
            setMergeLoading(false)
            cleanup()
            return
          }
          phase = 'backup'
          const exePath = 'packages\\opencode\\dist\\opencode-windows-x64\\bin\\opencode.exe'
          if (!savedVersion) {
            addToTerminal('[跳过] 版本号为空，跳过备份\n')
            sendNext('bun', ['run', './packages/opencode/script/build.ts', '--single'])
          } else {
            sendNext('move', ['/Y', exePath, `${exePath}.${savedVersion}`])
          }
          break
        }
        case 'backup': {
          if (/The system cannot find the file/i.test(output)) {
            addToTerminal('[跳过] 未找到现有的 opencode.exe，跳过备份\n')
          } else if (/error:|could not|The process cannot/i.test(output)) {
            setMergeError('备份 exe 失败')
            setMergeLoading(false)
            cleanup()
            return
          }
          phase = 'build'
          sendNext('bun', ['run', './packages/opencode/script/build.ts', '--single'])
          break
        }
        case 'build': {
          if (/error:|ELIFECYCLE|Build failed|FAILED/i.test(output)) {
            setMergeError('构建失败，请查看终端输出')
            setMergeLoading(false)
            cleanup()
            return
          }
          phase = 'push'
          sendNext('git', ['push', 'origin', 'dev-cli', '--no-verify'])
          break
        }
        case 'push': {
          if (/fatal:|error:|! \[rejected\]/i.test(output)) {
            setMergeError('推送 dev-cli 到 origin 失败')
            setMergeLoading(false)
            cleanup()
            return
          }
          addToTerminal('\n========== 合并完成 ==========\n')
          phase = 'done'
          setMergeLoading(false)
          cleanup()
          break
        }
        default:
          break
      }
    }

    createPtySession({ command: 'cmd', cwd: sourcePath }, sourcePath).then(pty => {
      if (closed) {
        removePtySession(pty.id, sourcePath).catch(() => {})
        return
      }
      ptyId = pty.id
      timer = setTimeout(() => {
        setMergeError('合并超时 (300s)')
        setMergeLoading(false)
        cleanup()
      }, 300_000)

      const wsUrl = getPtyConnectUrl(ptyId, sourcePath, { includeAuthInUrl: true })
      ws = new WebSocket(wsUrl)
      ws.binaryType = 'arraybuffer'

      ws.onopen = () => {
        if (closed) { ws?.close(); return }
        sendNext('git', ['status', '--porcelain'])
      }

      ws.onmessage = event => {
        if (closed) return
        const frame = parsePtyFrame(event.data)
        if (frame?.kind === 'data') {
          const clean = stripAnsi(frame.data)
          cmdBuffer += clean
          addToTerminal(clean)

          const markerMatch = cmdBuffer.match(new RegExp(`(?:^|\\r?\\n)${SEP}(\\d+)`))
          if (markerMatch) {
            const cmdOut = cmdBuffer.substring(0, markerMatch.index).trim()
            cmdBuffer = ''
            handleDone(cmdOut)
          }
        }
      }

      ws.onerror = () => {
        if (!closed) {
          setMergeError('WebSocket 连接错误')
          setMergeLoading(false)
          cleanup()
        }
      }

      ws.onclose = () => {
        if (!closed && phase !== 'done') {
          setMergeError('连接意外关闭')
          setMergeLoading(false)
          cleanup()
        }
      }
    }).catch(error => {
      setMergeError(error instanceof Error ? error.message : '创建 PTY 会话失败')
      setMergeLoading(false)
    })

    mergeCancelRef.current = cleanup
  }, [sourcePath, addToTerminal, openVSCode])

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
            {terminalLines.length === 0 && !loading && !mergeLoading && !fetchError && !mergeError && (
              <span className="text-text-500">Waiting...</span>
            )}
            {terminalLines.map((line, i) => {
              const trimmed = line.trim()
              const isCmdLine = /^\$ (git |bun |opencode |move )/.test(trimmed) || trimmed.includes('echo ___CMD_END___')
              const isMarker = trimmed.includes('___CMD_END___')
              const isContinuation = trimmed === '>>' || trimmed.startsWith('>> ')
              const isBanner = /^(Microsoft Windows|\(c\) Microsoft|保留)/.test(trimmed) || /^[A-Z]:\\.+>$/.test(trimmed)
              const isBlank = !trimmed
              const isErrorLine = (fetchError || mergeError) && i === terminalLines.length - 1
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
            {(loading || mergeLoading) && (
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

            {!loading && !fetchError && diffs.length === 0 && terminalLines.length > 0 && !mergeLoading && (
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
        <Button size="sm" variant="primary" isLoading={mergeLoading} disabled={loading || mergeLoading} onClick={handleMerge}>
          Merge dev → dev-cli
        </Button>
        <div className="flex-1" />
        {(loading || mergeLoading) && (
          <span className="text-xs text-text-400">{mergeLoading ? 'Merging...' : (t('about.commitDiffLoading') || 'Executing...')}</span>
        )}
        <Button size="sm" variant="secondary" isLoading={loading} disabled={loading || mergeLoading} onClick={fetchDiffs}>
          {t('common:refresh') || 'Refresh'}
        </Button>
        <Button size="sm" variant="ghost" disabled={mergeLoading} onClick={onClose}>
          {t('common:close') || 'Close'}
        </Button>
      </div>
    </Dialog>
  )
}
