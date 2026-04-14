<script setup lang="ts">
import { computed } from 'vue'
import { useWatchStore } from '../stores/watchStore'
import { useGithubStore } from '../stores/githubStore'

const watch = useWatchStore()
const gh = useGithubStore()
const isConnected = computed(() => watch.rootHandle !== null)
const ghLabel = computed(() => {
  if (!gh.enabled) return 'GitHub: オフ'
  if (gh.user) return `GitHub: @${gh.user.login}`
  return 'GitHub: 未認証'
})
</script>

<template>
  <div class="flex items-center gap-4 px-4 py-1 text-xs border-t shrink-0" style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text-muted);">
    <div class="flex items-center gap-1.5">
      <div class="w-2 h-2 rounded-full" :class="isConnected ? 'animate-[blink_1.5s_ease-in-out_infinite]' : ''" :style="{ background: isConnected ? 'var(--color-success)' : '#555' }"></div>
      <span>{{ isConnected ? `監視中: ${watch.folderName}` : '未接続' }}</span>
    </div>
    <div class="flex items-center gap-1.5">
      <div class="w-2 h-2 rounded-full" :style="{ background: gh.enabled && gh.user ? 'var(--color-success)' : (gh.enabled ? 'var(--color-accent)' : '#555') }"></div>
      <span>{{ ghLabel }}</span>
    </div>
    <template v-if="isConnected">
      <div class="flex items-center gap-1"><span>🌿</span><span>{{ watch.branch }}</span></div>
      <span>ポーリング: 800ms</span>
    </template>
  </div>
</template>
