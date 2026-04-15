<script setup lang="ts">
import { ref, watch as vWatch, onMounted } from 'vue'
import type { BranchLogEntry } from '../types'
import { useWatchStore } from '../stores/watchStore'
import { useGitStore } from '../stores/gitStore'
import { getBranchColor, getBranchOrder } from '../composables/useBranchConfig'

const props = defineProps<{
  branchLogs?: Map<string, BranchLogEntry[]>
  emptyText?: string
}>()

const svgEl = ref<SVGSVGElement>()
const watchStore = useWatchStore()
const git = useGitStore()

const GFC = { LANE_H: 34, R: 4, GAP: 72, LABEL_W: 90, PAD_V: 12 }

function svgNs(tag: string, attrs: Record<string, string | number>, txt?: string): SVGElement {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v))
  if (txt !== undefined) el.textContent = txt
  return el
}

function laneY(i: number): number {
  return GFC.PAD_V + i * GFC.LANE_H + GFC.LANE_H / 2
}

/** Sort branch names, deduplicate commits per branch, and sort commits by time. */
function prepareBranchData(logs: Map<string, BranchLogEntry[]>): {
  branches: string[]
  branchCommits: Map<string, BranchLogEntry[]>
} {
  const branches = [...logs.keys()].sort((a, b) => {
    const da = getBranchOrder(a)
    const db = getBranchOrder(b)
    return da !== db ? da - db : a.localeCompare(b)
  })
  const branchCommits = new Map<string, BranchLogEntry[]>()
  for (const name of branches) {
    const seen = new Set<string>()
    const commits: BranchLogEntry[] = []
    for (const e of logs.get(name)!) {
      if (!seen.has(e.hash)) { seen.add(e.hash); commits.push(e) }
    }
    commits.sort((a, b) => a.time - b.time)
    branchCommits.set(name, commits)
  }
  return { branches, branchCommits }
}

/** Build x-position and lane-index maps keyed by commit hash. */
function buildHashMapping(
  branches: string[],
  branchCommits: Map<string, BranchLogEntry[]>,
  contentW: number
): { hashX: Map<string, number>; hashLane: Map<string, number> } {
  const allHashTimes = new Map<string, number>()
  for (const commits of branchCommits.values())
    for (const c of commits) if (!allHashTimes.has(c.hash)) allHashTimes.set(c.hash, c.time)

  const sortedTimes = [...new Set([...allHashTimes.values()])].sort((a, b) => a - b)
  const minT = sortedTimes[0] ?? 0
  const maxT = sortedTimes[sortedTimes.length - 1] ?? 1
  const span = maxT - minT || 1

  const hashX = new Map<string, number>()
  for (const [h, t] of allHashTimes)
    hashX.set(h, GFC.LABEL_W + 16 + ((t - minT) / span) * (contentW - 32))

  const hashLane = new Map<string, number>()
  for (let i = 0; i < branches.length; i++)
    for (const c of branchCommits.get(branches[i])!)
      if (!hashLane.has(c.hash)) hashLane.set(c.hash, i)

  return { hashX, hashLane }
}

/** Draw lane guide lines and branch labels. */
function drawLanes(
  svg: SVGSVGElement,
  branches: string[],
  branchCommits: Map<string, BranchLogEntry[]>,
  hashX: Map<string, number>,
  totalW: number
): void {
  for (let i = 0; i < branches.length; i++) {
    const name = branches[i]
    const color = getBranchColor(name)
    const y = laneY(i)
    const commits = branchCommits.get(name)!
    if (!commits.length) continue

    svg.appendChild(svgNs('line', {
      x1: GFC.LABEL_W, y1: y, x2: totalW - 4, y2: y,
      stroke: color, 'stroke-width': 1, opacity: 0.15, 'stroke-dasharray': '4,3',
    }))

    const x0 = hashX.get(commits[0].hash)!
    const xN = hashX.get(commits[commits.length - 1].hash)!
    if (x0 < xN)
      svg.appendChild(svgNs('line', { x1: x0, y1: y, x2: xN, y2: y, stroke: color, 'stroke-width': 2 }))

    const label = name.startsWith('origin/') ? name.slice(7) : name
    svg.appendChild(svgNs('text', {
      x: GFC.LABEL_W - 5, y: y + 4, fill: color,
      'font-size': 9, 'font-family': 'Courier New,monospace',
      'text-anchor': 'end', 'font-weight': '700',
    }, label))
  }
}

