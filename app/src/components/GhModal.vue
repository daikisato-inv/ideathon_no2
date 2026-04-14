<script setup lang="ts">
import { ref } from 'vue'
import { useGithubApi } from '../composables/useGithubApi'

defineProps<{ visible: boolean }>()
const emit = defineEmits<{ close: [] }>()

const { authenticate, modalError, modalLoading } = useGithubApi()
const patInput = ref('')

async function connect() {
  if (!patInput.value.trim()) { return }
  try {
    await authenticate(patInput.value.trim())
    emit('close')
  } catch (e: unknown) {
    modalError.value = (e as Error).message
  }
}
</script>

<template>
  <div
    v-if="visible"
    class="fixed inset-0 flex items-center justify-center z-50"
    style="background: rgba(0,0,0,.75); backdrop-filter: blur(4px);"
    @click.self="emit('close')"
  >
    <div
      class="flex flex-col gap-4 p-6 rounded-xl w-[420px] max-w-[calc(100vw-2rem)]"
      style="background: #161b22; border: 1px solid #30363d; animation: modalIn .2s ease;"
    >
      <div class="flex flex-col items-center gap-2 text-center">
        <div class="w-12 h-12 rounded-full flex items-center justify-center" style="background: #21262d; border: 1px solid #30363d;">
          <svg width="24" height="24" viewBox="0 0 16 16" fill="#c9d1d9"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
        </div>
        <div class="text-lg font-semibold" style="color: #c9d1d9;">GitHubと連携</div>
        <div class="text-xs leading-relaxed" style="color: #8b949e;">Personal Access Token (PAT) でGitHubに接続します。<br/>リモートリポジトリのコミット履歴を可視化できます。</div>
      </div>

      <div class="rounded-lg p-3 flex flex-col gap-1.5" style="background: #0d1117; border: 1px solid #30363d;">
        <div v-for="(step, i) in ['GitHub → Settings → Developer settings → Personal access tokens', 'Generate new token (classic)', 'スコープ: repo にチェック → Generate']" :key="i" class="flex gap-2 items-start text-xs" style="color: #8b949e;">
          <span class="w-4 h-4 rounded-full flex items-center justify-center shrink-0 text-[9px]" style="background: #21262d; border: 1px solid #444;">{{ i+1 }}</span>
          <span>{{ step }}</span>
        </div>
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium" style="color: #8b949e;">Personal Access Token</label>
        <input
          v-model="patInput"
          type="password"
          placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
          class="w-full rounded-md px-3 py-2 font-mono text-sm outline-none"
          style="background: #0d1117; border: 1px solid #30363d; color: #c9d1d9;"
          @keydown.enter="connect"
        />
      </div>

      <div v-if="modalError" class="text-xs px-3 py-1.5 rounded-md" style="color: #f85149; background: rgba(248,81,73,.1); border: 1px solid rgba(248,81,73,.3);">{{ modalError }}</div>

      <div class="flex gap-2">
        <button class="flex-1 py-2 rounded-md text-sm font-semibold flex items-center justify-center gap-1.5" style="background: #58a6ff; color: #000;" :disabled="modalLoading" @click="connect">
          <span v-if="modalLoading" class="w-3 h-3 rounded-full border-2 border-black/30 border-t-black" style="animation: spin .7s linear infinite;"></span>
          {{ modalLoading ? '認証中...' : '連携する' }}
        </button>
        <button class="px-4 py-2 rounded-md text-sm" style="background: #21262d; border: 1px solid #444c56; color: #c9d1d9;" @click="emit('close')">キャンセル</button>
      </div>
    </div>
  </div>
</template>
