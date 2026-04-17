<script setup lang="ts">
import { ref, watch as vWatch, onMounted } from 'vue'
import type { BranchLogEntry, DagCommit, LaneRow } from '../types'
import { useWatchStore } from '../stores/watchStore'
import { useGitStore } from '../stores/gitStore'
import { getBranchColor, getBranchOrder } from '../composables/useBranchConfig'
import { computeLanes } from '../composables/useGitDag'

const props = defineProps<{
  dagCommits?: DagCommit[]
  branchLogs?: Map<string, BranchLogEntry[]>
  emptyText?: string
}>()

const svgEl = ref<SVGSVGElement>()
const watchStore = useWatchStore()
const git = useGitStore()

// ── Layout constants ─────────────────────────────────────────────────────────
const LC = {
  ROW_H: 26,   // height per commit row (px)
  COL_W: 14,   // width per lane column (px)
  R: 5,        // commit circle radius
  LEFT: 10,    // left margin before lanes
  TEXT_GAP: 10,// gap between graph and text area
  BADGE_H: 14, // ref badge height
}

// ── Old-style constants (branchLogs fallback) ────────────────────────────────
const GFC = { LANE_H: 44, R: 7, GAP: 88, LABEL_W: 100, PAD_V: 28, TAG_H: 18 }

const tooltip = ref<{ visible: boolean; x: number; y: number; hash: string; msg: string; branch: string }>({
  visible: false, x: 0, y: 0, hash: '', msg: '', branch: '',
})
const tagsMap = ref<Map<string, string>>(new Map())

// ── Helpers ───────────────────────────────────────────────────────────────────
function svgNs(tag: string, attrs: Record<string, string | number>, txt?: string): SVGElement {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v))
  if (txt !== undefined) el.textContent = txt
  return el
}

// ── Tag reading ───────────────────────────────────────────────────────────────
async function readTagsFromGit(): Promise<void> {
  const gitHandle = watchStore.gitHandle
  if (!gitHandle) return
  const result = new Map<string, string>()
  try {
    const tagsDir = await gitHandle.getDirectoryHandle('refs').then(d => d.getDirectoryHandle('tags'))
    for await (const [name, handle] of (tagsDir as unknown as AsyncIterable<[string, FileSystemHandle]>)) {
      if (handle.kind !== 'file') continue
      try {
        const text = await (await (handle as FileSystemFileHandle).getFile()).text()
        result.set(text.trim().slice(0, 7), name)
      } catch { /* skip */ }
    }
  } catch { /* no tags */ }
  try {
    const f = await (await gitHandle.getFileHandle('packed-refs')).getFile()
    for (const line of (await f.text()).split('\n')) {
      if (line.startsWith('#') || !line.includes('refs/tags/')) continue
      const [hash, ref] = line.split(' ')
      if (hash && ref) result.set(hash.slice(0, 7), ref.replace('refs/tags/', ''))
    }
  } catch { /* no packed-refs */ }
  tagsMap.value = result
}

// ══════════════════════════════════════════════════════════════════════════════
// LANE-BASED RENDERING (dagCommits)
// ══════════════════════════════════════════════════════════════════════════════

function renderLaneGraph(svg: SVGSVGElement, rows: LaneRow[]): void {
  svg.innerHTML = ''
  if (!rows.length) return

  const maxLanes = Math.max(...rows.map(r =>
    Math.max(r.lanesBefore.length, r.lanesAfter.length, r.col + 1)
  ), 1)
  const graphW = LC.LEFT + maxLanes * LC.COL_W
  const textX = graphW + LC.TEXT_GAP
  // Estimate total width: text area ~520px
  const totalW = textX + 520
  const totalH = rows.length * LC.ROW_H + 4

  svg.setAttribute('width', String(totalW))
  svg.setAttribute('height', String(totalH))

  drawParentLinks(svg, rows)

  for (let i = 0; i < rows.length; i++) {
    drawLaneRow(svg, rows[i], i, textX)
  }
}

