import { diffLines } from 'diff'

export function extractContentFromUnifiedDiff(diff: string): { before: string; after: string } {
  let before = ''
  let after = ''

  for (const rawLine of diff.split('\n')) {
    const line = rawLine.replace(/\r$/, '')

    if (
      line.startsWith('---') ||
      line.startsWith('+++') ||
      line.startsWith('Index:') ||
      line.startsWith('===') ||
      line.startsWith('@@') ||
      line.startsWith('\\ No newline')
    ) {
      continue
    }

    if (line.startsWith('-')) {
      before += line.slice(1) + '\n'
    } else if (line.startsWith('+')) {
      after += line.slice(1) + '\n'
    } else if (line.startsWith(' ')) {
      before += line.slice(1) + '\n'
      after += line.slice(1) + '\n'
    }
  }

  return { before: before.trimEnd(), after: after.trimEnd() }
}

/**
 * 通过 extractContentFromUnifiedDiff + diffLines 重新计算增删行数，
 * 与 DiffViewer 渲染逻辑保持一致，避免 API 返回的 additions/deletions 口径不同。
 */
export function computePatchStats(patch: string): { additions: number; deletions: number } {
  const { before, after } = extractContentFromUnifiedDiff(patch)
  if (!before && !after) return { additions: 0, deletions: 0 }

  const changes = diffLines(before, after)
  let additions = 0
  let deletions = 0
  for (const change of changes) {
    if (change.added) additions += change.count ?? 0
    else if (change.removed) deletions += change.count ?? 0
  }
  return { additions, deletions }
}
