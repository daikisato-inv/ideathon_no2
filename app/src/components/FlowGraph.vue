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

/** Graph layout constants */
const GFC = { LANE_H: 44, R: 7, GAP: 88, LABEL_W: 100, PAD_V: 28, TAG_H: 18 }

const tooltip = ref<{ visible: boolean; x: number; y: number; hash: string; msg: string; branch: string }>({
  visible: false, x: 0, y: 0, hash: '', msg: '', branch: '',
})

/** hash (7-char) → tag name */
const tagsMap = ref<Map<string, string>>(new Map())

// ── Helpers ───────────────────────────────────────────────────────────────────

function svgNs(tag: string, attrs: Record<string, string | number>, txt?: string): SVGElement {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v))
  if (txt !== undefined) el.textContent = txt
  return el
}

function laneY(i: number): number {
  return GFC.PAD_V + GFC.TAG_H + i * GFC.LANE_H + GFC.LANE_H / 2
}

// ── Tag reading ───────────────────────────────────────────────────────────────

async function readTagsFromGit(): Promise<void> {
  const gitHandle = watchStore.gitHandle
  if (!gitHandle) return
  const result = new Map<string, string>()

  // Loose tags: .git/refs/tags/<name>
  try {
    const refsDir = await gitHandle.getDirectoryHandle('refs')
    const tagsDir = await refsDir.getDirectoryHandle('tags')
    for await (const [name, handle] of (tagsDir as unknown as AsyncIterable<[string, FileSystemHandle]>)) {
      if (handle.kind !== 'file') continue
      try {
        const text = await (await (handle as FileSystemFileHandle).getFile()).text()
        const hash = text.trim().slice(0, 7)
        result.set(hash, name)
      } catch { /* skip */ }
    }
  } catch { /* no tags dir */ }

  // Packed refs: .git/packed-refs
  try {
    const f = await (await gitHandle.getFileHandle('packed-refs')).getFile()
    const text = await f.text()
    for (const line of text.split('\n')) {
      if (line.startsWith('#') || !line.includes('refs/tags/')) continue
      const [hash, ref] = line.split(' ')
      if (hash && ref) result.set(hash.slice(0, 7), ref.replace('refs/tags/', ''))
    }
  } catch { /* no packed-refs */ }

  tagsMap.value = result
}

// ── Data preparation ──────────────────────────────────────────────────────────

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

function buildHashMapping(
  branches: string[],
  branchCommits: Map<string, BranchLogEntry[]>,
  contentW: number
): { hashX: Map<string, number>; hashLane: Map<string, number> } {
  const allHashTimes = new Map<string, number>()
  for (const commits of branchCommits.values())
    for (const c of commits) if (!allHashTimes.has(c.hash)) allHashTimes.set(c.hash, c.time)

  const sortedHashes = [...allHashTimes.entries()].sort((a, b) => a[1] - b[1])
  const n = sortedHashes.length

  const hashX = new Map<string, number>()
  for (let i = 0; i < n; i++) {
    const [h] = sortedHashes[i]
    const ratio = n <= 1 ? 0.5 : i / (n - 1)
    hashX.set(h, GFC.LABEL_W + 20 + ratio * (contentW - 40))
  }

  const hashLane = new Map<string, number>()
  for (let i = 0; i < branches.length; i++)
    for (const c of branchCommits.get(branches[i])!)
      if (!hashLane.has(c.hash)) hashLane.set(c.hash, i)

  return { hashX, hashLane }
}

// ── SVG drawing functions ─────────────────────────────────────────────────────

/**
 * Add <defs> with a reusable arrowhead marker.
 * Uses context-stroke so arrows inherit the path's stroke color (Chrome/Edge supported).
 */
