<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useGitStore } from './stores/gitStore'
import { useWatchStore } from './stores/watchStore'
import { readAllBranchLogs } from './composables/useGitLog'
import type { BranchLogEntry } from './types'
import AppHeader from './components/AppHeader.vue'
import CompatBanner from './components/CompatBanner.vue'
import GhModal from './components/GhModal.vue'
import GitZone from './components/GitZone.vue'
import FlowGraph from './components/FlowGraph.vue'
import Terminal from './components/Terminal.vue'
import StatusBar from './components/StatusBar.vue'

const git = useGitStore()
const watch = useWatchStore()
const ghModalVisible = ref(false)
const branchLogs = ref<Map<string, BranchLogEntry[]>>(new Map())

// Refresh branch logs periodically when connected
let branchLogInterval: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  branchLogInterval = setInterval(async () => {
    if (watch.gitHandle) branchLogs.value = await readAllBranchLogs()
  }, 2000)
})
</script>

<template>
  <div class="h-screen flex flex-col overflow-hidden" style="background: var(--color-bg); color: var(--color-text); font-family: 'Segoe UI', system-ui, sans-serif;">
    <AppHeader @open-gh-modal="ghModalVisible = true" />
    <CompatBanner />

    <div class="flex-1 flex flex-col overflow-hidden p-2 gap-2">
      <!-- Main flow layout -->
      <div class="flex flex-1 min-h-0 gap-0">

        <!-- Local box -->
        <div class="flex flex-col overflow-hidden rounded-xl border-2 flex-[10] min-w-0" style="border-color: #2d4f7a; background: rgba(13,33,55,.25);">
          <div class="px-3 py-1 text-[10px] font-bold tracking-widest flex items-center justify-between shrink-0" style="color: var(--color-text-muted);">
            <span>💻 ローカル (Local)</span>
            <span v-if="watch.rootHandle" class="flex items-center gap-1 text-[10px]" style="color: var(--color-success);">
              <span class="w-1.5 h-1.5 rounded-full animate-[blink_1.5s_ease-in-out_infinite]" style="background: var(--color-success);"></span>監視中
            </span>
          </div>
          <div class="flex flex-1 min-h-0 overflow-hidden gap-2 p-2">
            <GitZone zone-type="wd" :files="git.wd" />
            <!-- Arrow: git add -->
            <div class="flex flex-col items-center justify-center px-1 gap-0.5 shrink-0" style="color: var(--color-text-muted);">
              <span class="text-[10px]">git add</span>
              <span class="text-base">→</span>
            </div>
            <GitZone zone-type="sa" :files="git.sa" />
            <!-- Arrow: git commit -->
            <div class="flex flex-col items-center justify-center px-1 gap-0.5 shrink-0" style="color: var(--color-text-muted);">
              <span class="text-[10px]">git commit</span>
              <span class="text-base">→</span>
            </div>
            <GitZone zone-type="lr" :commits="git.lr" />
          </div>
        </div>

        <!-- push/fetch arrows -->
        <div class="flex flex-col items-center justify-center px-2 gap-0.5 shrink-0 text-xs" style="color: var(--color-text-muted);">
          <span>git push →</span>
          <span class="text-xl">⇄</span>
          <span>← git fetch</span>
        </div>

        <!-- Remote box -->
        <div class="flex flex-col overflow-hidden rounded-xl border-2 shrink-0" style="width: 200px; border-color: var(--color-remote-border); background: rgba(21,13,31,.4);">
          <div class="px-3 py-1 text-[10px] font-bold tracking-widest shrink-0" style="color: var(--color-text-muted);">☁️ リモート (Remote)</div>
          <div class="flex-1 p-2 min-h-0 overflow-hidden">
            <GitZone zone-type="rr" :commits="git.rr" is-remote />
          </div>
        </div>
      </div>

      <!-- Branch Flow Graph -->
      <FlowGraph :branch-logs="branchLogs" />

      <!-- Terminal -->
      <Terminal />
    </div>

    <StatusBar />

    <!-- GitHub Modal -->
    <GhModal :visible="ghModalVisible" @close="ghModalVisible = false" />
  </div>
</template>
