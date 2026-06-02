const STORAGE_KEY = 'opencode-skill-usage'
const STORAGE_KEY_SKILL_NAMES = 'opencode-known-skill-names'

type Subscriber = () => void

class SkillUsageStore {
  private usage = new Map<string, number>()
  private subscribers = new Set<Subscriber>()
  private knownSkillNames = new Set<string>()
  private cachedUsage: Record<string, number> = {}

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
      const raw = localStorage.getItem(STORAGE_KEY)
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
      const raw = localStorage.getItem(STORAGE_KEY_SKILL_NAMES)
      if (raw) {
        const names: string[] = JSON.parse(raw)
        for (const name of names) this.knownSkillNames.add(name)
      }
    } catch {
      this.knownSkillNames.clear()
    }
  }

  private persistKnownNames() {
    localStorage.setItem(STORAGE_KEY_SKILL_NAMES, JSON.stringify([...this.knownSkillNames]))
  }

  private persist() {
    const obj: Record<string, number> = {}
    for (const [name, count] of this.usage) {
      obj[name] = count
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj))
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
    this.rebuildCache()
    localStorage.removeItem(STORAGE_KEY)
    this.notify()
  }
}

export const skillUsageStore = new SkillUsageStore()