import { useCallback, useSyncExternalStore } from 'react'

export interface TurnCheckpoint {
  sessionId: string
  messageId: string
  createdAt: number
}

type Subscriber = () => void

class TurnCheckpointStore {
  private storageKey = 'opencode-turn-checkpoints'
  private subscribers = new Set<Subscriber>()
  private cache = new Map<string, TurnCheckpoint>()

  private load() {
    try {
      const data = localStorage.getItem(this.storageKey)
      if (!data) {
        this.cache.clear()
        return
      }
      const parsed = JSON.parse(data) as Record<string, TurnCheckpoint>
      this.cache = new Map(Object.entries(parsed))
    } catch {
      this.cache = new Map()
    }
  }

  private persist() {
    const obj: Record<string, TurnCheckpoint> = {}
    this.cache.forEach((v, k) => { obj[k] = v })
    localStorage.setItem(this.storageKey, JSON.stringify(obj))
  }

  private notify() {
    this.subscribers.forEach(fn => fn())
  }

  subscribe = (fn: Subscriber): (() => void) => {
    this.subscribers.add(fn)
    return () => this.subscribers.delete(fn)
  }

  getCheckpoint(sessionId: string): TurnCheckpoint | null {
    this.load()
    return this.cache.get(sessionId) ?? null
  }

  setCheckpoint(sessionId: string, messageId: string) {
    this.load()
    this.cache.set(sessionId, { sessionId, messageId, createdAt: Date.now() })
    this.persist()
    this.notify()
  }

  clearCheckpoint(sessionId: string) {
    this.load()
    if (!this.cache.delete(sessionId)) return
    this.persist()
    this.notify()
  }

  clearAll() {
    this.cache.clear()
    localStorage.removeItem(this.storageKey)
    this.notify()
  }
}

export const turnCheckpointStore = new TurnCheckpointStore()

export function useTurnCheckpoint(sessionId: string | null): TurnCheckpoint | null {
  const getSnapshot = useCallback(() => turnCheckpointStore.getCheckpoint(sessionId ?? ''), [sessionId])
  return useSyncExternalStore(turnCheckpointStore.subscribe, getSnapshot, getSnapshot)
}
