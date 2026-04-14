import { defineStore } from 'pinia'
import { ref, readonly } from 'vue'

export const useWatchStore = defineStore('watch', () => {
  const rootHandle = ref<FileSystemDirectoryHandle | null>(null)
  const gitHandle = ref<FileSystemDirectoryHandle | null>(null)
  const prevFiles = ref(new Map<string, { lm: number; size: number }>())
  const prevIndexEntries = ref(new Map<string, string>())
  const baselineSha = ref(new Map<string, string>())
  const prevCommitHash = ref<string | null>(null)
  const prevRemoteHash = ref<string | null>(null)
  const remoteTrackHash = ref<string | null>(null)
  const stagedFiles = ref(new Set<string>())
  const interval = ref<ReturnType<typeof setInterval> | null>(null)
  const folderName = ref('')
  const branch = ref('main')
  const supported = readonly(ref('showDirectoryPicker' in window))

  function reset() {
    rootHandle.value = null; gitHandle.value = null
    prevFiles.value.clear(); prevIndexEntries.value.clear(); baselineSha.value.clear()
    prevCommitHash.value = null; prevRemoteHash.value = null; remoteTrackHash.value = null
    stagedFiles.value.clear()
    if (interval.value) clearInterval(interval.value); interval.value = null
    folderName.value = ''; branch.value = 'main'
  }

  return {
    rootHandle, gitHandle, prevFiles, prevIndexEntries, baselineSha,
    prevCommitHash, prevRemoteHash, remoteTrackHash, stagedFiles,
    interval, folderName, branch, supported, reset
  }
})
