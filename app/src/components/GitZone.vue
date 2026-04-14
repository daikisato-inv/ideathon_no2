<script setup lang="ts">
import { computed } from 'vue'
import type { FileItem, CommitEntry, ZoneType } from '../types'
import FileCard from './FileCard.vue'
import BranchGraph from './BranchGraph.vue'

const props = defineProps<{
  zoneType: ZoneType
  files?: FileItem[]
  commits?: CommitEntry[]
  highlights?: string[]
  isRemote?: boolean
}>()

const ZONE_CONFIGS: Record<ZoneType, { icon: string; title: string; sub: string; borderColor: string; bgColor: string }> = {
  wd: { icon: '📂', title: '作業ディレクトリ', sub: 'Working Directory', borderColor: 'var(--color-working-border)', bgColor: 'rgba(13,33,55,0.5)' },
  sa: { icon: '📦', title: 'ステージングエリア', sub: 'Staging Area (Index)', borderColor: 'var(--color-staging-border)', bgColor: 'rgba(31,26,13,0.5)' },
  lr: { icon: '🗄', title: 'ローカルリポジトリ', sub: 'Local Repository', borderColor: 'var(--color-local-border)', bgColor: 'rgba(13,31,13,0.5)' },
  rr: { icon: '🌐', title: 'リモートリポジトリ', sub: 'origin / Remote Tracking', borderColor: 'var(--color-remote-border)', bgColor: 'rgba(21,13,31,0.5)' },
}

const config = computed(() => ZONE_CONFIGS[props.zoneType])
const isFileZone = computed(() => props.zoneType === 'wd' || props.zoneType === 'sa')
const isEmpty = computed(() => isFileZone.value ? !props.files?.length : !props.commits?.length)

const EMPTY_HINTS: Record<ZoneType, string> = {
  wd: 'フォルダを開くとファイルが表示されます',
  sa: 'git add するとここに表示されます',
  lr: 'git commit するとここに表示されます',
  rr: 'git push するとここに表示されます',
}
</script>

<template>
  <div class="flex flex-col rounded-lg border overflow-hidden flex-1 min-w-0" :style="{ borderColor: config.borderColor, background: config.bgColor }">
    <div class="flex items-center gap-2 px-3 py-2 border-b shrink-0" :style="{ borderColor: config.borderColor }">
      <span class="text-lg">{{ config.icon }}</span>
      <div>
        <div class="text-xs font-semibold" style="color: var(--color-text);">{{ config.title }}</div>
        <div class="text-[10px]" style="color: var(--color-text-muted);">{{ config.sub }}</div>
      </div>
    </div>
    <div class="flex-1 overflow-y-auto p-2 min-h-0">
      <div v-if="isEmpty" class="h-full flex items-center justify-center text-xs text-center px-2" style="color: var(--color-text-muted);">
        {{ EMPTY_HINTS[zoneType] }}
      </div>
      <template v-if="isFileZone && files?.length">
        <FileCard v-for="file in files" :key="file.name" :file="file" :highlight="highlights?.includes(file.name)" />
      </template>
      <BranchGraph v-if="!isFileZone && commits?.length" :commits="commits" :is-remote="isRemote" />
    </div>
  </div>
</template>
