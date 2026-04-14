<script setup lang="ts">
import { ref, watch as vWatch, onMounted } from 'vue'
import type { BranchLogEntry } from '../types'
import { useWatchStore } from '../stores/watchStore'
import { useGitStore } from '../stores/gitStore'

const props = defineProps<{ branchLogs?: Map<string, BranchLogEntry[]> }>()
const collapsed = ref(false)
const svgEl = ref<SVGSVGElement>()
const watchStore = useWatchStore()
const git = useGitStore()

const GFC = { LANE_H: 38, R: 5, GAP: 80, LABEL_W: 90, PAD_V: 14 }
const BRANCH_CLR: Record<string, string> = {
  main: '#f85149', master: '#f85149',
  develop: '#58a6ff', hotfix: '#e3b341',
  release: '#3fb950', feature: '#a78bfa',
}

function branchOrder(n: string): number {
  if (n === 'main' || n === 'master') return 0
  if (n.startsWith('hotfix')) return 1
  if (n.startsWith('release')) return 2
  if (n === 'develop') return 3
  return 4
}

function branchColor(n: string): string {
  for (const [k, v] of Object.entries(BRANCH_CLR)) {
    if (n === k || n.startsWith(k + '/') || n.startsWith(k + '-')) return v
  }
  return '#8b949e'
}

function svgNs(tag: string, attrs: Record<string, string | number>, txt?: string): SVGElement {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v))
  if (txt !== undefined) el.textContent = txt
  return el
}

