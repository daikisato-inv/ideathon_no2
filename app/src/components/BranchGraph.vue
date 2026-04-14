<script setup lang="ts">
import { computed } from 'vue'
import type { CommitEntry } from '../types'
import { useWatchStore } from '../stores/watchStore'

const props = defineProps<{ commits: CommitEntry[]; isRemote?: boolean }>()
const watch = useWatchStore()
const nodeColor = computed(() => props.isRemote ? 'var(--color-remote-border)' : 'var(--color-local-border)')

function nodeBg(i: number): string {
  const headHash = props.commits.length ? props.commits[props.commits.length - 1].hash : null
  const isHead = !props.isRemote && props.commits[i]?.hash === headHash
  return isHead ? '#fff' : 'var(--color-bg)'
}
</script>

<template>
  <div class="flex flex-col gap-1 py-1">
    <div
      v-for="(commit, i) in commits"
      :key="commit.hash"
      class="flex items-start gap-2 px-1 py-0.5 rounded text-xs animate-[nodeIn_0.2s_ease]"
      style="color: var(--color-text);"
    >
      <div class="flex flex-col items-center shrink-0 mt-0.5">
        <div class="w-2.5 h-2.5 rounded-full border-2 shrink-0" :style="{ borderColor: nodeColor, background: nodeBg(i) }"></div>
        <div v-if="i < commits.length - 1" class="w-px mt-0.5" style="background: var(--color-border); height: 10px;"></div>
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-1 flex-wrap">
          <span class="font-mono text-[10px] px-1 rounded" style="background: rgba(88,166,255,0.15); color: var(--color-accent);">{{ commit.hash }}</span>
          <span v-if="!isRemote && i === commits.length - 1" class="px-1 rounded text-[9px] font-bold" style="background: #f85149; color: #fff;">HEAD</span>
          <span v-if="isRemote && i === 0 && watch.remoteTrackHash && commit.hash === watch.remoteTrackHash?.slice(0, 7)" class="px-1 rounded text-[9px]" style="background: var(--color-remote-border); color: #fff;">origin/{{ watch.branch }}</span>
        </div>
        <div class="truncate mt-0.5" style="color: var(--color-text-muted);">{{ commit.msg }}</div>
      </div>
    </div>
  </div>
</template>
