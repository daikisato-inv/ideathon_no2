<script setup lang="ts">
import { ref, nextTick } from 'vue'
import { useWatchStore } from '../stores/watchStore'
import { useTerminal } from '../composables/useTerminal'

const watch = useWatchStore()
const { lines, print, clear } = useTerminal()
const inputValue = ref('')
const bodyEl = ref<HTMLDivElement>()
const hist: string[] = []
let histIdx = -1

function scrollToBottom() {
  nextTick(() => { if (bodyEl.value) bodyEl.value.scrollTop = bodyEl.value.scrollHeight })
}

function handleCommand(raw: string): void {
  const cmd = raw.trim()
  print('prompt', `$ ${cmd}`)
  if (cmd === 'clear') { clear(); return }
  if (!watch.rootHandle) {
    print('output', '📁 まず「フォルダを開く」でローカルのGitリポジトリを選択してください。')
    print('output', '接続後はVS Code / Cursor で git コマンドを実行すると自動で反映されます。')
    return
  }
  if (cmd === 'help') { print('info', 'コマンド: clear — ターミナルをクリア'); return }
  print('output', 'ℹ VS Code / Cursor のターミナルで git コマンドを実行してください。')
  scrollToBottom()
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'ArrowUp') {
    if (histIdx < hist.length - 1) histIdx++
    inputValue.value = hist[hist.length - 1 - histIdx] || ''
    e.preventDefault(); return
  }
  if (e.key === 'ArrowDown') {
    if (histIdx > 0) histIdx--
    inputValue.value = hist[hist.length - 1 - histIdx] || ''
    e.preventDefault(); return
  }
  if (e.key !== 'Enter') return
  const cmd = inputValue.value.trim(); if (!cmd) return
  hist.push(cmd); histIdx = -1; inputValue.value = ''
  handleCommand(cmd)
}
</script>

<template>
  <div class="flex flex-col rounded-lg overflow-hidden border shrink-0" style="border-color: var(--color-border); background: var(--color-surface); height: 140px;">
    <div class="flex items-center gap-1.5 px-3 py-1.5 border-b shrink-0" style="border-color: var(--color-border);">
      <div class="w-3 h-3 rounded-full bg-red-500"></div>
      <div class="w-3 h-3 rounded-full bg-yellow-500"></div>
      <div class="w-3 h-3 rounded-full bg-green-500"></div>
      <span class="ml-2 text-xs font-medium" style="color: var(--color-text-muted);">Terminal</span>
      <span class="ml-auto text-xs" style="color: var(--color-text-muted);">{{ watch.rootHandle ? 'ライブ監視' : '未接続' }}</span>
    </div>
    <div ref="bodyEl" class="flex-1 overflow-y-auto px-3 py-1 font-mono text-xs min-h-0">
      <div v-if="!lines.length" style="color: var(--color-text-muted);">フォルダを開くとここにイベントが流れます</div>
      <div v-for="(line, i) in lines" :key="i" :style="line.type === 'prompt' ? 'color:#79c0ff;' : line.type === 'error' ? 'color:#f85149;' : line.type === 'info' ? 'color:#56d364;' : 'color: var(--color-text-muted);'" style="line-height: 1.5;">{{ line.text }}</div>
    </div>
    <div class="flex items-center px-3 py-1 border-t shrink-0 font-mono text-xs" style="border-color: var(--color-border);">
      <span style="color: var(--color-accent);">{{ watch.rootHandle ? `${watch.folderName} $ ` : '$ ' }}</span>
      <input v-model="inputValue" class="flex-1 bg-transparent outline-none ml-1" style="color: var(--color-text); caret-color: var(--color-accent);" autocomplete="off" @keydown="onKeydown" />
    </div>
  </div>
</template>
