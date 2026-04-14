import { ref } from 'vue'

export interface TermLine { type: 'prompt' | 'output' | 'error' | 'info'; text: string }

const lines = ref<TermLine[]>([])
const MAX_LINES = 120

export function useTerminal() {
  function print(type: TermLine['type'], text: string): void {
    lines.value.push({ type, text })
    if (lines.value.length > MAX_LINES) lines.value.shift()
  }

  function clear(): void { lines.value = [] }

  return { lines, print, clear }
}
