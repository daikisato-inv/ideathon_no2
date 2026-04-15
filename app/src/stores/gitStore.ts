import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { FileItem, CommitEntry } from '../types'

export const useGitStore = defineStore('git', () => {
  const wd = ref<FileItem[]>([])
  const sa = ref<FileItem[]>([])
  const lr = ref<CommitEntry[]>([])
  const rt = ref<CommitEntry[]>([])  // Remote Tracking (origin/* refs stored locally)
  const rr = ref<CommitEntry[]>([])  // Remote Repo (GitHub API)

  function clearAll() {
    wd.value = []; sa.value = []; lr.value = []; rt.value = []; rr.value = []
  }

  return { wd, sa, lr, rt, rr, clearAll }
})