function drawDefs(svg: SVGSVGElement): void {
  const defs = svgNs('defs', {})
  const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker')
  marker.setAttribute('id', 'arrow')
  marker.setAttribute('markerWidth', '8')
  marker.setAttribute('markerHeight', '8')
  marker.setAttribute('refX', '7')
  marker.setAttribute('refY', '3')
  marker.setAttribute('orient', 'auto')
  marker.setAttribute('markerUnits', 'strokeWidth')
  const arrowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  arrowPath.setAttribute('d', 'M0,0 L0,6 L8,3 z')
  arrowPath.setAttribute('fill', 'context-stroke')
  marker.appendChild(arrowPath)
  defs.appendChild(marker)
  svg.appendChild(defs)
}

/** Draw lane guide lines, solid segment lines with arrow, and branch labels. */
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

    // Full-width dashed guide line
    svg.appendChild(svgNs('line', {
      x1: GFC.LABEL_W, y1: y, x2: totalW - 4, y2: y,
      stroke: color, 'stroke-width': 1, opacity: 0.12, 'stroke-dasharray': '4,3',
    }))

    const x0 = hashX.get(commits[0].hash)!
    const xN = hashX.get(commits[commits.length - 1].hash)!

    if (x0 < xN) {
      // Solid segment line with arrowhead pointing in direction of time
      svg.appendChild(svgNs('path', {
        d: `M${x0},${y} L${xN},${y}`,
        fill: 'none', stroke: color, 'stroke-width': 2,
        'marker-end': 'url(#arrow)',
      }))
    }

    const label = name.startsWith('origin/') ? name.slice(7) : name
    svg.appendChild(svgNs('text', {
      x: GFC.LABEL_W - 6, y: y + 4, fill: color,
      'font-size': 9, 'font-family': 'Courier New,monospace',
      'text-anchor': 'end', 'font-weight': '700',
    }, label))
  }
}

/** Draw inter-branch bezier connection curves with arrowheads. */
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

    // ── Branch-off curve from parent branch ──────────────────────────────────
    const fc = commits[0]
    if (fc.from !== '0000000' && hashLane.has(fc.from) && hashLane.get(fc.from) !== i) {
      const fromLane = hashLane.get(fc.from)!
      const x1 = hashX.get(fc.from)
      const y1 = laneY(fromLane)
      const x2 = hashX.get(fc.hash)
      if (x1 !== undefined && x2 !== undefined) {
        const mx = (x1 + x2) / 2
        svg.appendChild(svgNs('path', {
          d: `M${x1},${y1} C${mx},${y1} ${mx},${y} ${x2},${y}`,
          fill: 'none', stroke: color, 'stroke-width': 1.5, opacity: 0.75,
          'marker-end': 'url(#arrow)',
        }))
      }
    } else if (fc.from === '0000000') {
      // Remote tracking branch: infer parent by nearest higher-priority branch
      const myOrder = getBranchOrder(branches[i])
      let parentIdx = -1, parentOrder = -1
      for (let j = 0; j < branches.length; j++) {
        if (j === i) continue
        const jOrder = getBranchOrder(branches[j])
        if (jOrder < myOrder && jOrder > parentOrder) { parentIdx = j; parentOrder = jOrder }
      }
      if (parentIdx >= 0) {
        const parentCommits = branchCommits.get(branches[parentIdx])!
        const parentAtTime = parentCommits.filter(c => c.time <= fc.time).slice(-1)[0]
        if (parentAtTime) {
          const x1 = hashX.get(parentAtTime.hash)
          const x2 = hashX.get(fc.hash)
          const y1 = laneY(parentIdx)
          if (x1 !== undefined && x2 !== undefined && x1 !== x2) {
            const mx = (x1 + x2) / 2
            svg.appendChild(svgNs('path', {
              d: `M${x1},${y1} C${mx},${y1} ${mx},${y} ${x2},${y}`,
              fill: 'none', stroke: color, 'stroke-width': 1.5, opacity: 0.75,
              'marker-end': 'url(#arrow)',
            }))
          }
        }
      }
    }

    // ── Merge-into curve to target branch ────────────────────────────────────
    const lc = commits[commits.length - 1]
    const shortName = branches[i].replace(/^origin\//, '')
    for (let j = 0; j < branches.length; j++) {
      if (j === i) continue
      const mc = branchCommits.get(branches[j])!.find(c =>
        c.time >= lc.time && (
          c.hash === lc.hash ||
          c.msg.toLowerCase().includes(`merge ${shortName.toLowerCase()}`) ||
          c.msg.toLowerCase().includes(`merge branch '${shortName.toLowerCase()}'`)
        )
      )
      if (mc) {
        const targetColor = getBranchColor(branches[j])
        const x1 = hashX.get(lc.hash)
        const x2 = hashX.get(mc.hash)
        const y2 = laneY(j)
        if (x1 !== undefined && x2 !== undefined) {
          const mx = (x1 + x2) / 2
          svg.appendChild(svgNs('path', {
            d: `M${x1},${y} C${mx},${y} ${mx},${y2} ${x2},${y2}`,
            fill: 'none', stroke: targetColor, 'stroke-width': 1.5, opacity: 0.75,
            'marker-end': 'url(#arrow)',
          }))
        }
        break
      }
    }
  }
}

