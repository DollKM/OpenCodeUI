export function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, '').replace(/-.+$/, '')
}

export function compareVersions(a: string, b: string): number {
  const left = normalizeVersion(a)
    .split('.')
    .map(part => Number.parseInt(part, 10) || 0)
  const right = normalizeVersion(b)
    .split('.')
    .map(part => Number.parseInt(part, 10) || 0)
  const length = Math.max(left.length, right.length)

  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff
  }

  return 0
}
