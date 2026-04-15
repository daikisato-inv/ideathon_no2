/**
 * Single source of truth for branch visual configuration.
 * Any component needing branch colors or ordering imports from here.
 */

interface BranchConfig {
  order: number
  color: string
}

const BRANCH_CONFIG: Record<string, BranchConfig> = {
  main:    { order: 0, color: '#f85149' },
  master:  { order: 0, color: '#f85149' },
  dev:     { order: 1, color: '#58a6ff' },
  feature: { order: 2, color: '#a78bfa' },
}

const DEFAULT_COLOR = '#8b949e'
const DEFAULT_ORDER = 3

function stripOriginPrefix(name: string): string {
  return name.startsWith('origin/') ? name.slice(7) : name
}

function matchKey(base: string): string | undefined {
  return Object.keys(BRANCH_CONFIG).find(
    k => base === k || base.startsWith(k + '/') || base.startsWith(k + '-')
  )
}

export function getBranchColor(name: string): string {
  const key = matchKey(stripOriginPrefix(name))
  return key ? BRANCH_CONFIG[key].color : DEFAULT_COLOR
}

export function getBranchOrder(name: string): number {
  const key = matchKey(stripOriginPrefix(name))
  return key ? BRANCH_CONFIG[key].order : DEFAULT_ORDER
}

export function sortBranches(branches: string[]): string[] {
  return [...branches].sort((a, b) => {
    const diff = getBranchOrder(a) - getBranchOrder(b)
    return diff !== 0 ? diff : a.localeCompare(b)
  })
}
