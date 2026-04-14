<script setup lang="ts">
import type { FileItem } from '../types'

const props = defineProps<{ file: FileItem; highlight?: boolean }>()

const BADGE_LABEL: Record<string, string> = {
  untracked: 'new', modified: 'modified', deleted: 'deleted',
  staged: 'staged', 'staged-del': 'staged(del)'
}
const BADGE_STYLE: Record<string, string> = {
  untracked: 'background:#0d2b0d; color:#56d364;',
  modified: 'background:#2b2200; color:#e3b341;',
  deleted: 'background:#2b0d0d; color:#f85149;',
  staged: 'background:#0d1f3c; color:#58a6ff;',
  'staged-del': 'background:#1f0d2b; color:#a78bfa;',
}
</script>

<template>
  <div
    class="flex items-center justify-between px-2 py-1 rounded text-xs mb-1 border"
    :class="highlight ? 'animate-[pulseFx_0.6s_ease]' : 'animate-[cardIn_0.2s_ease]'"
    style="background: rgba(255,255,255,0.04); border-color: var(--color-border);"
  >
    <span class="flex items-center gap-1 min-w-0">
      <span>{{ props.file.icon }}</span>
      <span class="truncate font-mono" style="color: var(--color-text);">{{ props.file.name }}</span>
    </span>
    <span class="ml-2 shrink-0 px-1 rounded text-[10px] font-semibold" :style="BADGE_STYLE[props.file.status]">
      {{ BADGE_LABEL[props.file.status] }}
    </span>
  </div>
</template>
