<script setup lang="ts">
import { computed } from 'vue'
import type { FileItem, CommitEntry, ZoneType, BranchLogEntry, DagCommit } from '../types'
import FileCard from './FileCard.vue'
import BranchGraph from './BranchGraph.vue'
import FlowGraph from './FlowGraph.vue'

const props = defineProps<{
  zoneType: ZoneType
  files?: FileItem[]
  commits?: CommitEntry[]
  highlights?: string[]
  isRemote?: boolean
  branchLogs?: Map<string, BranchLogEntry[]>
  dagCommits?: DagCommit[]
}>()

const ZONE_CONFIGS: Record<ZoneType, { icon: string; title: string; sub: string; borderColor: string; bgColor: string }> = {
  wd: { icon: '📂', title: '作業ディレクトリ', sub: 'Working Directory', borderColor: 'var(--color-working-border)', bgColor: 'rgba(13,33,55,0.5)' },
  sa: { icon: '📦', title: 'ステージングエリア', sub: 'Staging Area (Index)', borderColor: 'var(--color-staging-border)', bgColor: 'rgba(31,26,13,0.5)' },
  lr: { icon: '🗄', title: 'ローカルリポジトリ', sub: 'Local Repository', borderColor: 'var(--color-local-border)', bgColor: 'rgba(13,31,13,0.5)' },
  rt: { icon: '🔄', title: 'リモート追跡ブランチ', sub: 'Remote Tracking (origin/*)', borderColor: '#6e7681', bgColor: 'rgba(22,27,34,0.8)' },
  rr: { icon: '🌐', title: 'リモートリポジトリ', sub: 'Remote Repository (GitHub)', borderColor: 'var(--color-remote-border)', bgColor: 'rgba(21,13,31,0.5)' },
}

const EMPTY_HINTS: Record<ZoneType, string> = {
  wd: 'フォルダを開くとファイルが表示されます',
  sa: 'git add するとここに表示されます',
  lr: 'git commit するとここに表示されます',
  rt: 'git fetch するとここに反映されます',
  rr: 'GitHubと連携するとここに表示されます',
}

const config = computed(() => ZONE_CONFIGS[props.zoneType])
const isFileZone = computed(() => props.zoneType === 'wd' || props.zoneType === 'sa')
const isCommitZone = computed(() => props.zoneType === 'lr' || props.zoneType === 'rt' || props.zoneType === 'rr')

// lr/rt/rr: branchLogsがあればFlowGraph、なければBranchGraph（コミットのリスト）
const showFlowGraph = computed(() => isCommitZone.value && (!!props.dagCommits?.length || !!props.branchLogs?.size))
const showBranchGraph = computed(() => isCommitZone.value && !props.branchLogs && !!props.commits?.length)
const isEmpty = computed(() => {
  if (isFileZone.value) return !props.files?.length
  if (showFlowGraph.value) return false  // FlowGraph handles its own empty state
  return !props.commits?.length
})
</script>

<template>
  <div class="flex flex-col rounded-lg border overflow-hidden flex-1 min-w-0" :style="{ borderColor: config.borderColor, background: config.bgColor }">
    <!-- Zone Header -->
    <div class="flex items-center gap-2 px-3 py-2 border-b shrink-0" :style="{ borderColor: config.borderColor }">
      <span class="text-lg">{{ config.icon }}</span>
      <div>
        <div class="text-xs font-semibold" style="color: var(--color-text);">{{ config.title }}</div>
        <div class="text-[10px]" style="color: var(--color-text-muted);">{{ config.sub }}</div>
      </div>
    </div>

    <!-- Zone Body -->
    <div class="flex-1 overflow-hidden p-2 min-h-0 relative">
      <!-- Empty state -->
      <div v-if="isEmpty" class="h-full flex items-center justify-center text-xs text-center px-2" style="color: var(--color-text-muted);">
        {{ EMPTY_HINTS[zoneType] }}
      </div>

      <!-- File zones (WD, SA) -->
      <template v-if="isFileZone && files?.length">
        <div class="overflow-y-auto h-full flex flex-col gap-1">
          <FileCard v-for="file in files" :key="file.name" :file="file" :highlight="highlights?.includes(file.name)" />
        </div>
      </template>

      <!-- Commit zones with branch graph (LR, RT, RR) -->
      <FlowGraph
        v-if="showFlowGraph"
        :branch-logs="branchLogs"
        :dag-commits="dagCommits"
        :empty-text="EMPTY_HINTS[zoneType]"
      />

      <!-- Fallback: simple commit list (no branchLogs provided) -->
      <BranchGraph
        v-if="showBranchGraph"
        :commits="commits!"
        :is-remote="isRemote"
      />
    </div>
  </div>
</template>
