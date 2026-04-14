<script setup lang="ts">
import { useWatchStore } from '../stores/watchStore'
import { useGithubStore } from '../stores/githubStore'
import { useGithubApi } from '../composables/useGithubApi'
import { useFileSystem } from '../composables/useFileSystem'

const emit = defineEmits<{ 'open-gh-modal': [] }>()
const watch = useWatchStore()
const gh = useGithubStore()
const { logout, onRepoSelect } = useGithubApi()
const { openFolder } = useFileSystem()

function onToggleGithub(on: boolean) {
  gh.enabled = on
}
</script>

<template>
  <header class="flex items-center justify-between px-4 border-b shrink-0 gap-3" style="background: var(--color-surface); border-color: var(--color-border); height: 48px;">
    <!-- Left -->
    <div class="flex items-center gap-3">
      <span class="text-[17px] font-bold tracking-tight" style="color: var(--color-accent);">Git<span style="color: #fff;">GUI</span></span>
      <span class="text-[11px] hidden sm:block" style="color: var(--color-text-muted);">Gitの動きを視覚的に学ぼう</span>
      <button
        class="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs transition-colors"
        :class="watch.rootHandle ? 'border' : 'border'"
        :style="watch.rootHandle ? 'background:#21262d; border-color: var(--color-success); color: var(--color-success);' : 'background:#21262d; border-color:#444c56; color: var(--color-text);'"
        @click="openFolder"
      >
        <span>{{ watch.rootHandle ? '✅' : '📁' }}</span>
        <span>{{ watch.rootHandle ? watch.folderName : 'フォルダを開く' }}</span>
      </button>
    </div>

    <!-- Right: GitHub area -->
    <div class="flex items-center gap-2.5 shrink-0">
      <label class="flex items-center gap-1.5 cursor-pointer select-none">
        <span class="text-xs" style="color: var(--color-text-muted);">GitHub連携</span>
        <div class="relative w-9 h-5">
          <input type="checkbox" class="sr-only" :checked="gh.enabled" @change="onToggleGithub(($event.target as HTMLInputElement).checked)" />
          <div class="w-full h-full rounded-full transition-colors" :style="gh.enabled ? 'background: var(--color-accent);' : 'background: #30363d;'"></div>
          <div class="absolute w-3.5 h-3.5 bg-white rounded-full top-[3px] transition-transform" :style="gh.enabled ? 'left: 19px;' : 'left: 3px;'"></div>
        </div>
      </label>

      <template v-if="gh.enabled">
        <!-- Not logged in -->
        <button v-if="!gh.user" class="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs border transition-colors" style="background:#21262d; border-color:#444c56; color: var(--color-text);" @click="emit('open-gh-modal')">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
          GitHubにログイン
        </button>

        <!-- Logged in -->
        <div v-else class="flex items-center gap-2">
          <img :src="gh.user.avatar_url" class="w-6 h-6 rounded-full border" style="border-color: #444;" />
          <span class="text-xs font-semibold" style="color: var(--color-text);">@{{ gh.user.login }}</span>
          <div class="w-px h-4" style="background: var(--color-border);"></div>
          <div class="relative">
            <select
              class="appearance-none text-xs px-2 pr-6 py-1 rounded-md outline-none"
              style="background: #21262d; border: 1px solid #444c56; color: var(--color-text); min-width: 160px;"
              :value="gh.activeRepo ?? ''"
              @change="onRepoSelect(($event.target as HTMLSelectElement).value)"
            >
              <option value="">リポジトリを選択...</option>
              <option v-for="r in gh.repos" :key="r.full_name" :value="r.full_name">{{ r.full_name }}</option>
            </select>
            <span class="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] pointer-events-none" style="color: var(--color-text-muted);">▾</span>
          </div>
          <button class="px-2 py-1 rounded-md text-[11px] border transition-colors" style="border-color:#444c56; color: var(--color-text-muted);" @mouseenter="($event.target as HTMLElement).style.cssText='border-color:#f85149;color:#f85149'" @mouseleave="($event.target as HTMLElement).style.cssText='border-color:#444c56;color:#8b949e'" @click="logout">ログアウト</button>
        </div>
      </template>
    </div>
  </header>
</template>