function drawParentLinks(svg: SVGSVGElement, rows: LaneRow[]): void {
  const { ROW_H, COL_W, R, LEFT } = LC
  const rowByHash = new Map(rows.map((r, i) => [r.commit.hash, { row: r, idx: i }] as const))

  for (let i = 0; i < rows.length; i++) {
    const child = rows[i]
    const x1 = LEFT + child.col * COL_W
    const y1 = i * ROW_H + ROW_H / 2 + R + 1

    for (const parentHash of child.commit.parents) {
      const parent = rowByHash.get(parentHash)
      if (!parent) continue

      const x2 = LEFT + parent.row.col * COL_W
      const y2 = parent.idx * ROW_H + ROW_H / 2 - R - 1

      if (x1 === x2) {
        svg.appendChild(svgNs('line', {
          x1, y1, x2, y2,
          stroke: child.color,
          'stroke-width': 1.2,
          'stroke-opacity': 0.45,
        }))
      } else {
        const my = (y1 + y2) / 2
        svg.appendChild(svgNs('path', {
          d: `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`,
          fill: 'none',
          stroke: child.color,
          'stroke-width': 1.2,
          'stroke-opacity': 0.45,
        }))
      }
    }
  }
}

function drawLaneRow(
  svg: SVGSVGElement, row: LaneRow, idx: number, textX: number
): void {
  const { ROW_H, COL_W, R, LEFT } = LC
  const cy = idx * ROW_H + ROW_H / 2
  const cx = LEFT + row.col * COL_W

  const maxJ = Math.max(row.lanesBefore.length, row.lanesAfter.length)

  // ── Draw connectors ────────────────────────────────────────────────────────
  for (let j = 0; j < maxJ; j++) {
    const jx = LEFT + j * COL_W
    const before = row.lanesBefore[j] ?? ''
    const after  = row.lanesAfter[j]  ?? ''
    const cBef   = row.colorsBefore[j] ?? '#8b949e'
    const cAft   = row.colorsAfter[j]  ?? '#8b949e'

    const isCommitLane = j === row.col
    // Another lane converges into this commit (was expecting this commit's hash)
    const converges = !isCommitLane && before === row.commit.hash
    // New lane opened for a secondary parent
    const diverges = !isCommitLane && before === '' && after !== ''
      && row.commit.parents.slice(1).includes(after)

    if (converges) {
      // Bezier from (jx, top) → (cx, commit circle top)
      const top = cy - ROW_H / 2
      const mx = (jx + cx) / 2
      svg.appendChild(svgNs('path', {
        d: `M${jx},${top} C${jx},${cy - 4} ${mx},${cy - 4} ${cx},${cy - R - 1}`,
        fill: 'none', stroke: cBef, 'stroke-width': 1.5,
      }))
    } else if (diverges) {
      // Bezier from (cx, commit circle bottom) → (jx, bottom)
      const bot = cy + ROW_H / 2
      const mx = (jx + cx) / 2
      svg.appendChild(svgNs('path', {
        d: `M${cx},${cy + R + 1} C${mx},${cy + 4} ${jx},${cy + 4} ${jx},${bot}`,
        fill: 'none', stroke: cAft, 'stroke-width': 1.5,
      }))
    } else if (isCommitLane) {
      // Upper segment: top → circle
      if (before !== '') {
        svg.appendChild(svgNs('line', {
          x1: cx, y1: cy - ROW_H / 2, x2: cx, y2: cy - R - 1,
          stroke: row.color, 'stroke-width': 1.5,
        }))
      }
      // Lower segment: circle → bottom
      if (after !== '') {
        svg.appendChild(svgNs('line', {
          x1: cx, y1: cy + R + 1, x2: cx, y2: cy + ROW_H / 2,
          stroke: row.color, 'stroke-width': 1.5,
        }))
      }
    } else if (before !== '' && after !== '') {
      // Straight pass-through
      svg.appendChild(svgNs('line', {
        x1: jx, y1: cy - ROW_H / 2, x2: jx, y2: cy + ROW_H / 2,
        stroke: cBef, 'stroke-width': 1.5,
      }))
    } else if (before !== '' && after === '') {
      // Lane closes here (upper half)
      svg.appendChild(svgNs('line', {
        x1: jx, y1: cy - ROW_H / 2, x2: jx, y2: cy,
        stroke: cBef, 'stroke-width': 1.5,
      }))
    } else if (before === '' && after !== '' && !diverges) {
      // Lane opens here (lower half, non-secondary-parent case)
      svg.appendChild(svgNs('line', {
        x1: jx, y1: cy, x2: jx, y2: cy + ROW_H / 2,
        stroke: cAft, 'stroke-width': 1.5,
      }))
    }
  }

  // ── Commit node ───────────────────────────────────────────────────────────
  const headHash = git.lr.length ? git.lr[git.lr.length - 1].hash : null
  const isHead = row.commit.hash === headHash
  const isPacked = row.commit.time === 0 && row.commit.message === ''
  svg.appendChild(svgNs('circle', {
    cx, cy, r: R,
    fill: isPacked ? 'none' : (isHead ? '#ffffff' : row.color),
    stroke: row.color, 'stroke-width': isHead ? 2 : 1.5,
    'stroke-dasharray': isPacked ? '2,2' : 'none',
    opacity: isPacked ? 0.5 : 1,
    'data-hash': row.commit.hash,
    'data-msg': row.commit.message,
    'data-branch': row.commit.refs.join(', '),
    style: 'cursor: pointer',
  }))

  // ── Ref badges ────────────────────────────────────────────────────────────
  let bx = textX
  for (const ref of row.commit.refs) {
    const rc = getBranchColor(ref)
    const w = ref.length * 5.5 + 10
    svg.appendChild(svgNs('rect', {
      x: bx, y: cy - LC.BADGE_H / 2, width: w, height: LC.BADGE_H,
      rx: 3, fill: rc, opacity: 0.2, stroke: rc, 'stroke-width': 1,
    }))
    svg.appendChild(svgNs('text', {
      x: bx + w / 2, y: cy + 4,
      fill: rc, 'font-size': 9, 'font-family': 'Courier New,monospace',
      'text-anchor': 'middle', 'font-weight': '700',
    }, ref))
    bx += w + 4
  }

  // Tag bubble
  const tagName = tagsMap.value.get(row.commit.hash)
  if (tagName) {
    const tw = tagName.length * 5.5 + 10
    svg.appendChild(svgNs('rect', {
      x: bx, y: cy - LC.BADGE_H / 2, width: tw, height: LC.BADGE_H,
      rx: 3, fill: '#f0c040', opacity: 0.25, stroke: '#f0c040', 'stroke-width': 1,
    }))
    svg.appendChild(svgNs('text', {
      x: bx + tw / 2, y: cy + 4,
      fill: '#f0c040', 'font-size': 9, 'font-family': 'Courier New,monospace',
      'text-anchor': 'middle', 'font-weight': '700',
    }, tagName))
    bx += tw + 6
  }

  // Commit message
  const msgX = bx + (bx > textX ? 6 : 0)
  svg.appendChild(svgNs('text', {
    x: msgX, y: cy + 4,
    fill: '#c9d1d9', 'font-size': 11, 'font-family': 'Segoe UI,system-ui,sans-serif',
  }, row.commit.message.slice(0, 72)))

  // Author + hash (right-aligned muted)
  svg.appendChild(svgNs('text', {
    x: textX + 470, y: cy + 4,
    fill: '#6e7681', 'font-size': 9, 'font-family': 'Courier New,monospace',
    'text-anchor': 'end',
  }, `${row.commit.author}  ${row.commit.hash}`))
}

