/**
 * useGitDag.ts
 * Build a commit DAG by reading loose git objects, then compute lane rows
 * for the lane-management graph rendering algorithm.
 */
import type { DagCommit, LaneRow } from '../types'
import { getBranchColor } from './useBranchConfig'

// ── Internal helpers ─────────────────────────────────────────────────────────

const LANE_PALETTE = [
  '#4a9eff', '#e8c830', '#e91e8c', '#2ecc71',
  '#e74c3c', '#a78bfa', '#ff9800', '#00bcd4', '#ff5722', '#26c6da',
]

async function decompress(buf: ArrayBuffer): Promise<string> {
  const ds = new DecompressionStream('deflate-raw')
  const w = ds.writable.getWriter()
  w.write(new Uint8Array(buf, 2))
  w.close()
  const parts: Uint8Array[] = []
  const r = ds.readable.getReader()
  for (;;) { const { done, value } = await r.read(); if (done) break; parts.push(value) }
  const n = parts.reduce((s, p) => s + p.length, 0)
  const out = new Uint8Array(n)
  let off = 0
  for (const p of parts) { out.set(p, off); off += p.length }
  return new TextDecoder().decode(out)
}

async function readCommitObj(
  git: FileSystemDirectoryHandle, fh: string
): Promise<{ parents: string[]; message: string; author: string; time: number } | null> {
  try {
    const f = await git
      .getDirectoryHandle('objects')
      .then(d => d.getDirectoryHandle(fh.slice(0, 2)))
      .then(d => d.getFileHandle(fh.slice(2)))
      .then(h => h.getFile())
    const text = await decompress(await f.arrayBuffer())
    const lines = text.split('\n')
    const parents: string[] = []
    let author = '', time = 0, message = '', body = false
    for (const line of lines) {
      if (body) { if (line.trim()) { message = line.trim(); break }; continue }
      if (line === '') { body = true; continue }
      if (line.startsWith('parent ')) parents.push(line.slice(7, 47))
      else if (line.startsWith('author ')) {
        const m = line.match(/author (.+?) <[^>]+> (\d+)/)
        if (m) { author = m[1]; time = +m[2] }
      }
    }
    return { parents, message, author, time }
  } catch { return null }
}