/** Draw a tag speech bubble above a commit node. */
function drawTagBubble(
  svg: SVGSVGElement,
  cx: number,
  cy: number,
  tagName: string,
  color: string
): void {
  const FONT_SIZE = 9
  const PAD_X = 5
  const PAD_Y = 3
  const textWidth = tagName.length * (FONT_SIZE * 0.62) + PAD_X * 2
  const textHeight = FONT_SIZE + PAD_Y * 2
  const bubbleX = cx - textWidth / 2
  const bubbleY = cy - GFC.R - 6 - textHeight
  const tailX = cx
  const tailY1 = bubbleY + textHeight
  const tailY2 = cy - GFC.R - 2

  // Tail line from bubble bottom to commit top
  svg.appendChild(svgNs('line', {
    x1: tailX, y1: tailY1, x2: tailX, y2: tailY2,
    stroke: color, 'stroke-width': 1, opacity: 0.8,
  }))

  // Bubble rectangle
  svg.appendChild(svgNs('rect', {
    x: bubbleX, y: bubbleY,
    width: textWidth, height: textHeight,
    rx: 3, ry: 3,
    fill: color, opacity: 0.18,
    stroke: color, 'stroke-width': 1,
  }))

  // Tag label
  svg.appendChild(svgNs('text', {
    x: cx, y: bubbleY + PAD_Y + FONT_SIZE - 1,
    fill: color,
    'font-size': FONT_SIZE, 'font-family': 'Courier New,monospace',
    'text-anchor': 'middle', 'font-weight': '700',
  }, tagName))
}

/** Draw commit circles, hash labels, and tag bubbles. */
function drawNodes(
  svg: SVGSVGElement,
  branches: string[],
  branchCommits: Map<string, BranchLogEntry[]>,
  hashX: Map<string, number>
): void {
  const headHash = git.lr.length ? git.lr[git.lr.length - 1].hash : null
  const tags = tagsMap.value

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

      // Tag bubble (shown above the node if this commit is tagged)
      const tagName = tags.get(c.hash)
      if (tagName) {
        drawTagBubble(svg, x, y, tagName, color)
      }

      // Commit circle
      const circle = svgNs('circle', {
        cx: x, cy: y, r: GFC.R,
        fill: isHead ? '#fff' : color,
        stroke: color, 'stroke-width': isHead ? 2.5 : 1.5,
        'data-hash': c.hash,
        'data-msg': c.msg ?? '',
        'data-branch': branches[i],
        style: 'cursor: pointer',
      })
      svg.appendChild(circle)

      // Short hash label above node (shown for HEAD, first, or last commit)
      if (isHead || ci === 0 || ci === commits.length - 1) {
        // If there's a tag bubble, push the hash label further up
        const labelY = tagName ? y - GFC.R - (GFC.TAG_H + 10) : y - GFC.R - 3
        svg.appendChild(svgNs('text', {
          x, y: labelY, fill: '#8b949e',
          'font-size': 7, 'font-family': 'Courier New,monospace', 'text-anchor': 'middle',
        }, c.hash.slice(0, 7)))
      }
    }
  }
}

