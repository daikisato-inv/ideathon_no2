<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useGitStore } from './stores/gitStore'
import { useWatchStore } from './stores/watchStore'
import { readAllBranchLogs, readAllRemoteBranchLogs } from './composables/useGitLog'
import { buildDag } from './composables/useGitDag'
import type { BranchLogEntry, DagCommit } from './types'
import AppHeader from './components/AppHeader.vue'
import CompatBanner from './components/CompatBanner.vue'
import GhModal from './components/GhModal.vue'
import GitZone from './components/GitZone.vue'
import StatusBar from './components/StatusBar.vue'

const git = useGitStore()
const watch = useWatchStore()
const ghModalVisible = ref(false)

// Branch logs for each commit zone
const localBranchLogs = ref<Map<string, BranchLogEntry[]>>(new Map())
const remoteBranchLogs = ref<Map<string, BranchLogEntry[]>>(new Map())
const dagCommits = ref<DagCommit[]>([])

// RR: convert git.rr (GitHub API flat list) to a single-branch branchLogs map
const rrBranchLogs = computed<Map<string, BranchLogEntry[]>>(() => {
  if (!git.rr.length) return new Map()
  const branchName = watch.branch || 'main'
  const entries: BranchLogEntry[] = git.rr.map((c, i) => ({
    from: git.rr[i - 1]?.hash ?? '0000000',
    hash: c.hash,
    fullHash: c.hash,
    time: Date.now() - (git.rr.length - i) * 60000,
    msg: c.msg,
  }))
  return new Map([[branchName, entries]])
})

let branchLogInterval: ReturnType<typeof setInterval> | null = null

async function refreshBranchLogs() {
  if (!watch.gitHandle) return

  // Merge into existing map so deleted branches remain visible as history
  const freshLocal = await readAllBranchLogs()
  const mergedLocal = new Map(localBranchLogs.value)
  for (const [branch, entries] of freshLocal) mergedLocal.set(branch, entries)
  localBranchLogs.value = mergedLocal

  const freshRemote = await readAllRemoteBranchLogs()
  const mergedRemote = new Map(remoteBranchLogs.value)
  for (const [branch, entries] of freshRemote) mergedRemote.set(branch, entries)
  remoteBranchLogs.value = mergedRemote

  try {
    dagCommits.value = await buildDag(watch.gitHandle)
  } catch {
    // DAG build failed silently; keep previous value
  }
}

onMounted(() => {
  branchLogInterval = setInterval(refreshBranchLogs, 2000)
})

onUnmounted(() => {
  if (branchLogInterval) clearInterval(branchLogInterval)
})
</script>

<template>
  <div class="h-screen flex flex-col overflow-hidden" style="background: var(--color-bg); color: var(--color-text); font-family: 'Segoe UI', system-ui, sans-serif;">
    <AppHeader @open-gh-modal="ghModalVisible = true" />
    <CompatBanner />

    <div class="flex-1 flex flex-col overflow-hidden p-2 gap-2">

      <!-- 5-zone main flow: WD → SA → LR → RT (local) ⇄ RR (remote) -->
      <div class="flex flex-1 min-h-0 gap-0 items-stretch">

        <!-- ── Local box: WD + SA + LR + RT ── -->
        <div class="flex flex-col overflow-hidden rounded-xl border-2 flex-[9] min-w-0" style="border-color: #2d4f7a; background: rgba(13,33,55,.25);">
          <div class="px-3 py-1 text-[10px] font-bold tracking-widest flex items-center justify-between shrink-0" style="color: var(--color-text-muted);">
            <span>💻 ローカル (Local)</span>
            <span v-if="watch.rootHandle" class="flex items-center gap-1 text-[10px]" style="color: var(--color-success);">
              <span class="w-1.5 h-1.5 rounded-full animate-[blink_1.5s_ease-in-out_infinite]" style="background: var(--color-success);"></span>監視中
            </span>
          </div>
          <div class="flex flex-1 min-h-0 overflow-hidden gap-2 p-2">
            <GitZone zone-type="wd" :files="git.wd" />
            <!-- git add -->
            <div class="flex flex-col items-center justify-center px-1 gap-0.5 shrink-0" style="color: var(--color-text-muted);">
              <span class="text-[10px]">git add</span>
              <span class="text-base">→</span>
            </div>
            <GitZone zone-type="sa" :files="git.sa" />
            <!-- git commit -->
            <div class="flex flex-col items-center justify-center px-1 gap-0.5 shrink-0" style="color: var(--color-text-muted);">
              <span class="text-[10px]">git commit</span>
              <span class="text-base">→</span>
            </div>
            <GitZone zone-type="lr" :commits="git.lr" :branch-logs="localBranchLogs.size ? localBranchLogs : undefined" :dag-commits="dagCommits" />
            <!-- RT → LR: git merge -->
            <div class="flex flex-col items-center justify-center px-1 gap-0.5 shrink-0 text-[9px]">
              <span style="color: #ff0000;">git merge</span>
              <span class="text-sm" style="color: #ff0000;">←</span>
              <span style="color: #F58220;">git pull</span>
              <span class="text-sm" style="color: #f58220;">←</span>
            </div>
            <GitZone zone-type="rt" :commits="git.rt" :branch-logs="remoteBranchLogs.size ? remoteBranchLogs : undefined" :dag-commits="dagCommits" />
          </div>
        </div>

        <!-- Local ⇄ Remote boundary -->
        <div class="flex flex-col items-center justify-center px-2 gap-1 shrink-0 text-[9px]">
          <!-- git push: LR → RR -->
          <span style="color: var(--color-text-muted);">git push</span>
          <span class="text-base">→</span>
          <!-- divider -->
          <div class="w-full my-1" style="border-top: 1px solid rgba(255,255,255,.1);"></div>
          <!-- git fetch: RR → RT -->
          <span style="color: #ffff00;">git fetch</span>
          <span class="text-sm" style="color: #ffff00;">←</span>
          <!-- git pull = fetch + merge, color-coded -->
          <span style="color: #F58220;">git pull</span>
          <span class="text-sm" style="color: #f58220;">←</span>
        </div>

        <!-- ── Remote Repo box ── -->
        <div class="flex flex-col overflow-hidden rounded-xl border-2 shrink-0" style="width: 180px; border-color: var(--color-remote-border); background: rgba(21,13,31,.4);">
          <div class="px-3 py-1 text-[10px] font-bold tracking-widest shrink-0" style="color: var(--color-text-muted);">☁️ リモート (Remote)</div>
          <div class="flex-1 p-2 min-h-0 overflow-hidden">
            <GitZone zone-type="rr" :commits="git.rr" :branch-logs="rrBranchLogs.size ? rrBranchLogs : undefined" is-remote />
          </div>
        </div>

      </div>

    </div>

    <StatusBar />
    <GhModal :visible="ghModalVisible" @close="ghModalVisible = false" />
  </div>
</template>