async function readAllRefs(
  git: FileSystemDirectoryHandle
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>()
  const add = (h: string, name: string) => {
    const k = h.trim().slice(0, 40)
    if (k.length < 40) return
    const list = map.get(k) ?? []; list.push(name); map.set(k, list)
  }
  async function scanDir(dir: FileSystemDirectoryHandle, prefix: string) {
    for await (const [n, h] of (dir as unknown as AsyncIterable<[string, FileSystemHandle]>)) {
      if (h.kind === 'directory') await scanDir(h as FileSystemDirectoryHandle, prefix + n + '/')
      else {
        try { add(await (await (h as FileSystemFileHandle).getFile()).text(), prefix + n) } catch {}
      }
    }
  }
  try { await scanDir(await git.getDirectoryHandle('refs'), 'refs/') } catch {}
  try {
    const t = await (await (await git.getFileHandle('packed-refs')).getFile()).text()
    for (const l of t.split('\n')) {
      if (l.startsWith('#') || !l.trim()) continue
      const [h, r] = l.split(' '); if (h && r) add(h, r)
    }
  } catch {}
  return map
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build a commit DAG by BFS from all branch tips, reading loose git objects.
 * Commits that are packed (not loose) are silently skipped.
 * Returns commits in topological order (newest first).
 */
export async function buildDag(
  git: FileSystemDirectoryHandle, max = 200
): Promise<DagCommit[]> {
  const refMap = await readAllRefs(git)
  const queue: string[] = [], visited = new Set<string>()
  const cmap = new Map<string, DagCommit>()

  // Seed from all branch / remote heads
  for (const [fh, refs] of refMap) {
    if (refs.some(r => r.startsWith('refs/heads/') || r.startsWith('refs/remotes/'))) {
      if (!visited.has(fh)) { queue.push(fh); visited.add(fh) }
    }
  }

  while (queue.length && cmap.size < max) {
    const fh = queue.shift()!
    const raw = await readCommitObj(git, fh)
    if (!raw) continue
    const hash = fh.slice(0, 7)
    const refs = (refMap.get(fh) ?? [])
      .filter(r => r.startsWith('refs/heads/') || r.startsWith('refs/tags/') || r.startsWith('refs/remotes/'))
      .map(r => r.replace(/^refs\/(heads|tags|remotes)\//, ''))
    cmap.set(hash, {
      hash, fullHash: fh,
      parents: raw.parents.map(p => p.slice(0, 7)),
      refs, message: raw.message, author: raw.author, time: raw.time,
    })
    for (const p of raw.parents) {
      if (!visited.has(p) && cmap.size < max) { visited.add(p); queue.push(p) }
    }
  }

  // Topological sort: Kahn's algorithm (newest-first among ties)
  const all = [...cmap.values()]
  const childCount = new Map<string, number>()
  for (const c of all) {
    if (!childCount.has(c.hash)) childCount.set(c.hash, 0)
    for (const p of c.parents) if (cmap.has(p)) childCount.set(p, (childCount.get(p) ?? 0) + 1)
  }
  const heads = all.filter(c => (childCount.get(c.hash) ?? 0) === 0)
  heads.sort((a, b) => b.time - a.time)
  const result: DagCommit[] = []
  while (heads.length) {
    heads.sort((a, b) => b.time - a.time)
    const c = heads.shift()!
    result.push(c)
    for (const p of c.parents) {
      if (!cmap.has(p)) continue
      const n = (childCount.get(p) ?? 0) - 1
      childCount.set(p, n)
      if (n === 0) heads.push(cmap.get(p)!)
    }
  }
  return result
}

/**
 * Assign each commit to a vertical lane and record the lane state
 * before and after each row.  The result drives the SVG renderer.
 */
export function computeLanes(commits: DagCommit[]): LaneRow[] {
  const lanes: string[] = []    // '' = empty slot; otherwise = expected next commit hash
  const colors: string[] = []
  const rows: LaneRow[] = []
  let paletteIdx = 0

  const pickColor = (commit: DagCommit): string =>
    commit.refs.length > 0
      ? getBranchColor(commit.refs[0])
      : LANE_PALETTE[paletteIdx++ % LANE_PALETTE.length]

  for (const commit of commits) {
    const lanesBefore = [...lanes]
    const colorsBefore = [...colors]

    // Find ALL lanes currently expecting this commit (handles duplicate refs)
    const matching = lanes.reduce<number[]>(
      (acc, h, j) => { if (h === commit.hash) acc.push(j); return acc }, []
    )

    let col: number
    if (matching.length > 0) {
      col = matching[0]
      // Close duplicate lanes (two branches had same tip)
      for (const j of matching.slice(1)) { lanes[j] = ''; colors[j] = '' }
    } else {
      // New HEAD – find empty slot or append
      col = lanes.indexOf('')
      if (col === -1) { col = lanes.length; lanes.push(''); colors.push('') }
      colors[col] = pickColor(commit)
    }

    const color = colors[col]

    // Continue the lane to the first parent
    lanes[col] = commit.parents[0] ?? ''

    // Open new lanes for secondary parents (merge commits)
    for (let p = 1; p < commit.parents.length; p++) {
      const ph = commit.parents[p]
      if (!lanes.includes(ph)) {
        let slot = lanes.indexOf('')
        if (slot === -1) { slot = lanes.length; lanes.push(''); colors.push('') }
        lanes[slot] = ph
        colors[slot] = LANE_PALETTE[paletteIdx++ % LANE_PALETTE.length]
      }
    }

    // Trim trailing empty slots
    while (lanes.length && lanes[lanes.length - 1] === '') { lanes.pop(); colors.pop() }

    rows.push({ commit, col, color, lanesBefore, lanesAfter: [...lanes], colorsBefore, colorsAfter: [...colors] })
  }

  return rows
}