/** Attach tooltip event delegation to SVG. */
function setupTooltipEvents(svg: SVGSVGElement): void {
  svg.addEventListener('mouseover', (e) => {
    const target = e.target as SVGElement
    if (target.tagName !== 'circle') return
    tooltip.value = {
      visible: true,
      x: (e as MouseEvent).clientX,
      y: (e as MouseEvent).clientY,
      hash: target.getAttribute('data-hash') ?? '',
      msg: target.getAttribute('data-msg') ?? '',
      branch: target.getAttribute('data-branch') ?? '',
    }
  })
  svg.addEventListener('mousemove', (e) => {
    const target = e.target as SVGElement
    if (target.tagName === 'circle') {
      tooltip.value.x = (e as MouseEvent).clientX
      tooltip.value.y = (e as MouseEvent).clientY
    }
  })
  svg.addEventListener('mouseout', (e) => {
    const target = e.target as SVGElement
    if (target.tagName === 'circle') tooltip.value.visible = false
  })
}

// ── Main render ───────────────────────────────────────────────────────────────

function renderGraph(): void {
  const svg = svgEl.value
  if (!svg || !props.branchLogs?.size) return
  svg.innerHTML = ''

  const { branches, branchCommits } = prepareBranchData(props.branchLogs)
  const totalCommits = new Set([...branchCommits.values()].flatMap(cs => cs.map(c => c.hash))).size
  const contentW = Math.max(totalCommits * GFC.GAP, branches.length * GFC.GAP, 300)
  const { hashX, hashLane } = buildHashMapping(branches, branchCommits, contentW)

  const totalW = GFC.LABEL_W + contentW + 12
  // Extra vertical space for tag bubbles at top (PAD_V already includes TAG_H)
  const totalH = GFC.PAD_V + GFC.TAG_H + branches.length * GFC.LANE_H + GFC.PAD_V
  svg.setAttribute('width', String(totalW))
  svg.setAttribute('height', String(totalH))

  drawDefs(svg)
  drawLanes(svg, branches, branchCommits, hashX, totalW)
  drawConnections(svg, branches, branchCommits, hashX, hashLane)
  drawNodes(svg, branches, branchCommits, hashX)
  setupTooltipEvents(svg)
}

vWatch(() => props.branchLogs, async () => {
  await readTagsFromGit()
  renderGraph()
}, { flush: 'post', deep: false })

vWatch(tagsMap, () => renderGraph(), { flush: 'post' })

onMounted(async () => {
  await readTagsFromGit()
  renderGraph()
})
</script>

<template>
  <div class="overflow-x-auto overflow-y-auto w-full h-full">
    <div v-if="!branchLogs?.size" class="flex items-center justify-center h-full text-[10px] text-center px-2" style="color: var(--color-text-muted);">
      {{ emptyText ?? 'ブランチ情報がありません' }}
    </div>
    <svg v-else ref="svgEl" style="display: block;"></svg>
  </div>

  <!-- Commit tooltip (Teleport to body to avoid overflow clipping) -->
  <Teleport to="body">
    <div
      v-if="tooltip.visible"
      class="fixed z-[9999] pointer-events-none"
      :style="{ left: tooltip.x + 'px', top: tooltip.y + 14 + 'px', transform: 'translateX(-100%)' }"
    >
      <div
        class="rounded-md px-3 py-2 text-xs shadow-lg max-w-xs"
        style="background: #1c2333; border: 1px solid #30363d; color: #e6edf3;"
      >
        <div class="font-mono text-[10px] mb-1" style="color: #8b949e;">
          {{ tooltip.hash.slice(0, 7) }}
          <span class="ml-2" :style="{ color: tooltip.branch.startsWith('origin/') ? '#58a6ff' : '#3fb950' }">
            {{ tooltip.branch.startsWith('origin/') ? tooltip.branch.slice(7) : tooltip.branch }}
          </span>
        </div>
        <div class="leading-snug break-words" style="max-width: 240px;">
          {{ tooltip.msg || '(メッセージなし)' }}
        </div>
      </div>
    </div>
  </Teleport>
</template>
