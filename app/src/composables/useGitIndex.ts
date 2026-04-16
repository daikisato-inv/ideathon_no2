import { useWatchStore } from '../stores/watchStore'
import { useGitStore } from '../stores/gitStore'
import { getFileIcon } from './useFileSystem'
import type { FileItem } from '../types'

export function parseGitIndex(buffer: ArrayBuffer): Map<string, string> {
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)
  const dec = new TextDecoder()
  if (dec.decode(bytes.slice(0, 4)) !== 'DIRC') return new Map()
  const version = view.getUint32(4, false)
  const count = view.getUint32(8, false)
  const entries = new Map<string, string>()
  let off = 12
  for (let i = 0; i < count && off + 62 < buffer.byteLength; i++) {
    const start = off
    off += 40
    const sha = Array.from(bytes.slice(off, off + 20)).map(b => b.toString(16).padStart(2, '0')).join('')
    off += 20
    const flags = view.getUint16(off, false); off += 2
    const nameLen = flags & 0x0fff
    if (version >= 3 && (flags & 0x4000)) off += 2
    let name: string
    if (nameLen < 0xfff) {
      name = dec.decode(bytes.slice(off, off + nameLen))
      off += nameLen + 1
    } else {
      let end = off
      while (end < bytes.length && bytes[end] !== 0) end++
      name = dec.decode(bytes.slice(off, end))
      off = end + 1
    }
    const entryLen = off - start
    off = start + Math.ceil(entryLen / 8) * 8
    if (name) entries.set(name, sha)
  }
  return entries
}

/** Build a FileItem with a sensible default icon. */
function createFileItem(
  name: string,
  status: FileItem['status'],
  icon = getFileIcon(name),
  origStatus?: string
): FileItem {
  return { name, icon, status, origStatus }
}

export function useGitIndex() {
  const watch = useWatchStore()
  const git = useGitStore()

  function handleIndexChange(newEntries: Map<string, string>): void {
    for (const [name, sha] of newEntries) {
      const prevSha = watch.prevIndexEntries.get(name)
      if (prevSha === undefined || sha !== prevSha) {
        const inSA = git.sa.findIndex(f => f.name === name)
        const bSha = watch.baselineSha.get(name)

        if (inSA >= 0 && bSha !== undefined && sha === bSha) {
          // Unstage: SA → WD
          watch.stagedFiles.delete(name)
          const f = git.sa.splice(inSA, 1)[0]
          git.wd.push(createFileItem(name, (f.origStatus as FileItem['status']) || 'modified', f.icon))
        } else if (inSA < 0) {
          // Stage: WD → SA
          const wi = git.wd.findIndex(f => f.name === name)
          const icon = wi >= 0 ? git.wd[wi].icon : getFileIcon(name)
          const origStatus = wi >= 0 ? git.wd[wi].status : (prevSha === undefined ? 'untracked' : 'modified')
          if (wi >= 0) git.wd.splice(wi, 1)
          if (!git.sa.find(f => f.name === name)) {
            const saStatus: FileItem['status'] = origStatus === 'deleted' ? 'staged-del' : 'staged'
            git.sa.push(createFileItem(name, saStatus, icon, origStatus))
            watch.stagedFiles.add(name)
          }
        }
      }
    }

    for (const [name] of watch.prevIndexEntries) {
      if (!newEntries.has(name)) {
        watch.stagedFiles.delete(name)
        const si = git.sa.findIndex(f => f.name === name)
        if (si >= 0) {
          const f = git.sa.splice(si, 1)[0]
          const restoreStatus = (f.origStatus || (f.status === 'staged-del' ? 'deleted' : 'untracked')) as FileItem['status']
          git.wd.push(createFileItem(name, restoreStatus, f.icon))
        } else {
          git.wd.push(createFileItem(name, 'untracked'))
        }
      }
    }

    watch.prevIndexEntries = newEntries
  }

  return { handleIndexChange }
}