/** Draw inter-branch bezier connection curves. */
function drawConnections(
  svg: SVGSVGElement,
  branches: string[],
  branchCommits: Map<string, BranchLogEntry[]>,
  hashX: Map<string, number>,
  hashLane: Map<string, number>
): void {
  for (let i = 0; i < branches.length; i++) {
    const commits = branchCommits.get(branches[i])!
    if (!commits.length) continue
    const color = getBranchColor(branches[i])
    const y = laneY(i)

    // Branch-off curve from parent branch
    const fc = commits[0]
    if (fc.from && fc.from !== '0000000' && hashLane.has(fc.from) && hashLane.get(fc.from) !== i) {
      const fromLane = hashLane.get(fc.from)!
      const x1 = hashX.get(fc.from)!
      const y1 = laneY(fromLane)
      const x2 = hashX.get(fc.hash)!
      if (x1 !== undefined && x2 !== undefined) {
        const mx = (x1 + x2) / 2
        svg.appendChild(svgNs('path', {
          d: `M${x1},${y1} C${mx},${y1} ${mx},${y} ${x2},${y}`,
          fill: 'none', stroke: color, 'stroke-width': 1.5, opacity: 0.7,
        }))
      }
    }

    // Merge-into curve to target branch
    const lc = commits[commits.length - 1]
    for (let j = 0; j < branches.length; j++) {
      if (j === i) continue
      const mc = branchCommits.get(branches[j])!.find(c => c.from === lc.hash)
      if (mc) {
        const x1 = hashX.get(lc.hash)!
        const x2 = hashX.get(mc.hash)!
        const y2 = laneY(j)
        if (x1 !== undefined && x2 !== undefined) {
          const mx = (x1 + x2) / 2
          svg.appendChild(svgNs('path', {
            d: `M${x1},${y} C${mx},${y} ${mx},${y2} ${x2},${y2}`,
            fill: 'none', stroke: getBranchColor(branches[j]), 'stroke-width': 1.5, opacity: 0.7,
          }))
        }
        break
      }
    }
  }
}

/** Draw commit circles and short hash labels. */
function drawNodes(
  svg: SVGSVGElement,
  branches: string[],
  branchCommits: Map<string, BranchLogEntry[]>,
  hashX: Map<string, number>
): void {
  const headHash = git.lr.length ? git.lr[git.lr.length - 1].hash : null
  for (let i = 0; i < branches.length; i++) {
    const commits = branchCommits.get(branches[i])!
    const color = getBranchColor(branches[i])
    const y = laneY(i)
    for (let ci = 0; ci < commits.length; ci++) {
      const c = commits[ci]
      const x = hashX.get(c.hash)
      if (x === undefined) continue
      const isHead = c.hash === headHash &&
        (branches[i] === watchStore.branch || branches[i] === `origin/${watchStore.branch}`)
      svg.appendChild(svgNs('circle', {
        cx: x, cy: y, r: GFC.R,
        fill: isHead ? '#fff' : color, stroke: color, 'stroke-width': 2,
      }))
      if (isHead || ci === 0 || ci === commits.length - 1)
        svg.appendChild(svgNs('text', {
          x, y: y - GFC.R - 2, fill: '#8b949e',
          'font-size': 7, 'font-family': 'Courier New,monospace', 'text-anchor': 'middle',
        }, c.hash))
    }
  }
}

function renderGraph(): void {
  const svg = svgEl.value
  if (!svg || !props.branchLogs?.size) return
  svg.innerHTML = ''

  const { branches, branchCommits } = prepareBranchData(props.branchLogs)
  const contentW = Math.max(branches.length * GFC.GAP, 260)
  const { hashX, hashLane } = buildHashMapping(branches, branchCommits, contentW)

  const totalW = GFC.LABEL_W + contentW + 8
  const totalH = GFC.PAD_V + branches.length * GFC.LANE_H + GFC.PAD_V
  svg.setAttribute('width', String(totalW))
  svg.setAttribute('height', String(totalH))

  drawLanes(svg, branches, branchCommits, hashX, totalW)
  drawConnections(svg, branches, branchCommits, hashX, hashLane)
  drawNodes(svg, branches, branchCommits, hashX)
}

vWatch(() => props.branchLogs, () => renderGraph(), { flush: 'post', deep: false })
onMounted(() => renderGraph())
</script>

<template>
  <div class="overflow-x-auto overflow-y-auto w-full h-full">
    <div v-if="!branchLogs?.size" class="flex items-center justify-center h-full text-[10px] text-center px-2" style="color: var(--color-text-muted);">
      {{ emptyText ?? 'ブランチ情報がありません' }}
    </div>
    <svg v-else ref="svgEl" style="display: block;"></svg>
  </div>
</template>
