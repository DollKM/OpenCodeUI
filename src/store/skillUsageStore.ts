const STORAGE_KEY = 'opencode-skill-usage'
const STORAGE_KEY_SKILL_NAMES = 'opencode-known-skill-names'

import { clientDataStorage } from '../lib/clientDataStorage'

type Subscriber = () => void

const COMMAND_DEDUP_TTL_MS = 30_000

class SkillUsageStore {
  private usage = new Map<string, number>()
  private subscribers = new Set<Subscriber>()
  private knownSkillNames = new Set<string>()
  private cachedUsage: Record<string, number> = {}
  private commandRecordedTimestamps = new Map<string, number>()

  constructor() {
    this.load()
    this.loadKnownNames()
  }

  private rebuildCache() {
    const next: Record<string, number> = {}
    for (const [name, count] of this.usage) {
      next[name] = count
    }
    this.cachedUsage = next
  }

  private load() {
    try {
      const raw = clientDataStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed: Record<string, number> = JSON.parse(raw)
        for (const [name, count] of Object.entries(parsed)) {
          if (count > 0) this.usage.set(name, count)
        }
      }
    } catch {
      this.usage.clear()
    }
    this.rebuildCache()
  }

  private loadKnownNames() {
    try {
      const raw = clientDataStorage.getItem(STORAGE_KEY_SKILL_NAMES)
      if (raw) {
        const names: string[] = JSON.parse(raw)
        for (const name of names) this.knownSkillNames.add(name)
      }
    } catch {
      this.knownSkillNames.clear()
    }
  }

  private persistKnownNames() {
    clientDataStorage.setItem(STORAGE_KEY_SKILL_NAMES, JSON.stringify([...this.knownSkillNames]))
  }

  private persist() {
    const obj: Record<string, number> = {}
    for (const [name, count] of this.usage) {
      obj[name] = count
    }
    clientDataStorage.setItem(STORAGE_KEY, JSON.stringify(obj))
  }

  private notify() {
    this.subscribers.forEach(fn => fn())
  }

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn)
    return () => this.subscribers.delete(fn)
  }

  registerSkillNames(names: string[]) {
    for (const name of names) this.knownSkillNames.add(name)
    this.persistKnownNames()
  }

  isKnownSkill(name: string): boolean {
    return this.knownSkillNames.has(name)
  }

  recordSkill(skillName: string) {
    const current = this.usage.get(skillName) ?? 0
    this.usage.set(skillName, current + 1)
    this.rebuildCache()
    this.persist()
    this.notify()
  }

  recordCommandSkill(skillName: string) {
    this.recordSkill(skillName)
    this.commandRecordedTimestamps.set(skillName, Date.now())
  }

  wasRecentlyCommandRecorded(skillName: string): boolean {
    const ts = this.commandRecordedTimestamps.get(skillName)
    if (!ts) return false
    if (Date.now() - ts > COMMAND_DEDUP_TTL_MS) {
      this.commandRecordedTimestamps.delete(skillName)
      return false
    }
    return true
  }

  getUsage(): Record<string, number> {
    return this.cachedUsage
  }

  getTotalUsage(): number {
    let total = 0
    for (const count of this.usage.values()) {
      total += count
    }
    return total
  }

  clearAll() {
    this.usage.clear()
    this.commandRecordedTimestamps.clear()
    this.rebuildCache()
    clientDataStorage.removeItem(STORAGE_KEY)
    this.notify()
  }
}

export const skillUsageStore = new SkillUsageStore()