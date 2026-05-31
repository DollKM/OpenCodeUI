// ============================================
// Notification Sound Bridge
// ============================================
//
// 连接 notificationStore 和声音播放系统
// 在应用初始化时调用 initNotificationSound() 注册即可
//
// 触发点：
// 1. notificationStore.push → 后台会话通知声音
// 2. 当前会话事件 → 由 useGlobalEvents 回调中调用 playNotificationSound
//
// 不要在其他地方直接调用 playSound，统一走这里

import type { NotificationType } from '../store/notificationStore'
import { notificationStore } from '../store/notificationStore'
import { soundStore } from '../store/soundStore'
import { playSound, prewarmAudioContext, DEFAULT_SOUNDS, type BuiltinSoundId } from './soundPlayer'

// ============================================
// 内置默认音频文件（替换原来的 Web Audio 合成音效）
// 导入路径：src/assets/audio/*.wav
// ============================================
import completedSoundUrl from '../assets/audio/会话完成.wav'
import permissionSoundUrl from '../assets/audio/权限请求.wav'
import questionSoundUrl from '../assets/audio/问题.wav'
import errorSoundUrl from '../assets/audio/错误.wav'

const DEFAULT_CUSTOM_AUDIO: Record<NotificationType, string> = {
  completed: completedSoundUrl,
  permission: permissionSoundUrl,
  question: questionSoundUrl,
  error: errorSoundUrl,
}

const STORAGE_KEY_SOUNDS_INITIALIZED = 'opencode:default-custom-sounds-loaded'

/**
 * 为指定事件类型播放通知提示音
 * 会检查总开关和音量设置
 */
export function playNotificationSound(type: NotificationType): void {
  const settings = soundStore.getSnapshot()

  // 总开关关闭
  if (!settings.enabled) return
  // 音量为 0
  if (settings.volume <= 0) return

  const eventConfig = settings.events[type]
  if (!eventConfig || eventConfig.soundId === 'none') return

  const customBlob = eventConfig.soundId === 'custom' ? soundStore.getCustomAudioBlob(type) : null

  if (eventConfig.soundId === 'custom' && !customBlob) {
    // 自定义音频尚未加载完成或不存在 → 回退到对应内置音效
    const fallbackId = DEFAULT_SOUNDS[type] as BuiltinSoundId
    playSound({ soundId: fallbackId, volume: settings.volume })
    return
  }

  playSound({
    soundId: eventConfig.soundId,
    customAudioData: customBlob,
    volume: settings.volume,
  })
}

// 去重：防止同一事件在短时间内重复播放（后台通知 + 当前会话同时触发）
const recentPlays = new Map<NotificationType, number>()
const DEDUP_INTERVAL = 500 // 500ms 内同类型事件不重复播放

/**
 * 带去重的通知声音播放
 * 用于当前会话播放场景，防止和后台通知重复
 */
export function playNotificationSoundDeduped(type: NotificationType): void {
  const now = Date.now()
  const lastPlay = recentPlays.get(type)
  if (lastPlay && now - lastPlay < DEDUP_INTERVAL) return

  recentPlays.set(type, now)
  playNotificationSound(type)
}

/**
 * 初始化通知声音系统
 * 在 App 层调用一次即可，注册 notificationStore.push 的声音回调
 *
 * 同时会：
 * 1. 预初始化 AudioContext（避免 autoplay 策略）
 * 2. 首次启动时预加载 src/assets/audio/*.wav 到 IndexedDB
 *    并自动切换默认事件音效为 'custom'
 */
export function initNotificationSound(): () => void {
  // 预初始化 AudioContext，尝试提前激活（fire-and-forget，不阻塞主流程）
  setTimeout(prewarmAudioContext, 1000)

  // 首次启动时加载默认音频文件
  maybePreloadDefaultCustomSounds()

  const unsubscribe = notificationStore.onPush((type: NotificationType) => {
    // notificationStore.push 只在后台会话触发（非当前 session family）
    // 记录播放时间用于去重
    recentPlays.set(type, Date.now())
    playNotificationSound(type)
  })

  return unsubscribe
}

/**
 * 首次启动时将 src/assets/audio/*.wav 预加载到 IndexedDB，
 * 并自动将 4 类事件的默认音效切换为 'custom'。
 *
 * - 只执行一次（localStorage 标记控制）
 * - 跳过已有自定义音频的事件（恢复备份等场景）
 * - 跳过用户已手动选择过其他内置音效的事件
 */
async function maybePreloadDefaultCustomSounds(): Promise<void> {
  let alreadyInitialized = false
  try {
    alreadyInitialized = !!localStorage.getItem(STORAGE_KEY_SOUNDS_INITIALIZED)
  } catch {
    /* */
  }
  if (alreadyInitialized) return

  const types: NotificationType[] = ['completed', 'permission', 'question', 'error']
  let allSucceeded = true

  for (const type of types) {
    const url = DEFAULT_CUSTOM_AUDIO[type]
    if (!url) {
      allSucceeded = false
      continue
    }

    try {
      // 已有自定义音频 → 跳过
      if (soundStore.hasCustomAudio(type)) continue

      // 用户已手动选择了其他非默认内置音效 → 不覆盖
      const currentConfig = soundStore.getSnapshot().events[type]
      if (currentConfig && currentConfig.soundId !== DEFAULT_SOUNDS[type] && currentConfig.soundId !== 'custom') {
        continue
      }

      const response = await fetch(url)
      const blob = await response.blob()
      const file = new File([blob], `${type}.wav`, { type: blob.type || 'audio/wav' })
      // uploadCustomAudio 内部自动设置 soundId: 'custom' + 写入 IDB
      await soundStore.uploadCustomAudio(type, file)
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn(`[Sound] Failed to preload default audio for ${type}:`, err)
      }
      allSucceeded = false
    }
  }

  if (allSucceeded) {
    try {
      localStorage.setItem(STORAGE_KEY_SOUNDS_INITIALIZED, 'true')
    } catch {
      /* */
    }
  }
}