function renderGraph() {
  const svg = svgEl.value
  if (!svg || !props.branchLogs?.size) return
  svg.innerHTML = ''

  const branches = [...props.branchLogs.keys()].sort((a, b) => {
    const d = branchOrder(a) - branchOrder(b)
    return d !== 0 ? d : a.localeCompare(b)
  })

  const branchCommits = new Map<string, BranchLogEntry[]>()
  for (const name of branches) {
    const seen = new Set<string>()
    const commits: BranchLogEntry[] = []
    for (const e of props.branchLogs!.get(name)!) {
      if (!seen.has(e.hash)) { seen.add(e.hash); commits.push(e) }
    }
    commits.sort((a, b) => a.time - b.time)
    branchCommits.set(name, commits)
  }

  const allHashTimes = new Map<string, number>()
  for (const commits of branchCommits.values())
    for (const c of commits) if (!allHashTimes.has(c.hash)) allHashTimes.set(c.hash, c.time)

  const sortedTimes = [...new Set([...allHashTimes.values()])].sort((a, b) => a - b)
  const minT = sortedTimes[0] ?? 0, maxT = sortedTimes[sortedTimes.length - 1] ?? 1
  const span = maxT - minT || 1
  const contentW = Math.max(sortedTimes.length * GFC.GAP, 320)

  const hashX = new Map<string, number>()
  for (const [h, t] of allHashTimes) hashX.set(h, GFC.LABEL_W + 20 + ((t - minT) / span) * (contentW - 40))

  const hashLane = new Map<string, number>()
  for (let i = 0; i < branches.length; i++)
    for (const c of branchCommits.get(branches[i])!)
      if (!hashLane.has(c.hash)) hashLane.set(c.hash, i)

  const totalW = GFC.LABEL_W + contentW + 16
  const totalH = GFC.PAD_V + branches.length * GFC.LANE_H + GFC.PAD_V
  svg.setAttribute('width', String(totalW))
  svg.setAttribute('height', String(totalH))

  function laneY(i: number) { return GFC.PAD_V + i * GFC.LANE_H + GFC.LANE_H / 2 }

  for (let i = 0; i < branches.length; i++) {
    const name = branches[i]; const color = branchColor(name); const y = laneY(i)
    const commits = branchCommits.get(name)!
    if (!commits.length) continue
    svg.appendChild(svgNs('line', { x1: GFC.LABEL_W, y1: y, x2: totalW - 8, y2: y, stroke: color, 'stroke-width': 1, opacity: 0.15, 'stroke-dasharray': '4,3' }))
    const x0 = hashX.get(commits[0].hash)!; const xN = hashX.get(commits[commits.length - 1].hash)!
    if (x0 < xN) svg.appendChild(svgNs('line', { x1: x0, y1: y, x2: xN, y2: y, stroke: color, 'stroke-width': 2 }))
    svg.appendChild(svgNs('text', { x: GFC.LABEL_W - 6, y: y + 4, fill: color, 'font-size': 10, 'font-family': 'Courier New,monospace', 'text-anchor': 'end', 'font-weight': '700' }, name))
  }

  for (let i = 0; i < branches.length; i++) {
    const commits = branchCommits.get(branches[i])!
    if (!commits.length) continue
    const color = branchColor(branches[i]); const y = laneY(i)
    const fc = commits[0]
    if (fc.from && fc.from !== '0000000' && hashLane.has(fc.from) && hashLane.get(fc.from) !== i) {
      const fromLane = hashLane.get(fc.from)!
      const x1 = hashX.get(fc.from)!, y1 = laneY(fromLane), x2 = hashX.get(fc.hash)!
      if (x1 !== undefined && x2 !== undefined) {
        const mx = (x1 + x2) / 2
        svg.appendChild(svgNs('path', { d: `M${x1},${y1} C${mx},${y1} ${mx},${y} ${x2},${y}`, fill: 'none', stroke: color, 'stroke-width': 1.5, opacity: 0.7 }))
      }
    }
    const lc = commits[commits.length - 1]
    for (let j = 0; j < branches.length; j++) {
      if (j === i) continue
      const mc = branchCommits.get(branches[j])!.find(c => c.from === lc.hash)
      if (mc) {
        const x1 = hashX.get(lc.hash)!, x2 = hashX.get(mc.hash)!, y2 = laneY(j)
        if (x1 !== undefined && x2 !== undefined) {
          const mx = (x1 + x2) / 2
          svg.appendChild(svgNs('path', { d: `M${x1},${y} C${mx},${y} ${mx},${y2} ${x2},${y2}`, fill: 'none', stroke: branchColor(branches[j]), 'stroke-width': 1.5, opacity: 0.7 }))
        }
        break
      }
    }
  }

  const headHash = git.lr.length ? git.lr[git.lr.length - 1].hash : null
  for (let i = 0; i < branches.length; i++) {
    const commits = branchCommits.get(branches[i])!
    const color = branchColor(branches[i]); const y = laneY(i)
    for (let ci = 0; ci < commits.length; ci++) {
      const c = commits[ci]; const x = hashX.get(c.hash)
      if (x === undefined) continue
      const isHead = c.hash === headHash && branches[i] === watchStore.branch
      svg.appendChild(svgNs('circle', { cx: x, cy: y, r: GFC.R, fill: isHead ? '#fff' : color, stroke: color, 'stroke-width': 2 }))
      if (isHead || ci === 0 || ci === commits.length - 1)
        svg.appendChild(svgNs('text', { x, y: y - GFC.R - 3, fill: '#8b949e', 'font-size': 8, 'font-family': 'Courier New,monospace', 'text-anchor': 'middle' }, c.hash))
    }
  }
}

vWatch(() => [props.branchLogs, collapsed.value], () => {
  if (!collapsed.value) renderGraph()
}, { flush: 'post' })

onMounted(() => renderGraph())
</script>

<template>
  <div class="rounded-lg overflow-hidden border shrink-0" style="border-color: var(--color-border); background: var(--color-surface);">
    <div class="flex items-center justify-between px-3 py-1.5 cursor-pointer text-xs border-b" style="border-color: var(--color-border); color: var(--color-text-muted);" @click="collapsed = !collapsed">
      <span>🌿 ブランチグラフ</span>
      <span>{{ collapsed ? '▶' : '▼' }}</span>
    </div>
    <div v-if="!collapsed" class="overflow-x-auto" style="min-height: 60px; max-height: 200px;">
      <div v-if="!branchLogs?.size" class="flex items-center justify-center h-16 text-xs" style="color: var(--color-text-muted);">フォルダを開くとブランチグラフが表示されます</div>
      <svg v-else ref="svgEl" style="display: block;"></svg>
    </div>
  </div>
</template>