// ══════════════════════════════════════════════════════════════════════════════
// FALLBACK: OLD branchLogs-based rendering (kept for zones without DAG data)
// ══════════════════════════════════════════════════════════════════════════════

function laneY(i: number): number {
  return GFC.PAD_V + GFC.TAG_H + i * GFC.LANE_H + GFC.LANE_H / 2
}

function prepareBranchData(logs: Map<string, BranchLogEntry[]>) {
  const branches = [...logs.keys()].sort((a, b) => {
    const d = getBranchOrder(a) - getBranchOrder(b)
    return d !== 0 ? d : a.localeCompare(b)
  })
  const branchCommits = new Map<string, BranchLogEntry[]>()
  for (const name of branches) {
    const seen = new Set<string>()
    const commits: BranchLogEntry[] = []
    for (const e of logs.get(name)!) if (!seen.has(e.hash)) { seen.add(e.hash); commits.push(e) }
    commits.sort((a, b) => a.time - b.time)
    branchCommits.set(name, commits)
  }
  return { branches, branchCommits }
}

function buildHashMapping(branches: string[], branchCommits: Map<string, BranchLogEntry[]>, contentW: number) {
  const allHashTimes = new Map<string, number>()
  for (const commits of branchCommits.values())
    for (const c of commits) if (!allHashTimes.has(c.hash)) allHashTimes.set(c.hash, c.time)
  const sorted = [...allHashTimes.entries()].sort((a, b) => a[1] - b[1])
  const n = sorted.length
  const hashX = new Map<string, number>()
  for (let i = 0; i < n; i++) {
    const ratio = n <= 1 ? 0.5 : i / (n - 1)
    hashX.set(sorted[i][0], GFC.LABEL_W + 20 + ratio * (contentW - 40))
  }
  const hashLane = new Map<string, number>()
  for (let i = 0; i < branches.length; i++)
    for (const c of branchCommits.get(branches[i])!)
      if (!hashLane.has(c.hash)) hashLane.set(c.hash, i)
  return { hashX, hashLane }
}

