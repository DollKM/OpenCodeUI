import { useSyncExternalStore } from 'react'
import type { ModelInfo } from '../types/ui'
import { serverStorage } from '../utils/perServerStorage'
import { getModelKey } from '../utils/modelUtils'
import { serverStore } from './serverStore'
import { clientDataStorage } from '../lib/clientDataStorage'

type Listener = () => void

const STORAGE_KEY_HIDDEN_MODELS = 'hidden-model-keys'

function loadHiddenModelKeys(): string[] {
  // 1. 尝试从本地 per-server storage 读取
  const stored = serverStorage.getJSON<unknown>(STORAGE_KEY_HIDDEN_MODELS)
  if (Array.isArray(stored)) {
    return stored.filter((item): item is string => typeof item === 'string')
  }
  // 2. 回退到云端数据
  const cloud = clientDataStorage.getItem('models.hidden')
  if (cloud) {
    try {
      const parsed = JSON.parse(cloud)
      if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === 'string')
    } catch { /* ignore */ }
  }
  return []
}

class ModelVisibilityStore {
  private hiddenModelKeys = new Set<string>()
  private listeners = new Set<Listener>()
  private snapshot: string[] = []

  constructor() {
    this.reload()
    serverStore.onServerChange(() => {
      this.reload()
      this.notify()
    })
  }

  private updateSnapshot() {
    this.snapshot = Array.from(this.hiddenModelKeys).sort()
  }

  private persist() {
    serverStorage.setJSON(STORAGE_KEY_HIDDEN_MODELS, this.snapshot)
    // 同步到云端
    clientDataStorage.setItem('models.hidden', JSON.stringify(this.snapshot))
  }

  private reload() {
    this.hiddenModelKeys = new Set(loadHiddenModelKeys())
    this.updateSnapshot()
  }

  private notify() {
    this.updateSnapshot()
    this.listeners.forEach(listener => listener())
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): string[] => this.snapshot

  isVisible(model: ModelInfo | string): boolean {
    const key = typeof model === 'string' ? model : getModelKey(model)
    return !this.hiddenModelKeys.has(key)
  }

  setVisible(model: ModelInfo | string, visible: boolean) {
    const key = typeof model === 'string' ? model : getModelKey(model)
    let changed = false
    if (visible) {
      changed = this.hiddenModelKeys.delete(key)
    } else if (!this.hiddenModelKeys.has(key)) {
      this.hiddenModelKeys.add(key)
      changed = true
    }
    if (!changed) return
    this.persist()
    this.notify()
  }

  setManyVisible(models: ModelInfo[], visible: boolean) {
    let changed = false
    for (const model of models) {
      const key = getModelKey(model)
      if (visible) {
        changed = this.hiddenModelKeys.delete(key) || changed
      } else if (!this.hiddenModelKeys.has(key)) {
        this.hiddenModelKeys.add(key)
        changed = true
      }
    }
    if (!changed) return
    this.persist()
    this.notify()
  }
}

export const modelVisibilityStore = new ModelVisibilityStore()

export function useHiddenModelKeys(): string[] {
  return useSyncExternalStore(modelVisibilityStore.subscribe, modelVisibilityStore.getSnapshot)
}
