// ============================================
// ClientDataStorage - 客户端设置云端同步层
// ============================================
//
// 透明的 localStorage 代理：读/写接口与 localStorage 完全一致，
// 但写入时会同时发起 PUT /config/client_data 同步到云端。
//
// 使用方式：
//   1. 在应用初始化时调用 clientDataStorage.init()
//   2. 在各 store 中将 localStorage.getItem/setItem 替换为
//      clientDataStorage.getItem/setItem
//
// 写云端是 fire-and-forget 模式，不阻塞 UI。
// PUT 失败时记录 dirty 标记，下次启动先重推 dirty 数据。

import { getClientData, putClientData } from '../api/clientData'

/** dirty key 集合持久化的 localStorage key */
const DIRTY_KEYS_KEY = 'opencode:client-data-dirty'

/**
 * 从 localStorage 读取 dirty key 集合
 */
function loadDirtyKeys(): Set<string> {
  try {
    const raw = localStorage.getItem(DIRTY_KEYS_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    return new Set<string>(Array.isArray(arr) ? arr : [])
  } catch {
    return new Set()
  }
}

/**
 * 将 dirty key 集合持久化到 localStorage
 */
function saveDirtyKeys(keys: Set<string>): void {
  try {
    if (keys.size === 0) {
      localStorage.removeItem(DIRTY_KEYS_KEY)
    } else {
      localStorage.setItem(DIRTY_KEYS_KEY, JSON.stringify([...keys]))
    }
  } catch {
    // 忽略写入失败
  }
}

class ClientDataStorageImpl {
  /** 云端初始数据是否已加载 */
  private ready = false
  /** 已标记 dirty、待同步的 key */
  private dirtyKeys = new Set<string>()
  /** 需要同步到云端的 key 集合 */
  private cloudKeySet: Set<string>
  /** 当前目录 */
  private directory: string | undefined
  /** 是否已接入云端（没有配置服务器时跳过同步） */
  // private enabled = false
  /** 内存缓存：init() 从云端拉取后写入，getItem() 优先读取 */
  private cache: Record<string, string> = {}
  /** init() 完成后触发的回调 */
  private readyCallbacks: Array<() => void> = []

  constructor(cloudKeys: string[]) {
    this.cloudKeySet = new Set(cloudKeys)
    this.dirtyKeys = loadDirtyKeys()
    console.log('[ClientDataStorage] 初始化，云端 key 数:', cloudKeys.length, 'dirty keys:', [...this.dirtyKeys])
  }

  /**
   * 注册 init 完成后的回调
   */
  onReady(cb: () => void): void {
    if (this.ready) {
      cb()
    } else {
      this.readyCallbacks.push(cb)
    }
  }

  /**
   * 是否已从云端加载完成
   */
  isReady(): boolean {
    return this.ready
  }

  // ============================================
  // 初始化
  // ============================================

  /**
   * 初始化 ClientDataStorage
   * 1. 先重推上次未同步的 dirty 数据
   * 2. 再 GET 全量云端数据，合并到 localStorage + 内存缓存
   *
   * 调用时机：SDK client 就绪后（getSDKClientAsync() 成功后）
   */
  async init(directory?: string): Promise<void> {
    this.directory = directory

    // 先重推 dirty keys
    if (this.dirtyKeys.size > 0) {
      console.log('[ClientDataStorage] 重推 dirty keys:', [...this.dirtyKeys])
      await this.flushDirtyKeys()
    }

    // 再拉取云端全量数据
    try {
      const remote = await getClientData(undefined, directory)
      // this.enabled = true

      let changedCount = 0
      for (const [key, value] of Object.entries(remote)) {
        if (!this.cloudKeySet.has(key)) continue
        if (this.dirtyKeys.has(key)) continue

        this.cache[key] = value
        try {
          localStorage.setItem(key, value)
        } catch {
          // 忽略单条写入失败
        }
        changedCount++
      }

      console.log('[ClientDataStorage] 从云端拉取', Object.keys(remote).length, '条，写入 localStorage', changedCount, '条')
    } catch (err) {
      console.warn('[ClientDataStorage] 拉取云端数据失败，降级到 localStorage:', err)
      // this.enabled = false
    }

    this.ready = true

    // 通知所有 onReady 回调
    const cbs = this.readyCallbacks.slice()
    this.readyCallbacks.length = 0
    for (const cb of cbs) {
      try { cb() } catch (e) { console.error('[ClientDataStorage] onReady 回调出错:', e) }
    }
  }

  // ============================================
  // 公开接口（与 localStorage 兼容）
  // ============================================

  /**
   * 读取指定 key 的值
   * 优先读内存缓存（init 从云端拉取后填充），再读 localStorage
   */
  getItem(key: string): string | null {
    // init 完成后优先使用云端缓存
    if (this.ready && key in this.cache) {
      return this.cache[key]
    }
    return localStorage.getItem(key)
  }

  /**
   * 写入指定 key 的值
   * 写入 localStorage + 内存缓存，如果是云端 key 则发起 PUT 同步
   */
  setItem(key: string, value: string): void {
    localStorage.setItem(key, value)
    this.cache[key] = value
    if (this.cloudKeySet.has(key)) {
      this.syncToCloud(key, value)
    }
  }

  /**
   * 删除指定 key
   */
  removeItem(key: string): void {
    localStorage.removeItem(key)
    delete this.cache[key]
    // 云端删除：PUT 空字符串
    if (this.cloudKeySet.has(key)) {
      this.syncToCloud(key, '')
    }
  }

  // ============================================
  // 内部方法
  // ============================================

  /**
   * 将单条数据同步到云端
   * fire-and-forget，不阻塞调用方
   * 始终尝试发送，失败时才标记 dirty
   */
  private async syncToCloud(key: string, value: string): Promise<void> {
    try {
      await putClientData({ [key]: value }, key, this.directory)
      // 同步成功，清除 dirty 标记
      this.dirtyKeys.delete(key)
      saveDirtyKeys(this.dirtyKeys)
    } catch (err) {
      console.warn('[ClientDataStorage] 同步到云端失败，标记 dirty:', key, err)
      // 同步失败，标记 dirty 以便下次启动重推
      this.markDirty(key)
    }
  }

  /**
   * 标记 key 为 dirty（未同步）
   */
  private markDirty(key: string): void {
    this.dirtyKeys.add(key)
    saveDirtyKeys(this.dirtyKeys)
  }

  /**
   * 重推所有 dirty keys
   */
  private async flushDirtyKeys(): Promise<void> {
    const keys = [...this.dirtyKeys]
    let hasFailure = false

    for (const key of keys) {
      try {
        const value = localStorage.getItem(key)
        await putClientData(
          { [key]: value ?? '' },
          key,
          this.directory,
        )
        this.dirtyKeys.delete(key)
      } catch {
        hasFailure = true
      }
    }

    if (!hasFailure) {
      saveDirtyKeys(this.dirtyKeys)
    }
  }
}

/**
 * 全局单例
 *
 * 在创建时传入所有需要同步到云端的 localStorage key。
 * 后续各 store 只需将 `localStorage` 替换为 `clientDataStorage`。
 */
export const clientDataStorage = new ClientDataStorageImpl([
  // === themeStore (ui.*) ===
  'theme-preset',
  'theme-mode',
  'theme-custom-css',
  'theme-custom-css-snippets',
  'theme-active-custom-css-snippet-id',
  'collapse-user-messages',
  'step-finish-display',
  'completed-at-format',
  'reasoning-display-mode',
  'chat-wide-mode',
  'diff-style',
  'descriptive-tool-steps',
  'inline-tool-requests',
  'code-word-wrap',
  'font-scale',
  'code-font-scale',
  'tool-card-style',
  'immersive-mode',
  'compact-inline-permission',
  'glass-effect',
  'queue-followup-messages',
  'manual-terminal-titles',

  // === soundStore ===
  'opencode:sound-settings',

  // === keybindingStore ===
  'opencode-keybindings',

  // === notificationEventSettingsStore ===
  'opencode:notification-event-settings',

  // === notificationStore ===
  'opencode:toast-enabled',

  // === updateStore ===
  'opencode:update-check',

  // === AboutSettings ===
  'opencode-cli-source-path',

  // === i18n ===
  'i18nextLng',

  // === path mode ===
  'opencode-path-mode',
  'opencode-detected-path-style',

  // === skillUsageStore ===
  'opencode-skill-usage',
  'opencode-known-skill-names',

  // === modelVisibilityStore ===
  'models.hidden',
  'models.commit',
  'models.imageRecognition',

  // === autoApproveStore ===
  'autoApprove.enabled',
  'autoApprove.approvePendingOnFullAuto',
  'autoApprove.rules',
  'autoApprove.fullAutoMode',
  'autoApprove.paneFullAutoModes',
])
