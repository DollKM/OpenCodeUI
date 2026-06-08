import { createPtySession, getPtyConnectUrl, updatePtySession } from '../api/pty'
import { parsePtyFrame } from './ptyProtocol'
import { stripAnsi } from './ansiUtils'
import { logger } from './logger'

export interface PtyCommandResult {
  output: string
  exitCode: number | null
}

/**
 * InteractivePtySession — 单个持久 PTY shell 会话的 WebSocket 交互封装。
 *
 * 内部按行处理输出流：
 *   原始 PTY 输出 → 逐行提取 → stripAnsi → 空行丢弃
 *     ├── 匹配 ___CMD_END___ 标记 → 提取 exitCode，resolve 当前 exec()
 *     └── 普通输出 → onOutput 回调
 *
 * 每条命令独立超时，超时/断开只影响当前命令，不销毁 session。
 */
export class InteractivePtySession {
  private ptyId: string | null = null
  private ws: WebSocket | null = null
  private directory: string
  private timeout: number
  private _closed = false
  private _markerCount = 0
  private _buf = ''
  private _isWin: boolean

  private _pending: Map<
    number,
    {
      resolve: (result: PtyCommandResult) => void
      reject: (err: Error) => void
      output: string
      timer: ReturnType<typeof setTimeout>
    }
  > = new Map()

  private _currentIdx: number | null = null

  /** 每条经 stripAnsi 且非空的输出行 */
  onOutput: ((text: string) => void) | null = null

  constructor(directory: string, options?: { timeout?: number }) {
    this.directory = directory
    this.timeout = options?.timeout ?? 60000
    this._isWin = typeof navigator !== 'undefined' && navigator.platform?.toLowerCase().includes('win')
  }

  get closed() {
    return this._closed
  }

  /** 创建 PTY + 连接 WebSocket，返回 Promise 在连接就绪时 resolve */
  async connect(): Promise<void> {
    const shell = this._isWin ? 'powershell' : 'bash'
    logger.log('[PtySession] Creating, shell:', shell, 'dir:', this.directory)
    const pty = await createPtySession({ command: shell, cwd: this.directory }, this.directory)
    this.ptyId = pty.id
    logger.log('[PtySession] Created:', this.ptyId)

    return new Promise((resolve, reject) => {
      const url = getPtyConnectUrl(this.ptyId!, this.directory, { includeAuthInUrl: true })
      const ws = new WebSocket(url)
      ws.binaryType = 'arraybuffer'
      this.ws = ws

      ws.onopen = () => {
        logger.log('[PtySession] WebSocket connected')
        if (this.ptyId) {
          updatePtySession(this.ptyId, { size: { rows: 100, cols: 512 } }, this.directory).catch(() => {})
        }
        resolve()
      }

      ws.onmessage = (event) => {
        const frame = parsePtyFrame(event.data)
        if (frame?.kind !== 'data') return

        this._buf += frame.data

        let lineEnd: number
        while ((lineEnd = this._buf.search(/\r?\n|\r/)) !== -1) {
          const rawLine = this._buf.substring(0, lineEnd)
          const skip = this._buf[lineEnd] === '\r' && this._buf[lineEnd + 1] === '\n' ? 2 : 1
          this._buf = this._buf.substring(lineEnd + skip)

          const cleaned = stripAnsi(rawLine)
          if (!cleaned) continue

          logger.log('[PtySession] Line:', cleaned)

          const trimmed = cleaned.trim()
          const markerMatch = trimmed.match(/exit=(-?\d+):___CMD_END___(\d+)$/)
          if (markerMatch) {
            const idx = parseInt(markerMatch[2], 10)
            const exitCode = parseInt(markerMatch[1], 10)
            const beforeIndex = trimmed.indexOf('exit=')
            if (beforeIndex > 0) {
              this.onOutput?.(trimmed.substring(0, beforeIndex))
            }
            const pending = this._pending.get(idx)
            if (pending) {
              clearTimeout(pending.timer)
              this._pending.delete(idx)
              pending.resolve({ output: pending.output, exitCode })
            }
            if (this._currentIdx === idx) this._currentIdx = null
            continue
          }

          this.onOutput?.(cleaned)

          if (this._currentIdx !== null) {
            const pending = this._pending.get(this._currentIdx)
            if (pending) {
              pending.output += cleaned + '\n'
            }
          }
        }
      }

      ws.onerror = () => {
        logger.log('[PtySession] WebSocket error')
        this._failAll(new Error('[PtySession] WebSocket error'))
        reject(new Error('[PtySession] WebSocket error'))
      }

      ws.onclose = () => {
        logger.log('[PtySession] WebSocket closed')
        this._cleanup()
      }
    })
  }

  /** 发送一条命令，返回 Promise 在匹配到完成标记时 resolve */
  exec(command: string): Promise<PtyCommandResult> {
    if (this._closed || !this.ws) throw new Error('[PtySession] Not connected')

    const idx = this._markerCount++
    this._currentIdx = idx

    return new Promise<PtyCommandResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(idx)
        if (this._currentIdx === idx) this._currentIdx = null
        reject(new Error(`[PtySession] Command ${idx} timed out after ${this.timeout}ms`))
      }, this.timeout)

      this._pending.set(idx, { resolve, reject, output: '', timer })
      logger.log('[PtySession] Exec', idx, ':', command)

      const exitVar = this._isWin ? '$(if ($?) { 0 } else { 1 })' : '$?'
      this.ws!.send(`${command}; echo "exit=${exitVar}:___CMD_END___${idx}"\r`)
    })
  }

  /** 主动关闭会话 */
  close() {
    this._cleanup()
  }

  private _failAll(err: Error) {
    for (const [, pending] of this._pending) {
      clearTimeout(pending.timer)
      pending.reject(err)
    }
    this._pending.clear()
    this._currentIdx = null
    this._closeWs()
  }

  private _cleanup() {
    if (this._closed) return
    this._closed = true
    this._failAll(new Error('[PtySession] Session closed'))
    this._closeWs()
  }

  private _closeWs() {
    this.ws?.close()
  }
}