function drawDefs(svg: SVGSVGElement): void {
  const defs = svgNs('defs', {})
  const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker')
  marker.setAttribute('id', 'arrow'); marker.setAttribute('markerWidth', '8')
  marker.setAttribute('markerHeight', '8'); marker.setAttribute('refX', '7')
  marker.setAttribute('refY', '3'); marker.setAttribute('orient', 'auto')
  marker.setAttribute('markerUnits', 'strokeWidth')
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  p.setAttribute('d', 'M0,0 L0,6 L8,3 z'); p.setAttribute('fill', 'context-stroke')
  marker.appendChild(p); defs.appendChild(marker); svg.appendChild(defs)
}

function renderOldGraph(svg: SVGSVGElement, logs: Map<string, BranchLogEntry[]>): void {
  svg.innerHTML = ''
  const { branches, branchCommits } = prepareBranchData(logs)
  const totalCommits = new Set([...branchCommits.values()].flatMap(cs => cs.map(c => c.hash))).size
  const contentW = Math.max(totalCommits * GFC.GAP, branches.length * GFC.GAP, 300)
  const { hashX, hashLane } = buildHashMapping(branches, branchCommits, contentW)
  const totalW = GFC.LABEL_W + contentW + 12
  const totalH = GFC.PAD_V + GFC.TAG_H + branches.length * GFC.LANE_H + GFC.PAD_V
  svg.setAttribute('width', String(totalW))
  svg.setAttribute('height', String(totalH))
  drawDefs(svg)

  // Lanes
  for (let i = 0; i < branches.length; i++) {
    const name = branches[i]; const color = getBranchColor(name); const y = laneY(i)
    const commits = branchCommits.get(name)!; if (!commits.length) continue
    svg.appendChild(svgNs('line', { x1: GFC.LABEL_W, y1: y, x2: totalW - 4, y2: y, stroke: color, 'stroke-width': 1, opacity: 0.12, 'stroke-dasharray': '4,3' }))
    const x0 = hashX.get(commits[0].hash)!; const xN = hashX.get(commits[commits.length - 1].hash)!
    if (x0 < xN) svg.appendChild(svgNs('path', { d: `M${x0},${y} L${xN},${y}`, fill: 'none', stroke: color, 'stroke-width': 2, 'marker-end': 'url(#arrow)' }))
    const label = name.startsWith('origin/') ? name.slice(7) : name
    svg.appendChild(svgNs('text', { x: GFC.LABEL_W - 6, y: y + 4, fill: color, 'font-size': 9, 'font-family': 'Courier New,monospace', 'text-anchor': 'end', 'font-weight': '700' }, label))
  }

  // Connections
  for (let i = 0; i < branches.length; i++) {
    const commits = branchCommits.get(branches[i])!; if (!commits.length) continue
    const color = getBranchColor(branches[i]); const y = laneY(i)
    const fc = commits[0]
    if (fc.from !== '0000000' && hashLane.has(fc.from) && hashLane.get(fc.from) !== i) {
      const fromLane = hashLane.get(fc.from)!
      const x1 = hashX.get(fc.from); const y1 = laneY(fromLane); const x2 = hashX.get(fc.hash)
      if (x1 !== undefined && x2 !== undefined) {
        const mx = (x1 + x2) / 2
        svg.appendChild(svgNs('path', { d: `M${x1},${y1} C${mx},${y1} ${mx},${y} ${x2},${y}`, fill: 'none', stroke: color, 'stroke-width': 1.5, opacity: 0.75, 'marker-end': 'url(#arrow)' }))
      }
    }
    const lc = commits[commits.length - 1]; const shortName = branches[i].replace(/^origin\//, '')
    for (let j = 0; j < branches.length; j++) {
      if (j === i) continue
      const mc = branchCommits.get(branches[j])!.find(c => c.time >= lc.time && (c.hash === lc.hash || c.msg.toLowerCase().includes(`merge ${shortName.toLowerCase()}`)))
      if (mc) {
        const x1 = hashX.get(lc.hash); const x2 = hashX.get(mc.hash); const y2 = laneY(j)
        if (x1 !== undefined && x2 !== undefined) {
          const mx = (x1 + x2) / 2
          svg.appendChild(svgNs('path', { d: `M${x1},${y} C${mx},${y} ${mx},${y2} ${x2},${y2}`, fill: 'none', stroke: getBranchColor(branches[j]), 'stroke-width': 1.5, opacity: 0.75, 'marker-end': 'url(#arrow)' }))
        }
        break
      }
    }
  }

  // Nodes
  const headHash = git.lr.length ? git.lr[git.lr.length - 1].hash : null
  for (let i = 0; i < branches.length; i++) {
    const commits = branchCommits.get(branches[i])!; const color = getBranchColor(branches[i]); const y = laneY(i)
    for (let ci = 0; ci < commits.length; ci++) {
      const c = commits[ci]; const x = hashX.get(c.hash); if (x === undefined) continue
      const isHead = c.hash === headHash && (branches[i] === watchStore.branch || branches[i] === `origin/${watchStore.branch}`)
      const tagName = tagsMap.value.get(c.hash)
      if (tagName) {
        const tw = tagName.length * 5.5 + 10; const th = 14
        const tx = x - tw / 2; const ty = y - GFC.R - 8 - th
        svg.appendChild(svgNs('line', { x1: x, y1: ty + th, x2: x, y2: y - GFC.R - 2, stroke: color, 'stroke-width': 1, opacity: 0.8 }))
        svg.appendChild(svgNs('rect', { x: tx, y: ty, width: tw, height: th, rx: 3, fill: color, opacity: 0.18, stroke: color, 'stroke-width': 1 }))
        svg.appendChild(svgNs('text', { x, y: ty + th - 3, fill: color, 'font-size': 9, 'font-family': 'Courier New,monospace', 'text-anchor': 'middle', 'font-weight': '700' }, tagName))
      }
      svg.appendChild(svgNs('circle', { cx: x, cy: y, r: GFC.R, fill: isHead ? '#fff' : color, stroke: color, 'stroke-width': isHead ? 2.5 : 1.5, 'data-hash': c.hash, 'data-msg': c.msg ?? '', 'data-branch': branches[i], style: 'cursor: pointer' }))
      if (isHead || ci === 0 || ci === commits.length - 1) {
        const labelY = tagName ? y - GFC.R - (GFC.TAG_H + 10) : y - GFC.R - 3
        svg.appendChild(svgNs('text', { x, y: labelY, fill: '#8b949e', 'font-size': 7, 'font-family': 'Courier New,monospace', 'text-anchor': 'middle' }, c.hash.slice(0, 7)))
      }
    }
  }
}

// ── Tooltip ───────────────────────────────────────────────────────────────────
function setupTooltipEvents(svg: SVGSVGElement): void {
  svg.addEventListener('mouseover', (e) => {
    const t = e.target as SVGElement; if (t.tagName !== 'circle') return
    tooltip.value = { visible: true, x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY, hash: t.getAttribute('data-hash') ?? '', msg: t.getAttribute('data-msg') ?? '', branch: t.getAttribute('data-branch') ?? '' }
  })
  svg.addEventListener('mousemove', (e) => { const t = e.target as SVGElement; if (t.tagName === 'circle') { tooltip.value.x = (e as MouseEvent).clientX; tooltip.value.y = (e as MouseEvent).clientY } })
  svg.addEventListener('mouseout', (e) => { if ((e.target as SVGElement).tagName === 'circle') tooltip.value.visible = false })
}

// ── Main render ───────────────────────────────────────────────────────────────
function isPackedStub(c: DagCommit): boolean { return c.time === 0 && c.message === '' }

function renderGraph(): void {
  const svg = svgEl.value; if (!svg) return
  svg.innerHTML = ''

  // Use DAG rendering only when real (loose) commits exist.
  // Packed-only stubs have no parent connections so they render as
  // disconnected dots — fall back to branchLogs in that case.
  const realCommits = props.dagCommits?.filter(c => !isPackedStub(c)) ?? []
  if (realCommits.length) {
    renderLaneGraph(svg, computeLanes(props.dagCommits!))
  } else if (props.branchLogs?.size) {
    renderOldGraph(svg, props.branchLogs)
  } else if (props.dagCommits?.length) {
    // Only stubs available — render as last resort
    renderLaneGraph(svg, computeLanes(props.dagCommits))
  } else {
    return
  }
  setupTooltipEvents(svg)
}

vWatch(() => [props.dagCommits, props.branchLogs] as const, async () => {
  await readTagsFromGit(); renderGraph()
}, { flush: 'post', deep: false })

vWatch(tagsMap, () => renderGraph(), { flush: 'post' })

onMounted(async () => { await readTagsFromGit(); renderGraph() })
</script>

<template>
  <div class="overflow-x-auto overflow-y-auto w-full h-full">
    <div
      v-if="!dagCommits?.length && !branchLogs?.size"
      class="flex items-center justify-center h-full text-[10px] text-center px-2"
      style="color: var(--color-text-muted);"
    >
      {{ emptyText ?? 'ブランチ情報がありません' }}
    </div>
    <svg v-else ref="svgEl" style="display: block;"></svg>
  </div>

  <Teleport to="body">
    <div
      v-if="tooltip.visible"
      class="fixed z-[9999] pointer-events-none"
      :style="{ left: tooltip.x + 'px', top: tooltip.y + 14 + 'px', transform: 'translateX(-100%)' }"
    >
      <div class="rounded-md px-3 py-2 text-xs shadow-lg max-w-xs" style="background:#1c2333;border:1px solid #30363d;color:#e6edf3;">
        <div class="font-mono text-[10px] mb-1" style="color:#8b949e;">
          {{ tooltip.hash.slice(0, 7) }}
          <span class="ml-2" :style="{ color: tooltip.branch.includes('origin/') ? '#58a6ff' : '#3fb950' }">
            {{ tooltip.branch.split(',')[0] }}
          </span>
        </div>
        <div class="leading-snug break-words" style="max-width:240px;">{{ tooltip.msg || '(メッセージなし)' }}</div>
      </div>
    </div>
  </Teleport>
</template>
