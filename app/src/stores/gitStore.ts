import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { FileItem, CommitEntry } from '../types'

export const useGitStore = defineStore('git', () => {
  const wd = ref<FileItem[]>([])
  const sa = ref<FileItem[]>([])
  const lr = ref<CommitEntry[]>([])
  const rr = ref<CommitEntry[]>([])

  function clearAll() {
    wd.value = []; sa.value = []; lr.value = []; rr.value = []
  }

  return { wd, sa, lr, rr, clearAll }
})
